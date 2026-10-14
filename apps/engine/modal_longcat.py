"""Modal runner for LongCat-Video-Avatar 1.5 -- the production lip-sync model.

LongCat-Video-Avatar 1.5 (Meituan, MIT) is an audio-driven avatar model: a
reference photo plus an audio clip produces a speaking video. It is the ONLY
lip-sync model in the pipeline; ``app/services/longcat.py`` is its client and
the persona lipsync path in ``app/services/task.py`` is its only caller.

Jobs are submitted/polled/downloaded over HTTP rather than run synchronously:
a 7.5s persona hook costs ~6 minutes of H200, which is far longer than any
client timeout, so the submit endpoint returns a job id immediately and the
caller polls. The GPU work happens in a spawned ``@app.cls`` handler that owns
the model for the life of the container.

IMPORTANT: clip length is set by --num_segments, not by the audio. Upstream
hardcodes 93 frames per segment at 25 fps and appends 80 new frames per extra
segment (Video Continuation mode). ``app.services.longcat.clip_seconds`` owns
that arithmetic, and the client derives the segment count from the real trimmed
audio -- rounding UP so a clip never renders shorter than its narration.

The upstream reference commands run two GPUs with context parallelism; this
app requests exactly one.

This module is the HTTP surface AND the deploy entry point: every
Modal-decorated function/class lives here, so `modal deploy modal_longcat.py`
and `modal run modal_longcat.py::download_weights` resolve against it. The
container image, weights layout, GPU/rate literals and the torchrun call are in
modal_longcat_gpu.py, split out for file size.

One-time setup:

    uv run python -m modal setup
    uv run modal secret create huggingface HF_TOKEN=hf_...
    uv run modal secret create longcat-http LONGCAT_HTTP_SECRET=...

Then pull ~54 GB of weights into the persistent volume (slow, one time):

    uv run modal run modal_longcat.py::download_weights

Then deploy the HTTP endpoints (once per Modal account -- dev and prod use
separate accounts, so this runs in both):

    uv run modal deploy modal_longcat.py

MIGRATING from InfiniteTalk: the app is now `moneyprint-longcat` (was
`moneyprint-infinitetalk`), so redeploying changes the endpoint URLs, and every
INFINITETALK_* env var is now LONGCAT_*. Rename them in Infisical (env=dev and
env=prod) and in apps/engine/.env in the same rollout as deploying this build;
there is no fallback for the old names, by design.

The deploy output prints the submit/status/download URLs. The engine reads
them from LONGCAT_SUBMIT_URL / LONGCAT_STATUS_URL / LONGCAT_DOWNLOAD_URL, and
builds the status/download URLs from LONGCAT_MODAL_APP_NAME. Set them in
apps/engine/.env (dev) and in Infisical under env=prod (prod).
"""

from __future__ import annotations

import hmac
import os
import re
import time
import uuid
from pathlib import Path

import modal
from fastapi import File, Form, Request, UploadFile
from fastapi.responses import JSONResponse, Response

# The container image, the weights layout, the GPU/rate literals and the
# torchrun call itself live in modal_longcat_gpu.py. Everything Modal-decorated
# stays HERE so `modal deploy modal_longcat.py` and
# `modal run modal_longcat.py::download_weights` keep resolving against this
# module.
from modal_longcat_gpu import (
    AVATAR_WEIGHTS_DIR,
    BASE_WEIGHTS_DIR,
    GPU_PREFERENCE,
    active_gpu_name,
    rate_for_active_gpu as _rate,
    LONGCAT_AVATAR_REPO,
    LONGCAT_BASE_REPO,
    LONGCAT_IMAGE,
    MAX_SEGMENTS,
    WEIGHTS_DIR,
    WEIGHTS_VOLUME,
    run_longcat,
)

RESULTS_VOLUME = modal.Volume.from_name("longcat-results", create_if_missing=True)
JOB_STATUS = modal.Dict.from_name("longcat-job-status", create_if_missing=True)

# LipSyncQuality -> the resolution rendered here. Mirrored by
# QUALITY_RESOLUTIONS in app/services/longcat.py, which is what the client
# validates against; an unknown quality is rejected on both sides so a typo
# never silently bills a 720p render nobody asked for.
QUALITY_PRESETS: dict[str, str] = {
    "ok": "480p",
    "very-good": "720p",
}

# Shared bearer secret required by every HTTP endpoint below. Without it the
# public Modal URLs would let anyone submit H200 GPU jobs (direct spend) and
# read any job's result. Set it via `modal secret create longcat-http
# LONGCAT_HTTP_SECRET=...` and attach the secret to the endpoint functions with
# `secret=modal.Secret.from_name("longcat-http")`.
LONGCAT_HTTP_SECRET = os.environ.get("LONGCAT_HTTP_SECRET", "")

# Upload caps (bytes) mirroring the engine's persona media limits.
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
_JOB_ID_RE = re.compile(r"^[0-9a-f]{32}$")

# Modal account/app prefix for the deployed HTTP endpoints. Set
# LONGCAT_MODAL_APP_NAME in the environment (see apps/engine/.env.example);
# there is no default -- the endpoint URLs cannot be built without it.
_MODAL_APP_NAME = os.environ.get("LONGCAT_MODAL_APP_NAME")
if not _MODAL_APP_NAME:
    raise RuntimeError(
        "LONGCAT_MODAL_APP_NAME is not set; it is required to build the "
        "LongCat Modal endpoint URLs"
    )
STATUS_ENDPOINT = f"https://{_MODAL_APP_NAME}--longcat-http-server-status.modal.run"
DOWNLOAD_ENDPOINT = f"https://{_MODAL_APP_NAME}--longcat-http-server-download.modal.run"

# Approximate container boot (module import). Modal bills the GPU from here, so
# this is the baseline the reported cost_usd is measured against -- NOT the
# handler start, which would hide the ~54 GB weight load.
_CONTAINER_START = time.monotonic()


def _auth_error() -> JSONResponse | None:
    """Return a 503 when the bearer secret the endpoints need is absent."""
    if not LONGCAT_HTTP_SECRET:
        return JSONResponse(
            status_code=503,
            content={"error": "server is not configured with LONGCAT_HTTP_SECRET"},
        )
    return None


def _check_bearer(request: Request) -> JSONResponse | None:
    """Constant-time compare of the Authorization header against the secret."""
    header = request.headers.get("authorization", "")
    expected = f"Bearer {LONGCAT_HTTP_SECRET}"
    if not hmac.compare_digest(header.encode(), expected.encode()):
        return JSONResponse(status_code=401, content={"error": "unauthorized"})
    return None


def _validate_job_id(job_id: str) -> JSONResponse | None:
    """Reject malformed job ids (prevents cross-job reads)."""
    if not _JOB_ID_RE.match(job_id):
        return JSONResponse(status_code=400, content={"error": "invalid job_id"})
    return None


def _validate_num_segments(value: str) -> tuple[int, JSONResponse | None]:
    """Parse --num_segments, rejecting anything that is not a small positive int.

    A bad value here would be a paid GPU run, so the check is strict: '03' and
    ' 2 ' are rejected rather than coerced, exactly like the engine's own form
    params.
    """
    if not re.fullmatch(r"[1-9][0-9]*", value):
        return 0, JSONResponse(
            status_code=400,
            content={"error": f"num_segments must be an integer from 1 to {MAX_SEGMENTS}"},
        )
    num_segments = int(value)
    if num_segments > MAX_SEGMENTS:
        return 0, JSONResponse(
            status_code=400,
            content={"error": f"num_segments must be an integer from 1 to {MAX_SEGMENTS}"},
        )
    return num_segments, None


def _write_job_status(
    job_id: str, status: str, details: dict[str, object] | None = None
) -> None:
    """Persist a small status record without volume snapshot propagation."""
    existing = JOB_STATUS.get(job_id)
    record: dict[str, object] = dict(existing) if isinstance(existing, dict) else {}
    record.update({"job_id": job_id, "status": status})
    if details is not None:
        record.update(details)
    JOB_STATUS[job_id] = record


async def _write_job_status_async(
    job_id: str,
    status: str,
    details: dict[str, object] | None = None,
) -> None:
    """Persist status through Modal's async Dict interface for web functions."""
    existing = await JOB_STATUS.get.aio(job_id)
    record: dict[str, object] = dict(existing) if isinstance(existing, dict) else {}
    record.update({"job_id": job_id, "status": status})
    if details is not None:
        record.update(details)
    await JOB_STATUS.put.aio(job_id, record)


# One Modal app per GPU candidate, so an H100 deployment and an A100 deployment
# can sit side by side and be tested without one clobbering the other's URLs.
# Modal derives the endpoint host from this name, so it has to differ per GPU.
_GPU_SLUG = os.environ.get("LONGCAT_GPU", "").lower().replace("-80gb", "80")
app = modal.App(f"moneyprint-longcat-{_GPU_SLUG}" if _GPU_SLUG else "moneyprint-longcat")

# The three HTTP endpoints only authenticate, touch a Modal Dict and move MP4
# bytes -- none of that needs the ~20GB torch/flash-attn GPU image. Running them
# on LONGCAT_IMAGE meant every submit/status call paid that image's cold start,
# so with the client's 120s submit timeout a fresh container never answered.
_HERE = Path(__file__).resolve().parent
LONGCAT_API_IMAGE = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("fastapi[standard]", "loguru")
    # modal_longcat.py imports modal_longcat_gpu at module scope, so both
    # modules must exist in every image that hosts this one -- including the
    # slim API image, whose endpoints never call the renderer.
    .add_local_file(_HERE / "modal_longcat_gpu.py", "/root/modal_longcat_gpu.py", copy=True)
    # _MODAL_APP_NAME is read at module scope, which Modal evaluates when it
    # hydrates this module INSIDE the container -- a deploy-time shell variable
    # is not visible there, so every endpoint crash-looped with
    # "LONGCAT_MODAL_APP_NAME is not set". Baking it into both images is what
    # makes it reach the runtime.
    .env({"LONGCAT_MODAL_APP_NAME": _MODAL_APP_NAME})
)


@app.function(
    image=LONGCAT_IMAGE,
    volumes={WEIGHTS_DIR: WEIGHTS_VOLUME},
    secrets=[modal.Secret.from_name("huggingface")],
    timeout=14400,
)
def download_weights() -> str:
    """Download the LongCat base + avatar checkpoints into the volume.

    Two repos, not one: Avatar-1.5 builds on the LongCat-Video foundation
    model, and the loader expects both trees under /weights.
    """
    from huggingface_hub import snapshot_download

    token = os.environ["HF_TOKEN"]
    for index, repo_id in enumerate((LONGCAT_BASE_REPO, LONGCAT_AVATAR_REPO), start=1):
        local_dir = BASE_WEIGHTS_DIR if index == 1 else AVATAR_WEIGHTS_DIR
        print(f"[{index}/2] downloading {repo_id}", flush=True)
        snapshot_download(repo_id=repo_id, local_dir=local_dir, token=token)
        print(f"[{index}/2] {repo_id} complete", flush=True)
    WEIGHTS_VOLUME.commit()
    total = sum(1 for item in Path(WEIGHTS_DIR).rglob("*") if item.is_file())
    return f"LongCat weights ready: {total} files"


@app.cls(
    image=LONGCAT_IMAGE,
    gpu=GPU_PREFERENCE,
    volumes={WEIGHTS_DIR: WEIGHTS_VOLUME, "/results": RESULTS_VOLUME},
    secrets=[modal.Secret.from_name("huggingface")],
    timeout=14400,
    # A longer window bills idle H200 time at ~$0.0013/s for nothing: 300s of
    # idle hold costs ~$0.38 per invocation versus ~$0.08 at 60s.
    scaledown_window=60,
    # One container only: the model is a single 141GB H200 allocation, and a
    # second container cannot fit alongside it anyway.
    max_containers=1,
)
class GenerateAvatar:
    """Holds the H200 container that renders every avatar clip.

    One long-lived container serves every queued job in turn: the ~54 GB weight
    load is the dominant cost of a cold container, so reusing the warm one is
    what makes a warm clip roughly half the price of a cold one.
    """

    @modal.method()
    def generate_bytes(
        self,
        job_id: str,
        image_bytes: bytes,
        audio_bytes: bytes,
        resolution: str,
        num_segments: int,
    ) -> str:
        """Render one clip and store it in the results volume.

        ``cost_usd`` is the MARGINAL cost of THIS clip (handler entry to exit),
        because that is the number per-video unit economics needs. Measuring it
        from module import instead would report cumulative container uptime, so
        the second job in a warm container would be billed for the first job's
        runtime plus the idle hold -- inflating cost with every clip the
        container serves.

        The container-to-date spend is still reported, as ``container_uptime_s``
        / ``container_cost_usd``: with ``max_containers=1`` the amortised view
        (cold-start weight load, idle hold between jobs) is real money, it just
        is not the per-clip cost.
        """
        output_path = Path("/results") / f"{job_id}.mp4"
        handler_started = time.monotonic()
        try:
            _write_job_status(
                job_id,
                "running",
                {"progress": 10, "phase": "inference", "resolution": resolution,
                 "num_segments": num_segments},
            )
            video_bytes, phase_timings = run_longcat(
                image_bytes, audio_bytes, resolution, num_segments
            )
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(video_bytes)
            RESULTS_VOLUME.commit()
            # Per-clip span: this handler call only, never the container's
            # whole life. See the docstring for why the two must not be merged.
            job_gpu_s = time.monotonic() - handler_started
            # Container-to-date, so the amortised spend stays observable. On the
            # first job after a scale-down this is the cold-start weight load.
            uptime_s = time.monotonic() - _CONTAINER_START
            timings: dict[str, float | None] = {
                "inference_s": phase_timings["inference_s"],
                "normalize_s": phase_timings["normalize_s"],
                "peak_vram_gb": phase_timings["peak_vram_gb"],
                "total_gpu_s": round(job_gpu_s, 3),
                "container_uptime_s": round(uptime_s, 3),
            }
            _write_job_status(
                job_id,
                "done",
                {
                    "output": str(output_path),
                    "bytes": len(video_bytes),
                    "resolution": resolution,
                    "num_segments": num_segments,
                    "timings": timings,
                    # Priced on the GPU the container ACTUALLY got. With a
                    # fallback list that is not always the first preference,
                    # and Modal bills each card at its own rate.
                    "gpu": active_gpu_name() or GPU_PREFERENCE[0],
                    "cost_usd": round(job_gpu_s * _rate(), 4),
                    "container_cost_usd": round(uptime_s * _rate(), 4),
                    "progress": 100,
                    "phase": "complete",
                },
            )
            return str(output_path)
        except Exception as error:
            _write_job_status(job_id, "failed", {"error": str(error)})
            raise


@app.function(
    image=LONGCAT_API_IMAGE,
    timeout=120,
    secrets=[modal.Secret.from_name("longcat-http")],
)
@modal.fastapi_endpoint(method="POST", label=f"longcat-http-server-submit{_GPU_SLUG}")
async def submit_generation(
    request: Request,
    image: UploadFile = File(...),
    audio: UploadFile = File(...),
    quality: str = Form("ok"),
    num_segments: str = Form(...),
) -> Response:
    """Queue a generation and return before GPU inference begins."""
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    bearer_error = _check_bearer(request)
    if bearer_error is not None:
        return bearer_error
    resolution = QUALITY_PRESETS.get(quality)
    if resolution is None:
        return JSONResponse(
            status_code=400,
            content={"error": "quality must be one of ('ok', 'very-good')"},
        )
    segments, segments_error = _validate_num_segments(num_segments)
    if segments_error is not None:
        return segments_error
    job_id = uuid.uuid4().hex
    image_bytes = await image.read(MAX_UPLOAD_BYTES + 1)
    audio_bytes = await audio.read(MAX_UPLOAD_BYTES + 1)
    if len(image_bytes) > MAX_UPLOAD_BYTES or len(audio_bytes) > MAX_UPLOAD_BYTES:
        return JSONResponse(
            status_code=413,
            content={"error": f"image and audio must each be at most {MAX_UPLOAD_BYTES} bytes"},
        )
    if not image_bytes or not audio_bytes:
        return JSONResponse(
            status_code=400,
            content={"error": "image and audio must not be empty"},
        )
    submitted_at = time.time()
    await _write_job_status_async(
        job_id,
        "pending",
        {
            "resolution": resolution,
            "num_segments": segments,
            "submitted_at": submitted_at,
            "progress": 0,
            "phase": "queued",
        },
    )
    # ``spawn`` returns immediately with a FunctionCall. Using ``spawn.aio``
    # here makes the web handler await the remote result and can end in HTTP
    # 500 after the GPU job has already completed.
    call = GenerateAvatar().generate_bytes.spawn(
        job_id, image_bytes, audio_bytes, resolution, segments
    )
    await _write_job_status_async(
        job_id,
        "queued",
        {
            "resolution": resolution,
            "num_segments": segments,
            "submitted_at": submitted_at,
            "call_id": call.object_id,
            "progress": 0,
            "phase": "queued",
        },
    )
    return JSONResponse(
        content={
            "job_id": job_id,
            "call_id": call.object_id,
            "status": "queued",
            "status_url": STATUS_ENDPOINT,
            "download_url": DOWNLOAD_ENDPOINT,
        }
    )


@app.function(
    image=LONGCAT_API_IMAGE,
    timeout=120,
    secrets=[modal.Secret.from_name("longcat-http")],
)
@modal.fastapi_endpoint(method="POST", label=f"longcat-http-server-status{_GPU_SLUG}")
async def job_status(request: Request, job_id: str = Form(...)) -> JSONResponse:
    """Return the current status for a queued generation."""
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    bearer_error = _check_bearer(request)
    if bearer_error is not None:
        return bearer_error
    invalid_job = _validate_job_id(job_id)
    if invalid_job is not None:
        return invalid_job
    record_value = await JOB_STATUS.get.aio(job_id)
    if not isinstance(record_value, dict):
        return JSONResponse(status_code=404, content={"error": "job not found"})
    record = dict(record_value)
    if record.get("status") == "done":
        record["download_url"] = DOWNLOAD_ENDPOINT
    return JSONResponse(content=record)


@app.function(
    image=LONGCAT_API_IMAGE,
    volumes={"/results": RESULTS_VOLUME},
    timeout=120,
    secrets=[modal.Secret.from_name("longcat-http")],
)
@modal.fastapi_endpoint(method="POST", label=f"longcat-http-server-download{_GPU_SLUG}")
async def download_result(request: Request, job_id: str = Form(...)) -> Response:
    """Download a completed MP4 from persistent storage."""
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    bearer_error = _check_bearer(request)
    if bearer_error is not None:
        return bearer_error
    invalid_job = _validate_job_id(job_id)
    if invalid_job is not None:
        return invalid_job
    RESULTS_VOLUME.reload()
    output_path = Path("/results") / f"{job_id}.mp4"
    if not output_path.is_file():
        return JSONResponse(status_code=404, content={"error": "video is not ready"})
    return Response(
        content=output_path.read_bytes(),
        media_type="video/mp4",
        headers={"Content-Disposition": f'attachment; filename="{job_id}.mp4"'},
    )

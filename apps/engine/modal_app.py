"""Modal runner for InfiniteTalk + Chatterbox persona videos.

InfiniteTalk is the open-source image/audio-to-video model used for the
full-frame persona path. It uses Wan2.1 I2V as its base model and Wav2Vec2 as
the audio encoder. Chatterbox remains a separate TTS service and supplies the
persona audio; this app receives already-generated audio.

One-time setup:

    uv run python -m modal setup
    uv run modal secret create huggingface HF_TOKEN=hf_...
    uv run modal run modal_app.py::download_weights

Validate with Diego:

    uv run modal run modal_app.py

Deploy the HTTP endpoint:

    uv run modal deploy modal_app.py
"""

from __future__ import annotations

import os
import math
import re
import subprocess
import tempfile
import time
import uuid
import hmac
from pathlib import Path

import modal
from fastapi import File, Form, Request, UploadFile
from fastapi.responses import JSONResponse, Response

REPO_URL = "https://github.com/MeiGen-AI/InfiniteTalk.git"
INFINITETALK_REPO = "MeiGen-AI/InfiniteTalk"
REPO_SHA = "50aa0a94184315407a991ae804d9b58d6d311ba8"  # Pin; shim mirrors this snapshot.
WAN_REPO = "Wan-AI/Wan2.1-I2V-14B-480P"
WAV2VEC_REPO = "TencentGameMate/chinese-wav2vec2-base"

WEIGHTS_VOLUME = modal.Volume.from_name("infinitetalk-models", create_if_missing=True)
RESULTS_VOLUME = modal.Volume.from_name("infinitetalk-results", create_if_missing=True)
JOB_STATUS = modal.Dict.from_name("infinitetalk-job-status", create_if_missing=True)
# The 720p InfiniteTalk workload needs the H200's larger VRAM capacity.
GPU = "H200"
FPS = 25
SAMPLE_STEPS = 10  # Fixed production setting for both H200 quality levels.
TEACACHE_THRESH = 0.4  # Fixed production setting for both H200 quality levels.
GPU_USD_PER_SECOND = 0.001261  # Modal H200 SXM public rate: $4.5396/hour.
GPU_RATE_USD_S = GPU_USD_PER_SECOND
_CONTAINER_START = time.monotonic()  # Approximate container boot (module import).
# Modal account/app prefix for the deployed InfiniteTalk HTTP endpoints.
# Set INFINITETALK_MODAL_APP_NAME in the environment (see apps/engine/.env.example);
# there is no default — the endpoint URLs cannot be built without it.
_MODAL_APP_NAME = os.environ.get("INFINITETALK_MODAL_APP_NAME")
if not _MODAL_APP_NAME:
    raise RuntimeError(
        "INFINITETALK_MODAL_APP_NAME is not set; it is required to build the "
        "InfiniteTalk Modal endpoint URLs"
    )
STATUS_ENDPOINT = f"https://{_MODAL_APP_NAME}--infinitetalk-http-server-status.modal.run"
DOWNLOAD_ENDPOINT = f"https://{_MODAL_APP_NAME}--infinitetalk-http-server-download.modal.run"
QUALITY_PRESETS: dict[str, str] = {
    "ok": "infinitetalk-480",
    "very-good": "infinitetalk-720",
}

# Shared bearer secret required by every HTTP endpoint below. Without it the
# public Modal URLs would let anyone submit H200 GPU jobs (direct spend) and
# read any job's result. Set it via `modal secret create infinitetalk-http
# INFINITETALK_HTTP_SECRET=...` and attach the secret to the endpoint
# functions with `secret=modal.Secret.from_name("infinitetalk-http")`.
INFINITETALK_HTTP_SECRET = os.environ.get("INFINITETALK_HTTP_SECRET", "")
# Upload caps (bytes) mirroring the engine's persona media limits.
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
_JOB_ID_RE = re.compile(r"^[0-9a-f]{32}$")


def _auth_error() -> JSONResponse | None:
    """Return a 401 response when the bearer secret is missing or wrong."""
    if not INFINITETALK_HTTP_SECRET:
        return JSONResponse(
            status_code=503,
            content={"error": "server is not configured with INFINITETALK_HTTP_SECRET"},
        )
    return None


def _check_bearer(request: Request) -> JSONResponse | None:
    """Constant-time compare of the Authorization header against the secret."""
    header = request.headers.get("authorization", "")
    expected = f"Bearer {INFINITETALK_HTTP_SECRET}"
    if not hmac.compare_digest(header.encode(), expected.encode()):
        return JSONResponse(status_code=401, content={"error": "unauthorized"})
    return None


def _validate_job_id(job_id: str) -> JSONResponse | None:
    """Reject malformed job ids (prevents path traversal / cross-job reads)."""
    if not _JOB_ID_RE.match(job_id):
        return JSONResponse(status_code=400, content={"error": "invalid job_id"})
    return None


def frames_for_duration(duration_seconds: float, fps: int = FPS) -> int:
    """Calculate InfiniteTalk's validated 4n+1 frame count from audio length."""
    if not math.isfinite(duration_seconds) or duration_seconds <= 0:
        raise ValueError("audio duration must be a positive finite number")
    target_frames = max(5, int(duration_seconds * fps) - 4)
    return ((target_frames - 1) // 4) * 4 + 1


def frames_for_audio_bytes(audio_bytes: bytes) -> int:
    """Measure uploaded audio and calculate the matching frame count."""
    with tempfile.NamedTemporaryFile(suffix=".mp3") as audio_file:
        audio_file.write(audio_bytes)
        audio_file.flush()
        result = subprocess.run(
            [
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", audio_file.name,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
    duration = float(result.stdout.strip())
    return frames_for_duration(duration)

INFINITETALK_IMAGE = (
    modal.Image.from_registry(
        "pytorch/pytorch:2.4.1-cuda12.1-cudnn9-devel",
        add_python="3.10",
    )
    .apt_install("git", "ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.4.1",
        "torchvision==0.19.1",
        "torchaudio==2.4.1",
        index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install(
        "xformers==0.0.28",
        index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install("packaging", "ninja")
    .env({"XFORMERS_ENABLE_TRITON": "1"})
    .pip_install(
        "flash-attn==2.6.3",
        extra_options="--no-build-isolation",
    )
    .pip_install(
        "opencv-python>=4.9.0.80",
        "diffusers==0.31.0",
        "transformers==4.49.0",
        "tokenizers>=0.20.3",
        "accelerate>=1.1.1",
        "tqdm",
        "imageio",
        "easydict",
        "ftfy",
        "dashscope",
        "imageio-ffmpeg",
        "scikit-image",
        "loguru",
        "gradio>=5.0.0",
        "numpy>=1.23.5,<2",
        "xfuser==0.4.1",
        "pyloudnorm",
        "optimum-quanto==0.2.6",
        "scenedetect",
        "moviepy==1.0.3",
        "decord",
        "pillow",
        "soundfile",
        "librosa",
        "einops",
        "misaki[en]",
        "fastapi[standard]",
    )
    .run_commands(
        # Pin the upstream commit: the in-process shim mirrors this exact code.
        f"git clone --filter=blob:none --no-checkout {REPO_URL} /InfiniteTalk",
    )
    .run_commands(
        f"git -C /InfiniteTalk fetch --depth 1 origin {REPO_SHA}",
        "git -C /InfiniteTalk checkout FETCH_HEAD",
    )
    .add_local_file(
        Path(__file__).resolve().parent / "infinitetalk_shim.py",
        "/root/infinitetalk_shim.py",
        copy=True,
    )
    .run_commands(
        "sed -i 's/from diffusers.models.modeling_utils import no_init_weights, ContextManagers/from transformers.modeling_utils import no_init_weights\\nfrom transformers.utils import ContextManagers/' /InfiniteTalk/wan/multitalk.py",
    )
    .run_commands(
        "sed -i '/from inspect import ArgSpec/d' /InfiniteTalk/wan/multitalk.py",
    )
)

app = modal.App("moneyprint-infinitetalk")


@app.function(
    image=INFINITETALK_IMAGE,
    volumes={"/weights": WEIGHTS_VOLUME},
    secrets=[modal.Secret.from_name("huggingface")],
    timeout=7200,
)
def download_weights() -> str:
    """Download all InfiniteTalk checkpoints into the persistent volume."""
    from huggingface_hub import snapshot_download

    token = os.environ["HF_TOKEN"]
    print("[1/3] downloading Wan2.1-I2V-14B-480P", flush=True)
    snapshot_download(
        repo_id=WAN_REPO,
        local_dir="/weights/Wan2.1-I2V-14B-480P",
        token=token,
    )
    print("[1/3] Wan2.1 complete", flush=True)
    print("[2/3] downloading chinese-wav2vec2-base", flush=True)
    snapshot_download(
        repo_id=WAV2VEC_REPO,
        local_dir="/weights/chinese-wav2vec2-base",
        token=token,
    )
    print("[2/3] Wav2Vec2 complete", flush=True)
    print("[3/3] downloading InfiniteTalk checkpoints", flush=True)
    snapshot_download(
        repo_id=INFINITETALK_REPO,
        local_dir="/weights/InfiniteTalk",
        token=token,
    )
    print("[3/3] InfiniteTalk complete; committing volume", flush=True)
    WEIGHTS_VOLUME.commit()
    count = sum(1 for item in Path("/weights").rglob("*") if item.is_file())
    return f"InfiniteTalk weights ready: {count} files"


def _run_infinitetalk(
    image_bytes: bytes,
    audio_bytes: bytes,
    frames: int,
    sample_steps: int = SAMPLE_STEPS,
    teacache_thresh: float = TEACACHE_THRESH,
    size: str = "infinitetalk-480",
) -> tuple[bytes, dict[str, float | None]]:
    """Generate one InfiniteTalk clip in-process and return a vertical MP4."""
    import infinitetalk_shim

    with tempfile.TemporaryDirectory(prefix="infinitetalk-") as work:
        work_path = Path(work)
        image_path = work_path / "reference.png"
        audio_path = work_path / "voice.wav"
        output_base = work_path / "output"
        image_path.write_bytes(image_bytes)
        audio_path.write_bytes(audio_bytes)

        inference_started = time.monotonic()
        generated = Path(
            infinitetalk_shim.run_inference(
                str(image_path),
                str(audio_path),
                str(output_base),
                work,
                frames,
                sample_steps,
                teacache_thresh,
                size,
                ckpt_dir="/weights/Wan2.1-I2V-14B-480P",
                wav2vec_dir="/weights/chinese-wav2vec2-base",
                infinitetalk_dir="/weights/InfiniteTalk/single/infinitetalk.safetensors",
            )
        )
        inference_finished = time.monotonic()
        if not generated.is_file():
            candidates = sorted(Path("/InfiniteTalk").rglob("*.mp4"), key=lambda p: p.stat().st_mtime)
            if not candidates:
                raise RuntimeError("InfiniteTalk produced no MP4")
            generated = candidates[-1]

        normalized = work_path / "normalized.mp4"
        normalize = [
            "ffmpeg", "-y", "-i", str(generated),
            "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1",
            "-c:v", "libx264", "-crf", "18", "-preset", "medium",
            "-c:a", "aac", "-ar", "24000", "-ac", "1",
            "-movflags", "+faststart", str(normalized),
        ]
        normalize_started = time.monotonic()
        ffmpeg = subprocess.run(normalize, capture_output=True, text=True, timeout=900)
        normalize_finished = time.monotonic()
        if ffmpeg.returncode != 0:
            raise RuntimeError(f"MP4 normalization failed: {ffmpeg.stderr[-2000:]}")
        weights_load_s = 0.0  # Model is loaded in the snapshot enter hook.
        inference_s = inference_finished - inference_started
        return normalized.read_bytes(), {
            "weights_load_s": weights_load_s,
            "inference_s": inference_s,
            "normalize_s": normalize_finished - normalize_started,
        }


def _write_job_status(job_id: str, status: str, details: dict[str, object] | None = None) -> None:
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


@app.cls(
    image=INFINITETALK_IMAGE,
    gpu=GPU,
    volumes={"/weights": WEIGHTS_VOLUME, "/results": RESULTS_VOLUME},
    timeout=7200,
    scaledown_window=60,
    max_containers=1,
)
class GenerateVideoH200:
    @modal.enter()
    def load_model(self) -> None:
        """Load all checkpoints when the H200 container starts."""
        import infinitetalk_shim

        infinitetalk_shim.load_model(
            ckpt_dir="/weights/Wan2.1-I2V-14B-480P",
            wav2vec_dir="/weights/chinese-wav2vec2-base",
            infinitetalk_dir="/weights/InfiniteTalk/single/infinitetalk.safetensors",
            sample_steps=SAMPLE_STEPS,
            teacache_thresh=TEACACHE_THRESH,
            frames=5,
        )

    @modal.method()
    def generate_bytes(
        self,
        job_id: str,
        image_bytes: bytes,
        audio_bytes: bytes,
        frames: int,
        sample_steps: int = SAMPLE_STEPS,
        teacache_thresh: float = TEACACHE_THRESH,
        size: str = "infinitetalk-480",
    ) -> str:
        """Run a persistent generation job independently of the submitting client."""
        output_path = Path("/results") / f"{job_id}.mp4"
        handler_started = time.monotonic()
        handler_started_at = time.time()
        try:
            queued_record = JOB_STATUS.get(job_id)
            if not isinstance(queued_record, dict):
                raise RuntimeError(f"Job status missing for {job_id}")
            submitted_at = float(queued_record.get("submitted_at", time.time()))
            _write_job_status(
                job_id,
                "running",
                {"started_at": handler_started_at, "progress": 10, "phase": "preparing"},
            )
            _write_job_status(job_id, "running", {"progress": 20, "phase": "inference"})
            result, phase_timings = _run_infinitetalk(
                image_bytes,
                audio_bytes,
                frames,
                sample_steps,
                teacache_thresh,
                size,
            )
            output_path.write_bytes(result)
            RESULTS_VOLUME.commit()
            _write_job_status(job_id, "running", {"progress": 95, "phase": "saving"})
            handler_finished = time.monotonic()
            timings: dict[str, float | None] = {
                "queue_wait_s": handler_started_at - submitted_at,
                "container_cold_start_s": handler_started - _CONTAINER_START,
                "weights_load_s": phase_timings["weights_load_s"],
                "inference_s": phase_timings["inference_s"],
                "normalize_s": phase_timings["normalize_s"],
                "total_gpu_s": handler_finished - handler_started,
            }
            _write_job_status(
                job_id,
                "done",
                {
                    "output": str(output_path),
                    "bytes": len(result),
                    "sample_steps": sample_steps,
                    "teacache_thresh": teacache_thresh,
                    "size": size,
                    "timings": timings,
                    "cost_usd": round(timings["total_gpu_s"] * GPU_RATE_USD_S, 4),
                    "progress": 100,
                    "phase": "complete",
                },
            )
            return str(output_path)
        except Exception as error:
            _write_job_status(job_id, "failed", {"error": str(error)})
            raise


@app.function(
    image=INFINITETALK_IMAGE,
    timeout=120,
    secrets=[modal.Secret.from_name("infinitetalk-http")],
)
@modal.fastapi_endpoint(method="POST", label="infinitetalk-http-server-submit")
async def submit_generation(
    request: Request,
    image: UploadFile = File(...),
    audio: UploadFile = File(...),
    quality: str = Form("ok"),
) -> Response:
    """Queue generation and return before GPU inference begins."""
    auth_error = _auth_error()
    if auth_error is not None:
        return auth_error
    bearer_error = _check_bearer(request)
    if bearer_error is not None:
        return bearer_error
    preset = QUALITY_PRESETS.get(quality)
    if preset is None:
        return JSONResponse(
            status_code=400,
            content={"error": "quality must be one of ('ok', 'very-good')"},
        )
    size = preset
    sample_steps = SAMPLE_STEPS
    teacache_thresh = TEACACHE_THRESH
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
    try:
        frames = frames_for_audio_bytes(audio_bytes)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        return JSONResponse(
            status_code=400,
            content={"error": f"could not determine audio duration: {error}"},
        )
    if frames < 5 or (frames - 1) % 4 != 0:
        return JSONResponse(
            status_code=400,
            content={"error": "calculated frames must be 4n+1 and at least 5"},
        )
    submitted_at = time.time()
    await _write_job_status_async(job_id, "pending", {"frames": frames, "sample_steps": sample_steps, "teacache_thresh": teacache_thresh, "size": size, "submitted_at": submitted_at, "progress": 0, "phase": "queued"})
    # ``spawn`` returns immediately with a FunctionCall.  Using ``spawn.aio``
    # here makes the web handler await the remote result and can end in HTTP
    # 500 after the GPU job has already completed.
    call = GenerateVideoH200().generate_bytes.spawn(
        job_id, image_bytes, audio_bytes, frames, sample_steps, teacache_thresh, size,
    )
    await _write_job_status_async(job_id, "queued", {"frames": frames, "sample_steps": sample_steps, "teacache_thresh": teacache_thresh, "size": size, "submitted_at": submitted_at, "call_id": call.object_id, "progress": 0, "phase": "queued"})
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
    image=INFINITETALK_IMAGE,
    timeout=120,
    secrets=[modal.Secret.from_name("infinitetalk-http")],
)
@modal.fastapi_endpoint(method="POST", label="infinitetalk-http-server-status")
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
    image=INFINITETALK_IMAGE,
    volumes={"/results": RESULTS_VOLUME},
    timeout=120,
    secrets=[modal.Secret.from_name("infinitetalk-http")],
)
@modal.fastapi_endpoint(method="POST", label="infinitetalk-http-server-download")
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

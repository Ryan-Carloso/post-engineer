"""Modal CPU workers: one container renders one video, then scales to zero.

The engine on the VPS spawns a task here (app/services/remote_dispatch.py)
instead of rendering it on its own thread. Every function runs the same
entrypoint, ``app.services.remote_worker.run``, which starts a loopback TTS
server in this container and then runs ``app.services.task.start``. The
three functions differ only in resources:

- ``render_faceless``: faceless video, house voice. 1 core, 4 GiB.
- ``render_faceless_clone``: faceless video, Chatterbox Nano clone. 10 GiB.
- ``render_lipsync``: hook or full lip-sync, any voice. 2 cores, 10 GiB.
  It calls LongCat (modal_longcat.py) over HTTP for the face. Capped at 2
  containers because LongCat renders one face at a time; a third job waits
  in Modal's input queue, which is not billed.

No GPU here. ``min_containers`` is 0 everywhere, so an idle worker costs
nothing.

One-time setup (per Modal account):

    uv run modal secret create post-engineer-cpu-worker \\
        SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \\
        R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=...
    uv run modal secret create post-engineer-longcat-client \\
        LONGCAT_SUBMIT_URL=... LONGCAT_STATUS_URL=... \\
        LONGCAT_DOWNLOAD_URL=... LONGCAT_HTTP_SECRET=...
    uv run modal secret create huggingface HF_TOKEN=...
        (may already exist from the LongCat setup; the image build
        downloads the TTS and Whisper weights with it)

On every change to the engine's config.toml, refresh the config secret so
the workers render with the same settings as the engine:

    uv run modal secret create --force post-engineer-engine-config \\
        ENGINE_CONFIG_TOML="$(cat config.toml)"

Deploy (the image build downloads the TTS and Whisper weights once):

    uv run modal deploy modal_cpu_worker.py

Then set ``[modal_worker] app_name`` in the engine's config.toml to
``WORKER_APP_NAME`` and raise ``[app] max_concurrent_tasks`` (see
config.example.toml).

The same file also defines the image-only worker: ``moneyprint-cpu-worker``
with a single ``render_video`` function, spawned by
``app/services/cpu_worker_dispatch.py`` for faceless videos. Its image
comes from ``Dockerfile.cpu-worker`` and its secret is ``cpu-worker``.
``modal deploy`` deploys both apps.
"""

from __future__ import annotations

from pathlib import Path

import modal

from app.services.cpu_worker_dispatch import (
    configured_max_containers,
    worker_app_name,
)

WORKER_APP_NAME = "post-engineer-cpu-worker"
ENGINE_ROOT = "/app"
VOICES_DIR = "/tmp/voices"
TTS_VENV = "/opt/tts"
SCALEDOWN_WINDOW_SECONDS = 10
FACELESS_MAX_CONTAINERS = 30
LIPSYNC_MAX_CONTAINERS = 2
FACELESS_TIMEOUT_SECONDS = 1800
LIPSYNC_TIMEOUT_SECONDS = 14400

_HERE = Path(__file__).resolve().parent

_PREFETCH_TTS = (
    "from huggingface_hub import snapshot_download; "
    "snapshot_download('hexgrad/Kokoro-82M'); "
    "snapshot_download('gradium/phonon-31m-en'); "
    "from chatterbox.tts_turbo import ChatterboxTurboTTS; "
    "ChatterboxTurboTTS.from_pretrained(device='cpu', nano=True)"
)
_PREFETCH_WHISPER = (
    "from faster_whisper import WhisperModel; "
    f"WhisperModel('small', device='cpu', compute_type='int8', download_root='{ENGINE_ROOT}/models')"
)

WORKER_IMAGE = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgomp1", "espeak-ng", "git", "ca-certificates", "tzdata", "curl")
    .run_commands(
        "ln -s \"$(find / -name 'libespeak-ng.so.1' -not -path '/proc/*' | head -n 1)\" /usr/local/lib/libespeak-ng.so.1",
        "ln -s \"$(find /usr -type d -name 'espeak-ng-data' | head -n 1)\" /usr/local/share/espeak-ng-data",
    )
    .pip_install("uv==0.8.24")
    .add_local_file(_HERE / "pyproject.toml", f"{ENGINE_ROOT}/pyproject.toml", copy=True)
    .add_local_file(_HERE / "uv.lock", f"{ENGINE_ROOT}/uv.lock", copy=True)
    .run_commands(
        f"cd {ENGINE_ROOT} && uv export --frozen --no-dev --no-emit-project --no-hashes -o /tmp/engine-requirements.txt",
        "uv pip install --system -r /tmp/engine-requirements.txt",
    )
    .add_local_file(_HERE / "local_tts" / "requirements.txt", "/opt/tts-requirements.txt", copy=True)
    .run_commands(
        f"python -m venv {TTS_VENV}",
        f"{TTS_VENV}/bin/pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu",
        f"{TTS_VENV}/bin/pip install --no-cache-dir -r /opt/tts-requirements.txt",
    )
    .env(
        {
            "HF_HOME": "/models/hf",
            "HF_HUB_DISABLE_TELEMETRY": "1",
            "ESPEAK_NG_LIBRARY": "/usr/local/lib/libespeak-ng.so.1",
            "ESPEAK_NG_DATA": "/usr/local/share/espeak-ng-data",
            "TTS_PYTHON": f"{TTS_VENV}/bin/python",
            "MPT_STATE_BACKEND": "supabase",
            "MPT_STORAGE_DIR": "/tmp/storage",
            "PYTHONPATH": ENGINE_ROOT,
            "TZ": "UTC",
        }
    )
    .run_commands(
        f"{TTS_VENV}/bin/python -c \"{_PREFETCH_TTS}\"",
        f"python -c \"{_PREFETCH_WHISPER}\"",
        secrets=[modal.Secret.from_name("huggingface")],
    )
    .add_local_dir(_HERE / "app", f"{ENGINE_ROOT}/app", copy=True, ignore=["**/__pycache__"])
    .add_local_dir(_HERE / "local_tts", f"{ENGINE_ROOT}/local_tts", copy=True, ignore=["**/__pycache__"])
    .add_local_dir(_HERE / "resource" / "fonts", f"{ENGINE_ROOT}/resource/fonts", copy=True)
    .add_local_dir(_HERE / "resource" / "songs", f"{ENGINE_ROOT}/resource/songs", copy=True)
    .add_local_file(_HERE / "chatterbox_registry_volume.py", f"{ENGINE_ROOT}/chatterbox_registry_volume.py", copy=True)
    .add_local_file(_HERE / "modal_chatterbox_auth.py", f"{ENGINE_ROOT}/modal_chatterbox_auth.py", copy=True)
    .add_local_file(
        _HERE / "modal_chatterbox_registry_routes.py",
        f"{ENGINE_ROOT}/modal_chatterbox_registry_routes.py",
        copy=True,
    )
)

WORKER_SECRETS = [
    modal.Secret.from_name("post-engineer-cpu-worker"),
    modal.Secret.from_name("post-engineer-engine-config"),
]
LIPSYNC_SECRETS = [*WORKER_SECRETS, modal.Secret.from_name("post-engineer-longcat-client")]

app = modal.App(WORKER_APP_NAME)


def _render(task_id: str, payload: dict, stop_at: str) -> None:
    import os
    import sys

    os.chdir(ENGINE_ROOT)
    if ENGINE_ROOT not in sys.path:
        sys.path.insert(0, ENGINE_ROOT)
    from app.services.remote_worker import run

    run(task_id, payload, stop_at, engine_root=Path(ENGINE_ROOT), voices_dir=Path(VOICES_DIR))


@app.function(
    image=WORKER_IMAGE,
    cpu=1.0,
    memory=4096,
    timeout=FACELESS_TIMEOUT_SECONDS,
    min_containers=0,
    max_containers=FACELESS_MAX_CONTAINERS,
    scaledown_window=SCALEDOWN_WINDOW_SECONDS,
    secrets=WORKER_SECRETS,
)
def render_faceless(task_id: str, payload: dict, stop_at: str) -> None:
    """Faceless video with a house voice."""
    _render(task_id, payload, stop_at)


@app.function(
    image=WORKER_IMAGE,
    cpu=1.0,
    memory=10240,
    timeout=FACELESS_TIMEOUT_SECONDS,
    min_containers=0,
    max_containers=FACELESS_MAX_CONTAINERS,
    scaledown_window=SCALEDOWN_WINDOW_SECONDS,
    secrets=WORKER_SECRETS,
)
def render_faceless_clone(task_id: str, payload: dict, stop_at: str) -> None:
    """Faceless video with a Chatterbox Nano clone voice."""
    _render(task_id, payload, stop_at)


@app.function(
    image=WORKER_IMAGE,
    cpu=2.0,
    memory=10240,
    timeout=LIPSYNC_TIMEOUT_SECONDS,
    min_containers=0,
    max_containers=LIPSYNC_MAX_CONTAINERS,
    scaledown_window=SCALEDOWN_WINDOW_SECONDS,
    secrets=LIPSYNC_SECRETS,
)
def render_lipsync(task_id: str, payload: dict, stop_at: str) -> None:
    """Hook or full lip-sync video; LongCat renders the face."""
    _render(task_id, payload, stop_at)


CPU_WORKER_IMAGE = modal.Image.from_dockerfile(
    "Dockerfile.cpu-worker",
    context_dir=".",
)

CPU_WORKER_SECRET = modal.Secret.from_name("cpu-worker")
CPU_WORKER_SECRETS = [CPU_WORKER_SECRET]

cpu_worker_app = modal.App(worker_app_name())

_MAX_CONTAINERS = configured_max_containers()


@cpu_worker_app.function(
    image=CPU_WORKER_IMAGE,
    cpu=1.0,
    memory=10240,
    timeout=1800,
    min_containers=0,
    max_containers=_MAX_CONTAINERS,
    scaledown_window=1,
    secrets=CPU_WORKER_SECRETS,
)
def render_video(task_id: str, params: dict, stop_at: str = "video") -> None:
    """Render one video and exit. One input at a time; the container is not kept warm."""
    from app.services.cpu_worker_run import run_one

    run_one(task_id, params, stop_at)

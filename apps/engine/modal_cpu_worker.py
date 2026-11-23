"""Modal app: one image-only video per CPU container.

Deploy (does not run a render):

    uv run modal deploy modal_cpu_worker.py

``min_containers`` is 0 and there is no warm pool. Modal scales from zero
to ``max_containers`` (default 30, raise with ``MPT_CPU_WORKER_MAX_CONTAINERS``)
and drops idle containers after one second.

Clone WAVs live on the Modal volume ``cpu-worker-voices``, mounted at
``/voices``. ``register_clone`` and ``delete_clone`` write that volume.
``render_video`` reads it. Chatterbox Nano is installed in the image and
loaded only when a job names a ``chatterbox_nano:`` voice. The container
requests 10 GiB so a clone fits.

The secret ``cpu-worker`` must define ``SUPABASE_URL``,
``SUPABASE_SERVICE_ROLE_KEY``, ``R2_ACCOUNT_ID``, ``R2_ACCESS_KEY_ID``,
``R2_SECRET_ACCESS_KEY``, and ``CHATTERBOX_HTTP_SECRET``.

The VPS engine needs ``MODAL_TOKEN_ID`` and ``MODAL_TOKEN_SECRET`` (the
Modal SDK reads them). ``MPT_CPU_WORKER_APP_NAME`` is optional and
defaults to ``moneyprint-cpu-worker``. ``MPT_CPU_WORKER_MAX_CONTAINERS``
is optional and defaults to 30; it may only be raised.
"""

from __future__ import annotations

from pathlib import Path

import modal

from app.services.cpu_worker_dispatch import (
    DEFAULT_APP_NAME,
    VOICES_VOLUME_NAME,
    configured_max_containers,
)

app = modal.App(DEFAULT_APP_NAME)

_MAX_CONTAINERS = configured_max_containers()

VOICES = modal.Volume.from_name(VOICES_VOLUME_NAME, create_if_missing=True)

CPU_WORKER_IMAGE = modal.Image.from_dockerfile(
    "Dockerfile.cpu-worker",
    context_dir=".",
)

_REGISTRY_FILE = Path(__file__).resolve().parent / "chatterbox_registry_volume.py"
REGISTRY_IMAGE = (
    modal.Image.debian_slim(python_version="3.11")
    .add_local_file(str(_REGISTRY_FILE), "/root/chatterbox_registry_volume.py")
)

CPU_WORKER_SECRET = modal.Secret.from_name("cpu-worker")


@app.function(
    image=CPU_WORKER_IMAGE,
    cpu=1.0,
    memory=10240,
    timeout=1800,
    min_containers=0,
    max_containers=_MAX_CONTAINERS,
    scaledown_window=1,
    volumes={"/voices": VOICES},
    secrets=[CPU_WORKER_SECRET],
)
def render_video(task_id: str, params: dict, stop_at: str = "video") -> None:
    """Render one video and exit. One input at a time; the container is not kept warm."""
    import os

    os.environ["TTS_VOICES_DIR"] = "/voices"
    os.environ["MPT_STATE_BACKEND"] = "supabase"
    try:
        VOICES.reload()
    except Exception:
        pass
    from app.services.cpu_worker_run import run_one

    run_one(task_id, params, stop_at)


@app.function(
    image=REGISTRY_IMAGE,
    timeout=120,
    min_containers=0,
    max_containers=4,
    scaledown_window=1,
    volumes={"/voices": VOICES},
)
def register_clone(voice: str, language_id: str, wav_bytes: bytes) -> None:
    """Store one clone reference on the shared volume."""
    from pathlib import Path as FilePath

    from chatterbox_registry_volume import register_voice_on_volume

    VOICES.reload()
    register_voice_on_volume(
        FilePath("/voices"),
        FilePath("/voices/voices.toml"),
        voice,
        language_id,
        wav_bytes,
    )
    VOICES.commit()


@app.function(
    image=REGISTRY_IMAGE,
    timeout=120,
    min_containers=0,
    max_containers=4,
    scaledown_window=1,
    volumes={"/voices": VOICES},
)
def delete_clone(voice: str) -> None:
    """Remove one clone reference from the shared volume."""
    from pathlib import Path as FilePath

    from chatterbox_registry_volume import delete_voice_on_volume

    VOICES.reload()
    delete_voice_on_volume(
        FilePath("/voices"),
        FilePath("/voices/voices.toml"),
        voice,
    )
    VOICES.commit()

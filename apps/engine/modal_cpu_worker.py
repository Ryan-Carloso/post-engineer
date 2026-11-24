"""Modal app: one image-only video per CPU container.

Deploy (does not run a render):

    uv run modal deploy modal_cpu_worker.py

``min_containers`` is 0 and there is no warm pool. Modal scales from zero
to ``max_containers`` (default 30, raise with ``MPT_CPU_WORKER_MAX_CONTAINERS``)
and drops idle containers after one second.

Clone reference audio is already in Supabase Storage (bucket ``personas``,
path ``cloned_voices.storage_path``). The worker downloads it for a
``chatterbox_nano:`` job and keeps it for the life of that container.
Chatterbox Nano is loaded only for those jobs. The container requests
10 GiB so a clone fits.

The secret ``cpu-worker`` must define ``SUPABASE_URL``,
``SUPABASE_SERVICE_ROLE_KEY``, ``R2_ACCOUNT_ID``, ``R2_ACCESS_KEY_ID``,
``R2_SECRET_ACCESS_KEY``, ``CHATTERBOX_HTTP_SECRET``, and ``HF_TOKEN``.
``HF_TOKEN`` is required for the gated Chatterbox Nano download at
clone-job runtime: the image pre-downloads only the house voices.

The VPS engine needs ``MODAL_TOKEN_ID`` and ``MODAL_TOKEN_SECRET``.
``MPT_CPU_WORKER_APP_NAME`` is optional and defaults to
``moneyprint-cpu-worker``. ``MPT_CPU_WORKER_MAX_CONTAINERS`` is optional,
defaults to 30, and may only be raised.
"""

from __future__ import annotations

import modal

from app.services.cpu_worker_dispatch import (
    configured_max_containers,
    worker_app_name,
)

app = modal.App(worker_app_name())

_MAX_CONTAINERS = configured_max_containers()

CPU_WORKER_IMAGE = modal.Image.from_dockerfile(
    "Dockerfile.cpu-worker",
    context_dir=".",
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
    secrets=[CPU_WORKER_SECRET],
)
def render_video(task_id: str, params: dict, stop_at: str = "video") -> None:
    """Render one video and exit. One input at a time; the container is not kept warm."""
    from app.services.cpu_worker_run import run_one

    run_one(task_id, params, stop_at)

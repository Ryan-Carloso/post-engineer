"""Fail a lip-sync job at the start when its persona image cannot be loaded.

The persona image used to be downloaded only after the script, terms, TTS
and stock-video stages had already run, so a dead image URL (HTTP 404/400)
failed the job late, after spending LLM and TTS cost. Downloading it first
fails the job before any of that. The file lands in the task directory and
``full_lipsync.resolve_persona_image`` reuses it, so the image is fetched
once per task.
"""

from app.models.schema import VideoParams
from app.services import full_lipsync
from app.services.lipsync_active import persona_lipsync_active


def preflight_persona_image(task_id: str, params: VideoParams, max_bytes: int) -> None:
    """Download and validate the persona image when lip-sync will need it.

    Raises ``longcat.LongCatError`` (reason already scrubbed of the source
    URL by the SSRF-safe downloader) when the image is unusable; a job
    without an active lip-sync persona is untouched.
    """
    if not persona_lipsync_active(params):
        return
    full_lipsync.resolve_persona_image(task_id, params, max_bytes)

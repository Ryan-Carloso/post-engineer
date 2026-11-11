"""Fail a lip-sync job at the start when its persona image cannot be loaded.

The persona image used to be downloaded only after the script, TTS
and material stages had already run, so a dead image URL (HTTP 404/400)
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

    Raises ``longcat.LongCatError`` when the image is unusable; the reason
    has every URL replaced (``resolve_persona_image`` scrubs it). A job
    without an active lip-sync persona is untouched.

    Intro-only jobs (``full_lipsync`` off) are preflighted too: a dead image
    already failed them whenever the hook was measurable, so failing at the
    start only moves that failure before the spend. The rare job whose hook
    cannot be measured used to ship the normal video without ever touching
    the image; it now fails and is refunded, like every other dead-image job.
    """
    if not persona_lipsync_active(params):
        return
    full_lipsync.resolve_persona_image(task_id, params, max_bytes)

"""Whether a job renders the persona's lip-sync intro.

Extracted from task.py (grandfathered over the file-size cap) so the
segment-media wiring can land without growing it. The rule: a persona
with a visual identity (photo_url OR avatar_url) in a face mode
(full_lipsync or hook_lipsync); voiceover never renders a face, and a
persona without a visual identity has nothing to lip-sync.
"""

from app.config import config
from app.models.schema import VideoParams


def persona_lipsync_active(params: VideoParams) -> bool:
    """True when the job should generate the persona's lip-sync intro."""
    persona = params.persona
    if persona is None or params.video_type == "voiceover":
        return False
    return persona.photo_url is not None or persona.avatar_url is not None


def lip_sync_cap_seconds(params: VideoParams) -> float:
    """Longest narration this job may carry, in seconds.

    Hook lip-sync renders only the intro on the GPU, so its narration is
    capped by the configured ``max_video_duration_seconds`` (default 40s).
    Full lip-sync renders every window on the GPU, up to 5 windows of 12s
    = 60s of narration, so its cap is the full-mode ceiling. One cap per
    mode: a valid 41-60s full-mode job must never be rejected for
    exceeding the hook cap (#534 review).
    """
    if params.video_type == "full_lipsync":
        from app.services import full_lipsync

        return float(full_lipsync.MAX_FULL_LIPSYNC_SECONDS)
    return float(config.app.get("max_video_duration_seconds", 40))

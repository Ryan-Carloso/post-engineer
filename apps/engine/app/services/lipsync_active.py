"""Whether a job renders the persona's lip-sync intro.

Extracted from task.py (grandfathered over the file-size cap) so the
segment-media wiring can land without growing it. The rule: a persona
with a visual identity (photo_url OR avatar_url) in a face mode
(full_lipsync or hook_lipsync); faceless never renders a face, and a
persona without a visual identity has nothing to lip-sync.
"""

from app.models.schema import VideoParams


def persona_lipsync_active(params: VideoParams) -> bool:
    """True when the job should generate the persona's lip-sync intro."""
    persona = params.persona
    if persona is None or params.video_type == "faceless":
        return False
    return persona.photo_url is not None or persona.avatar_url is not None

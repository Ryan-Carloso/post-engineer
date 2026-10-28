"""Whether a job renders the persona's lip-sync intro.

Extracted from task.py (grandfathered over the file-size cap) so the
segment-media wiring can land without growing it. The rule itself is
unchanged: a persona with a visual identity (photo_url OR avatar_url)
AND lipsync_enabled; otherwise the voice only is used, with no face
filter on the material.
"""

from app.models.schema import VideoParams


def persona_lipsync_active(params: VideoParams) -> bool:
    """True when the job should generate the persona's lip-sync intro."""
    persona = params.persona
    if persona is None or not bool(params.lipsync_enabled):
        return False
    return persona.photo_url is not None or persona.avatar_url is not None

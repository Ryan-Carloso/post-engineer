"""Cheap checks run at the very start of a video task, before any cost.

One entry point so task.py (grandfathered over the file-size cap) gains a
single line: the voice is validated first (no network), then the persona
image is downloaded. Each step is its own phase, so a failure is attributed
to ``voice`` or ``persona_image`` — neither is in ``GENERATION_STAGES``, so
the deterministic misconfiguration is failed and refunded, not retried.
"""

from app.models.schema import VideoParams
from app.services import persona_preflight, voice_preflight
from app.services.pipeline_stage import PhaseTracker


# Runs that stop before the audio stage never synthesize speech.
_STOPS_BEFORE_AUDIO = ("script", "terms")


def run(
    phases: PhaseTracker,
    task_id: str,
    params: VideoParams,
    image_max_bytes: int,
    stop_at: str,
) -> None:
    """Validate what the requested run will actually use.

    The voice matters from the audio stage on; the persona image only for a
    full video run (the lip-sync render), so partial runs stay free.
    """
    if stop_at not in _STOPS_BEFORE_AUDIO:
        phases.begin("voice")
        voice_preflight.check_voice(params)
    if stop_at == "video":
        phases.begin("persona_image")
        persona_preflight.preflight_persona_image(task_id, params, image_max_bytes)

"""PostHog tracking props for video tasks.

Builds the small prop dicts the engine attaches to PostHog lifecycle
events and to the task row they are read back from. Pacing props are
typed values (ints and an enum value string), never free text, so they
need no scrubbing and no deliberate-exception registration.
"""

from __future__ import annotations

_IDENTITY_KEYS = ("persona_id", "slot_id", "schedule_id", "generation_id")
_PACING_INT_KEYS = ("video_clip_duration", "video_variation_seed")


def pacing_tracking_props(params: object) -> dict[str, object]:
    """Pacing props from a video request or params object.

    The clip duration is always present on a video request (the schema
    defaults it to 2); the transition mode and the variation seed are
    omitted when unset so PostHog breakdowns stay free of noise.
    Requests without pacing fields (audio, subtitles) carry nothing.
    """
    props: dict[str, object] = {}
    duration = getattr(params, "video_clip_duration", None)
    if isinstance(duration, int) and not isinstance(duration, bool):
        props["video_clip_duration"] = duration
    mode = getattr(params, "video_transition_mode", None)
    if mode is not None:
        value = getattr(mode, "value", mode)
        if isinstance(value, str) and value:
            props["video_transition_mode"] = value
    seed = getattr(params, "video_variation_seed", None)
    if isinstance(seed, int) and not isinstance(seed, bool):
        props["video_variation_seed"] = seed
    return props


def tracking_context_from_task(task: dict[str, object]) -> dict[str, object]:
    """Identity ids and pacing props read back from a task row.

    Optional values are omitted when absent or blank, never recorded
    as empty strings, so PostHog breakdowns stay free of noise.
    Pacing ints also accept their digit-string form, which is how a
    backend that stores values with str() hands them back.
    """
    context: dict[str, object] = {}
    for key in _IDENTITY_KEYS:
        value = task.get(key)
        if isinstance(value, str) and value:
            context[key] = value
    for key in _PACING_INT_KEYS:
        value = task.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, int):
            context[key] = value
        elif isinstance(value, str):
            try:
                context[key] = int(value)
            except ValueError:
                continue
    mode = task.get("video_transition_mode")
    if isinstance(mode, str) and mode:
        context["video_transition_mode"] = mode
    return context


def persona_tracking_kwargs(body: object) -> dict[str, str]:
    """Persona id for the task row, read back by the PostHog tracking context.

    Omitted when the request carries no persona, so the row and the
    events stay free of blank props.
    """
    persona = getattr(body, "persona", None)
    persona_id = getattr(persona, "id", None)
    if isinstance(persona_id, str) and persona_id:
        return {"persona_id": persona_id}
    return {}


def tracking_kwargs(body: object) -> dict[str, object]:
    """Generation and slot ids plus pacing props for the task row.

    Only a video request carries them; omitted when absent so the row
    stays free of blank props. The same dict feeds the requested event,
    so the funnel entry carries the pacing the video was asked for.
    """
    props: dict[str, object] = {
        field: value
        for field in ("generation_id", "slot_id")
        if isinstance((value := getattr(body, field, None)), str) and value
    }
    props.update(pacing_tracking_props(body))
    return props

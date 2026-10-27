"""Script angle: turn a bare topic into one specific, curiosity-driven angle.

Lives outside llm.py / task.py because both are grandfathered over the
file-size cap and may not grow. The llm helpers are reached through the
llm module at call time (deferred import), so tests patching
llm.generate_script_angle / llm._generate_response_with_fallback keep
working exactly as before. That patch point is deliberate: nothing here
may cache an llm function at import time, or the patches would be
bypassed.
"""

from collections.abc import Sequence

from loguru import logger

from app.models.schema import VideoParams
from app.services import web_search_facts
from app.services.analytics import scrub_error_text, scrub_secret_values
from app.services.web_search_facts import Fact


def generate_script_angle(
    video_subject: str, language: str = "", niche: str = "", facts: Sequence[Fact] | None = None
) -> str:
    """Turn a bare topic into one specific, curiosity-driven angle.

    Users only type a topic ("coffee"); scripting the topic directly yields
    generic videos. One cheap call picks a concrete angle ("the mistake
    that makes home coffee bitter") the script is then built around.

    Returns "" when the model gives nothing usable — including total
    provider failure, which the fallback reports as an "Error: ..."
    sentinel instead of raising. The caller decides how to degrade.
    """
    from app.services import llm

    subject = llm._limit_script_text(video_subject, llm.MAX_SCRIPT_PROMPT_LENGTH, "video_subject")
    niche = llm._limit_script_text(niche, llm.MAX_SCRIPT_PROMPT_LENGTH, "niche")
    prompt = f"""You are a short-form video strategist. Given a broad topic, propose ONE
specific angle for a 30 to 40 second vertical video that makes people stop scrolling.

Good angles are concrete and create curiosity: a common mistake, a counterintuitive
fact, a surprising number, a myth to debunk, a before/after, or a "stop doing X".
Avoid vague or generic angles ("the benefits of X", "everything about X").
The angle must be concrete and visual: name the exact dish, object, place or number,
something a viewer can picture. No vague stand-ins ("the famous institution", "this spot").
Never invent names, prices or facts you are not sure are real. Use a proper name (place, brand, person) only when the topic or the web search results give it; otherwise name the dish, object or situation.
Do not mention street addresses or phone numbers, and add no waiting times, crowds or ratings the results do not state.

Topic: {subject}"""
    if niche:
        prompt += f"\nChannel niche: {niche}"
    # Same search the script prompt gets: the angle must not name a place the
    # results do not list (it used to, then overrode the results).
    prompt += web_search_facts.format_facts_block(facts or [])
    if language:
        prompt += f"\nWrite the angle in this language: {language}"
    prompt += (
        "\n\nReturn only the angle as one plain sentence, with no quotes, no "
        "labels and no explanation."
    )

    response = llm._generate_response_with_fallback(prompt=prompt)
    # _generate_response_with_fallback reports total provider failure as an
    # "Error: ..." sentinel string instead of raising; that is never an angle.
    # A genuine model reply literally starting with "Error: " is discarded
    # too — an accepted trade-off of the shared sentinel contract.
    if response.startswith("Error: "):
        return ""
    lines = [line.strip() for line in llm._strip_code_fence(response).splitlines() if line.strip()]
    if not lines:
        return ""
    angle = lines[0].strip("\"'“”«» ")
    if llm._uses_latin_script(language) and llm._find_foreign_script(angle):
        logger.warning("script angle contains foreign-script characters; discarding it")
        return ""
    return llm._limit_script_text(angle, llm.MAX_SCRIPT_ANGLE_LENGTH, "angle")


def resolve_script_angle(
    task_id: str, params: VideoParams, *, track_event, tracking_context, facts: Sequence[Fact] | None = None
) -> str:
    """Pick a specific angle for the topic, or "" to script the bare topic.

    The angle is an enhancement: an LLM failure here degrades to the raw
    topic (loud log + telemetry) instead of failing the user's video. The
    caller's track_event and tracking context are passed in so the events
    keep flowing through the task module's bindings.
    """
    from app.services import llm
    from app.services import state as sm

    niche = params.persona.niche if params.persona is not None else ""
    try:
        angle = llm.generate_script_angle(
            video_subject=params.video_subject,
            language=params.video_language,
            niche=niche,
            facts=facts,
        )
    except Exception as exc:
        logger.warning(
            "script angle generation failed; scripting the bare topic: "
            f"{scrub_error_text(str(exc))}"
        )
        angle = ""
    if not angle:
        track_event("script_angle_fallback", tracking_context)
        return angle
    # The angle is product data the user sees (post detail reads it from the
    # task record) and a dimension to compare against real performance in
    # PostHog. It is model output derived from the user's topic, so the event
    # property passes through the secret scrubber before capture (deliberate
    # exception recorded in analytics.py); the persisted copy stays raw.
    sm.persist_state_update(sm.state, task_id, script_angle=angle)
    track_event(
        "script_angle_generated",
        {**tracking_context, "angle": scrub_secret_values(angle)},
    )
    return angle

import base64
import math
import os.path
import random
import re
from datetime import datetime, timezone
from collections import deque
from os import path
from threading import Lock
from typing import Sequence

from loguru import logger

from app.config import config
from app.models import const
from app.models.schema import VideoConcatMode, VideoParams
from app.services import (
    llm,
    longcat,
    material,
    persona_hook,
    script_angle,
    subtitle,
    twelvelabs,
    video,
    video_storage,
    voice,
    upload_post,
)
from app.services import state as sm
from app.services import longcat_breaker
from app.services.longcat_faceless_fallback import (
    report_longcat_faceless_fallback as _report_longcat_faceless_fallback,
    refund_face_premium as _refund_face_premium,
    render_persona_video,
)
from app.services import persona_image
from app.services import task_webhook
from app.services.pipeline_stage import PhaseTracker
from app.services.intro_cost import IntroCostReport, completion_cost_kwargs, cost_event_props
from app.services.persona_hook import (
    PERSONA_HOOK_MAX_SECONDS,
    PERSONA_HOOK_MIN_SECONDS,
    PERSONA_HOOK_TARGET_WORDS_MAX,
    PERSONA_HOOK_TARGET_WORDS_MIN,
    _discard_stale_subtitle,
    _find_hook_end_seconds,
    _limit_generated_script,
    _regenerate_fitting_hook,
    resolve_exhausted_hook,
)
from app.services.bgm_history import history_repository
from app.services.analytics import scrub_error_text, scrub_secret_values, track_event
from app.services.notify import safe_reason, send_discord, task_failed_msg
from app.utils import file_security, ssrf, utils

#---------------
# Remote material sources, always used in cascade with per-task shuffled
# order (random start for variety, rest as fallback). Fixed — no API field.
#---------------
REMOTE_VIDEO_SOURCES: list[str] = ["pexels", "pixabay", "coverr"]

#---------------
# _fail_task — marks a task FAILED and sends one Discord alert per task.
# Failure sites are scattered (phase helpers mark FAILED and start()
# re-checks), so recent-ids dedupes to one alert per task. The cache is a
# bounded deque; the bound only evicts after MAX_FAILED_ALERTS *other
# distinct* failures, so a same-id retry inside the window still dedupes
# (retries use fresh ids in practice; a restart resets the cache).
# Check-and-add holds a lock so concurrent failures dedupe to one alert.
#---------------
MAX_FAILED_ALERTS = 1000
# The critical section is microseconds; the timeout only matters if a
# thread dies while holding the lock.
_ALERT_LOCK_TIMEOUT_SECONDS = 0.5
_discord_notified_failed_tasks: deque[str] = deque(maxlen=MAX_FAILED_ALERTS)
_discord_notified_failed_tasks_lock = Lock()


#---------------
# Terminal-event emission dedup: the FIRST _fail_task notice for a task
# always emits video_generation_failed, even when FAILED was already
# written; later notices stay deduped. Bounded like the alert cache.
#---------------
MAX_FAILED_EVENT_IDS = 1000
_failed_event_emitted_tasks: deque[str] = deque(maxlen=MAX_FAILED_EVENT_IDS)
_failed_event_emitted_tasks_lock = Lock()


def _should_emit_failed_event(task_id: str) -> bool:
    """Atomically check-and-record ``task_id``; True only on first sight.

    Falls back to emitting (True) if the lock can't be acquired in time —
    a duplicate terminal event is less harmful than a missing one for the
    requested-vs-failed funnel.
    """
    if not _failed_event_emitted_tasks_lock.acquire(timeout=_ALERT_LOCK_TIMEOUT_SECONDS):
        return True
    try:
        if task_id in _failed_event_emitted_tasks:
            return False
        _failed_event_emitted_tasks.append(task_id)
        return True
    finally:
        _failed_event_emitted_tasks_lock.release()


#---------------
# Dispatch-failure emission dedup: the batch dispatch-failure path emits
# video_generation_failed for incidents that never started a task, so it
# must NOT share the pipeline terminal guard above — a transient dispatch
# failure and a later genuine pipeline failure are two real incidents for
# one deterministic id, and both must emit. Trade-off, named:
# video_generation_requested stays deduped for the re-dispatched id, so
# the failure % can briefly exceed 100% in this window.
#---------------
MAX_DISPATCH_FAILED_EVENT_IDS = 1000
_dispatch_failed_event_emitted_tasks: deque[str] = deque(maxlen=MAX_DISPATCH_FAILED_EVENT_IDS)
_dispatch_failed_event_emitted_tasks_lock = Lock()


def _should_emit_dispatch_failed_event(task_id: str) -> bool:
    """Atomically check-and-record ``task_id``; True only on first sight.

    Same fail-open lock semantics as the pipeline guard: a duplicate
    dispatch-failure event is less harmful than a missing one.
    """
    if not _dispatch_failed_event_emitted_tasks_lock.acquire(timeout=_ALERT_LOCK_TIMEOUT_SECONDS):
        return True
    try:
        if task_id in _dispatch_failed_event_emitted_tasks:
            return False
        _dispatch_failed_event_emitted_tasks.append(task_id)
        return True
    finally:
        _dispatch_failed_event_emitted_tasks_lock.release()


#---------------
MAX_REQUESTED_EVENT_IDS = 1000
_requested_event_emitted_tasks: deque[str] = deque(maxlen=MAX_REQUESTED_EVENT_IDS)
_requested_event_emitted_tasks_lock = Lock()


def _should_emit_requested_event(task_id: str) -> bool:
    """Atomically check-and-record ``task_id``; True only on first sight.

    Batch task ids are deterministic (uuid5 per slot), so a crash between
    dispatch and ``update_slot(generating)`` re-dispatches the SAME id on
    the next tick (see ``generate.py`` ``new_task_id``) — without this guard
    the re-dispatch would double-fire ``video_generation_requested`` and
    inflate the failure-% denominator.

    Falls back to emitting (True) if the lock can't be acquired in time —
    a duplicate funnel entry is less harmful than a missing one.
    """
    if not _requested_event_emitted_tasks_lock.acquire(timeout=_ALERT_LOCK_TIMEOUT_SECONDS):
        return True
    try:
        if task_id in _requested_event_emitted_tasks:
            return False
        _requested_event_emitted_tasks.append(task_id)
        return True
    finally:
        _requested_event_emitted_tasks_lock.release()


def _should_send_failure_alert(task_id: str) -> bool:
    """Atomically check-and-record ``task_id``; True only on first sight.

    Waits briefly for the lock so concurrent failures of the same task
    dedupe to a single alert. Falls back to sending (True) if the lock
    can't be acquired in time — missing an alert is worse than a duplicate.
    """
    if not _discord_notified_failed_tasks_lock.acquire(timeout=_ALERT_LOCK_TIMEOUT_SECONDS):
        return True
    try:
        if task_id in _discord_notified_failed_tasks:
            return False
        _discord_notified_failed_tasks.append(task_id)
        return True
    finally:
        _discord_notified_failed_tasks_lock.release()


def _release_failure_alert(task_id: str) -> None:
    """Forget a recorded alert reservation (e.g. the send failed).

    A transient Discord outage must not permanently suppress the alert: the
    next failure notice for the task re-alerts instead of staying silent.
    Uses the same bounded lock acquire as the check-and-add path — an
    unbounded block here could hang the failure-handling thread if a lock
    holder ever died mid-critical-section.
    """
    if not _discord_notified_failed_tasks_lock.acquire(timeout=_ALERT_LOCK_TIMEOUT_SECONDS):
        logger.warning("discord alert reservation for %s not released: lock busy", task_id)
        return
    try:
        try:
            _discord_notified_failed_tasks.remove(task_id)
        except ValueError:
            pass  # already aged out of the bounded cache
    finally:
        _discord_notified_failed_tasks_lock.release()


def _task_already_failed(task_id: str) -> bool:
    """True when the task is already recorded as FAILED.

    Guards the stored error: the first failure's (most specific) message
    must survive generic follow-up notices.
    """
    try:
        task = sm.state.get_task(task_id)
    except Exception:  # noqa: BLE001 — a failed read must not hide the failure
        return False
    return bool(task) and task.get("state") == const.TASK_STATE_FAILED


def _first_http_url(paths: object) -> str | None:
    """First http(s) URL in ``paths`` (local artifact paths are not URLs)."""
    if not isinstance(paths, (list, tuple)):
        return None
    for item in paths:
        if isinstance(item, str) and item.startswith(("http://", "https://")):
            return item
    return None


#---------------
# PostHog lifecycle funnel: video_generation_requested (at acceptance,
# BEFORE the pipeline starts) -> video_generation_started ->
# video_generation_progress (50%/70% only) -> video_generation_failed /
# video_generated. track_event never raises, so telemetry can't break the
# pipeline; task-state reads below degrade to "unknown" instead.
#---------------
# Progress milestones already reported per task. Process-local: direct
# ids are uuid4 (never reused); batch ids are uuid5 and CAN be
# re-dispatched after a crash (see generate.py new_task_id), so emission
# is deduped per process by the bounded guards above and terminal
# transitions pop the entry — no double-report in one process lifetime.
PROGRESS_MILESTONES = (50, 70)
_progress_milestones: dict[str, int] = {}


def _task_tracking_context(task_id: str) -> dict[str, object]:
    """task_id/user_id/flow/pipeline props shared by every lifecycle event,
    plus optional identity props (persona_id/slot_id/schedule_id) when the
    task row carries them.

    Optional IDs are OMITTED when absent or blank — never the "unknown"
    sentinel — so PostHog breakdowns don't fill with noise. Identity props
    (user_id/flow/pipeline) keep the sentinel: a missing user must stay
    distinguishable from "no user recorded".
    """
    try:
        task = sm.state.get_task(task_id) or {}
    except Exception:  # noqa: BLE001 — tracking degrades, the pipeline continues
        task = {}
    context: dict[str, object] = {
        "task_id": task_id,
        # `or` (not a get-default): a row that stored an explicit None
        # must degrade to the sentinel too, never a null prop in PostHog.
        "user_id": task.get("user_id") or "unknown",
        "flow": task.get("flow") or "unknown",
        "pipeline": task.get("pipeline") or "unknown",
    }
    for key in ("persona_id", "slot_id", "schedule_id", "generation_id"):
        value = task.get(key)
        if isinstance(value, str) and value:
            context[key] = value
    return context


def track_generation_requested(
    task_id: str,
    user_id: str,
    flow: str,
    pipeline: str = "video",
    generation_id: str | None = None,
    **extra: object,
) -> None:
    """Report a generation request BEFORE the pipeline starts.

    This is the funnel entry: requested vs failed gives the failure %.
    Called at task acceptance (API controller, batch dispatch) — not when
    the worker thread picks the task up, so "accepted but never ran" is
    visible as requested-without-started.

    Emission is deduped per task id (bounded check-and-record): batch ids
    are deterministic, so a crash re-dispatch must not double-count one
    logical generation.

    ``generation_id`` is the caller's own correlation id (the web's
    video_generations row id). It is stamped as an explicit parameter —
    not just read back from the task row — because requested fires from
    the acceptance callback while the row write may still be racing in
    another thread; the event must not lose the correlation id.
    """
    if not _should_emit_requested_event(task_id):
        return
    properties: dict[str, object] = {
        "task_id": task_id,
        "user_id": user_id,
        "flow": flow,
        "pipeline": pipeline,
        **extra,
    }
    if isinstance(generation_id, str) and generation_id:
        properties["generation_id"] = generation_id
    track_event("video_generation_requested", properties)


def track_generation_started(task_id: str) -> None:
    """Report that the pipeline actually began executing the task."""
    track_event("video_generation_started", _task_tracking_context(task_id))


def _update_task(task_id: str, **kwargs: object) -> None:
    """Write task state; report PostHog progress at the 50%/70% milestones.

    Emits ``video_generation_progress`` only when progress crosses a ``PROGRESS_MILESTONES``
    entry (50, 70) — at most once per task, even on jumps or out-of-order updates; there is
    no event at 100%: completion is covered by the terminal events.
    """
    sm.state.update_task(task_id, **kwargs)
    progress = kwargs.get("progress")
    if not isinstance(progress, (int, float)) or isinstance(progress, bool):
        return
    last = _progress_milestones.get(task_id, 0)
    crossed = [m for m in PROGRESS_MILESTONES if last < m <= progress]
    if not crossed:
        return
    context = _task_tracking_context(task_id)
    context["progress"] = progress
    for milestone in crossed:
        track_event("video_generation_progress", {**context, "milestone": milestone})
    _progress_milestones[task_id] = crossed[-1]


def _complete_task(
    task_id: str,
    params: VideoParams,
    video_url: str | None = None,
    **kwargs: object,
) -> None:
    """Mark a task COMPLETE and fire the terminal webhook (once per task)."""
    # Resilient write: with a network state backend the terminal update can
    # fail, and a lost COMPLETE would leave the row PROCESSING forever.
    sm.persist_state_update(
        sm.state, task_id, state=const.TASK_STATE_COMPLETE, progress=100, **kwargs
    )
    _progress_milestones.pop(task_id, None)
    context = _task_tracking_context(task_id)
    # Batch completions are reported by the fill_schedule reconciler (which
    # also attaches cost_usd). Only a CONFIRMED direct flow reports here: a
    # degraded context (flow "unknown", e.g. the row was deleted mid-flight)
    # may be a batch task, and reporting it too would double count.
    if context.get("flow") == "direct":
        # Private unit-economics metric: PostHog event only, never the API.
        context.update(cost_event_props(kwargs))
        track_event("video_generated", context)
    task_webhook.notify_terminal_task(
        task_id,
        status="completed",
        webhook_url=getattr(params, "webhook_url", None),
        video_url=video_url,
    )


def _fail_task(
    task_id: str,
    error: str,
    params: VideoParams | None = None,
    stage: str | None = None,
    exc: BaseException | None = None,
    **kwargs: object,
) -> None:
    """Mark a task FAILED; fire-and-forget Discord alert (once per task).

    Every call emits a structured Loguru ERROR record (forwarded to
    PostHog by the asgi sink, ERROR+) with the task id, the pipeline
    stage that failed and the error type — so the reason is visible per
    step. The full params are never logged: they may carry secrets,
    signed URLs or tokens.

    The first failure notice records its error and alerts. A later notice
    for an already-failed task only re-asserts the FAILED state — it never
    overwrites the stored error, which is the first, most specific one
    (e.g. "custom audio file is invalid: ..." must survive the generic
    "failed to generate audio" follow-up).
    """
    failed_stage = stage or "unknown"
    error_type = type(exc).__name__ if exc is not None else "TaskError"
    # Bind only safe identifiers: never params, headers, tokens or URLs.
    logger.bind(task_id=task_id, stage=failed_stage, error_type=error_type).error(
        "video task failed at stage {stage}: {error}",
        stage=failed_stage,
        error=error,
    )
    if _task_already_failed(task_id):
        # Resilient write (see _complete_task): a lost FAILED update leaves
        # the row PROCESSING with no failure recorded and no refund.
        sm.persist_state_update(sm.state, task_id, state=const.TASK_STATE_FAILED, **kwargs)
    else:
        sm.persist_state_update(
            sm.state, task_id, state=const.TASK_STATE_FAILED, error=error, **kwargs
        )
    # Terminal either way: drop the milestone cache on every failure
    # notice, including repeats for an already-FAILED task.
    _progress_milestones.pop(task_id, None)
    # The first _fail_task notice always emits the terminal funnel event,
    # even when the state was already FAILED — dedup is by notice, not by
    # state, so no failure is lost from the funnel.
    if _should_emit_failed_event(task_id):
        context = _task_tracking_context(task_id)
        context["stage"] = failed_stage
        # Keep the diagnostic tail and strip local paths; the helper
        # scrubs the full message before truncating so a mid-key cut
        # cannot leave a fragment the pattern can no longer match.
        context["reason"] = scrub_error_text(str(error), max_chars=200)
        track_event("video_generation_failed", context)
    # Terminal webhook (at most once per task, deduped inside): a failing
    # delivery only logs, it never changes the task outcome.
    task_webhook.notify_terminal_task(
        task_id,
        status="failed",
        webhook_url=getattr(params, "webhook_url", None),
        error=error,
    )
    if not _should_send_failure_alert(task_id):
        return
    subject = params.video_subject if params and params.video_subject else ""
    if not send_discord(task_failed_msg(task_id, error, subject)):
        # The alert never went out (network blip, webhook misconfigured):
        # release the reservation so a later failure notice re-alerts.
        _release_failure_alert(task_id)


def persona_lipsync_active(params: VideoParams) -> bool:
    """True when the job should generate the persona's lip-sync intro.

    Requires a persona with a visual identity (photo_url OR avatar_url) AND
    lipsync_enabled. A faceless persona (no visual) — or one with
    lipsync_enabled=False — contributes only the voice and the video is
    rendered normally, with no face filter on the material
    (exclude_faces=False in get_video_materials).
    """
    persona = params.persona
    if persona is None or not bool(params.lipsync_enabled):
        return False
    return persona.photo_url is not None or persona.avatar_url is not None


# Regeneration attempts for an overshooting persona hook before the task
# fails. Each attempt costs one LLM call plus one TTS call; the hook prompt
# already targets the configured window, so retries should be rare.
_PERSONA_HOOK_MAX_RETRIES = 2

# Product-fixed persona pacing ("always this way"): the face-fill outro
# closes the video. Deliberately NOT config-driven — validated against GPU
# intro cost and lipsync quality windows; tunable knobs reopen those
# failure modes. Hook pacing (PERSONA_HOOK_*) lives in persona_hook.py.
# GPU ceiling, not product ceiling: LongCat MAX_SEGMENTS=5 renders 16.52s,
# but a 5-segment render SIGKILLed inside the Modal container on the first
# real run; 12s is the highest segment count observed to survive there.
PERSONA_LIPSYNC_MAX_SECONDS = 12.0
FACE_FILL_MIN_SECONDS = 5.0
FACE_FILL_MAX_SECONDS = 8.0
PERSONA_SELECTIVE_STOCK_MIN_SCORE = 0.3


def _ensure_persona_hook_fits(
    task_id: str,
    params: VideoParams,
    video_script: str,
    audio_file: str | None,
    audio_duration: float | None,
    sub_maker,
    subtitle_path: str,
):
    """Validate the persona hook duration right after subtitles exist.

    The lip-sync intro wants the hook to end inside the configured persona
    hook window. When TTS generated the audio, a mistimed hook is LLM
    variance — regenerate a fitting hook (plus its audio/subtitles) instead
    of failing the whole task, unless it runs past PERSONA_HOOK_HARD_FAIL_SECONDS.
    With custom audio the hook timing is fixed by the user's recording, so a
    mistiming still fails the task as before.

    Returns the (possibly regenerated) script/audio/subtitle tuple. A
    (None, None, None) audio triple means generate_audio already failed the
    task; the caller handles it through the normal audio-failure path.
    """
    if not persona_lipsync_active(params) or sub_maker is None:
        return video_script, audio_file, audio_duration, sub_maker, subtitle_path
    window_min = PERSONA_HOOK_MIN_SECONDS
    window_max = PERSONA_HOOK_MAX_SECONDS
    attempts = _PERSONA_HOOK_MAX_RETRIES + 1
    for attempt in range(attempts):
        try:
            end_seconds = _find_hook_end_seconds(
                video_script, subtitle.file_to_subtitles(subtitle_path)
            )
        except ValueError:
            # Structural hook problem (missing paragraph, no terminal
            # punctuation, hook not found in subtitles): regenerating a
            # shorter hook cannot fix it — fail the task as before.
            raise
        if window_min <= end_seconds <= window_max:
            return video_script, audio_file, audio_duration, sub_maker, subtitle_path
        if attempt + 1 >= attempts:
            resolve_exhausted_hook(end_seconds, window_min, window_max, attempts)
            track_event(
                "persona_hook_best_effort",
                {"task_id": task_id, "hook_end_seconds": round(end_seconds, 2)},
            )
            return video_script, audio_file, audio_duration, sub_maker, subtitle_path
        video_script = _regenerate_fitting_hook(task_id, params, video_script, end_seconds)
        audio_file, audio_duration, sub_maker = generate_audio(task_id, params, video_script)
        if not audio_file:
            return video_script, None, None, None, subtitle_path
        # The retry rewrites the script, so the existing subtitle describes a
        # script that no longer exists. `generate_subtitle` only falls back to
        # whisper when the file is ABSENT (its os.path.exists gate), so leaving
        # it behind makes the edge path write nothing, skips the fallback, and
        # hands the stale timings back for a hook that is not in them.
        _discard_stale_subtitle(subtitle_path)
        subtitle_path = generate_subtitle(task_id, params, video_script, sub_maker, audio_file)
    raise AssertionError("unreachable: hook retry loop always returns or raises")


def _resolve_script_angle(task_id: str, params: VideoParams) -> str:
    """Pick a specific angle for the topic, or "" to script the bare topic.

    The implementation lives in script_angle.py (this module is
    grandfathered over the file-size cap and may not grow); the event sink
    and tracking context stay bound here so callers/tests keep patching
    them on this module.
    """
    return script_angle.resolve_script_angle(
        task_id, params, track_event=track_event, tracking_context=_task_tracking_context(task_id)
    )


def generate_script(task_id, params):
    logger.info("\n\n## generating video script")
    video_script = params.video_script.strip()
    angle = ""
    if not video_script:
        angle = _resolve_script_angle(task_id, params)
        script_prompt = params.video_script_prompt
        if persona_lipsync_active(params):
            # The lip-sync intro paragraph doubles as the retention hook, so
            # the timing contract and the scroll-stopping opener coincide.
            script_prompt = (
                f"Start with a standalone hook paragraph of "
                f"{PERSONA_HOOK_TARGET_WORDS_MIN} to {PERSONA_HOOK_TARGET_WORDS_MAX} words, "
                f"designed to take {PERSONA_HOOK_MIN_SECONDS:g} to {PERSONA_HOOK_MAX_SECONDS:g} "
                "seconds when spoken. This paragraph is the scroll-stopping hook. "
                "End the hook with terminal "
                f"punctuation, then add exactly one blank line before the main content. {script_prompt}"
            ).strip()
        video_script = llm.generate_script(
            video_subject=params.video_subject,
            language=params.video_language,
            paragraph_number=params.paragraph_number,
            video_script_prompt=script_prompt,
            custom_system_prompt=params.custom_system_prompt,
            angle=angle, cta=params.video_cta,
        )
    else:
        # Log only the size — the script itself is user content and must not
        # reach the logs.
        logger.debug(f"video script received: {len(video_script)} characters")

    if persona_lipsync_active(params):
        video_script = _limit_generated_script(video_script)
        paragraphs = [
            paragraph.strip()
            for paragraph in re.split(r"\n\s*\n", video_script)
            if paragraph.strip()
        ]
        if len(paragraphs) < 2 or not re.search(r"[.!?。！？]$", paragraphs[0]):
            logger.warning("persona script has no valid hook; generating hook and body separately")
            hook = llm.generate_script(
                video_subject=params.video_subject,
                language=params.video_language,
                paragraph_number=1,
                video_script_prompt=(
                    f"Regenerate the entire script. "
                    "Return only the standalone first paragraph: a complete "
                    f"{PERSONA_HOOK_MIN_SECONDS:g} to {PERSONA_HOOK_MAX_SECONDS:g} second hook "
                    f"of {PERSONA_HOOK_TARGET_WORDS_MIN} to {PERSONA_HOOK_TARGET_WORDS_MAX} words "
                    f"ending with terminal punctuation. {params.video_script_prompt}"
                ),
                custom_system_prompt=params.custom_system_prompt,
                target_words_min=PERSONA_HOOK_TARGET_WORDS_MIN,
                target_words_max=PERSONA_HOOK_TARGET_WORDS_MAX,
                angle=angle, include_cta=False,
            )
            body = llm.generate_script(
                video_subject=params.video_subject,
                language=params.video_language,
                paragraph_number=1,
                video_script_prompt=(
                    f"Return only the main content "
                    "paragraph that follows the hook. Do not include a heading or "
                    f"repeat the hook. {params.video_script_prompt}"
                ),
                custom_system_prompt=params.custom_system_prompt,
                target_words_min=72,
                target_words_max=94,
                angle=angle, cta=params.video_cta,
            )
            video_script = _limit_generated_script(f"{hook.strip()}\n\n{body.strip()}")
            paragraphs = [paragraph.strip() for paragraph in re.split(r"\n\s*\n", video_script) if paragraph.strip()]
            if len(paragraphs) < 2 or not re.search(r"[.!?。！？]$", paragraphs[0]):
                raise ValueError("persona script failed hook validation after separate regeneration")

    if not video_script:
        _fail_task(task_id, "failed to generate video script", params, stage="script")
        logger.error("failed to generate video script.")
        return None

    return video_script


def generate_terms(task_id, params, video_script):
    logger.info("\n\n## generating video terms")
    video_terms = params.video_terms
    if not video_terms:
        # With ordered material matching enabled, the keywords themselves must
        # also be generated in script narrative order; otherwise later ordered
        # download and ordered concat can only reuse one global theme set and
        # can't fix "later content's visuals appearing early".
        video_terms = llm.generate_terms(
            video_subject=params.video_subject,
            video_script=video_script,
            amount=8 if params.match_materials_to_script else 5,
            match_script_order=params.match_materials_to_script,
        )
    else:
        if isinstance(video_terms, str):
            video_terms = [term.strip() for term in re.split(r"[,，]", video_terms)]
        elif isinstance(video_terms, list):
            video_terms = [term.strip() for term in video_terms]
        else:
            raise ValueError("video_terms must be a string or a list of strings.")

        # Log only the count — the terms themselves are user content and must
        # not reach the logs.
        logger.debug(f"video terms: {len(video_terms)} terms")

    if not video_terms:
        _fail_task(task_id, "failed to generate video terms", params, stage="terms")
        logger.error("failed to generate video terms.")
        return None

    # Optional TwelveLabs Marengo semantic rerank: returns the original order
    # untouched when disabled. In ordered-match mode the keyword order is
    # already the script narrative order and must be preserved, so it is
    # skipped.
    if not params.match_materials_to_script:
        video_terms = twelvelabs.rerank_terms_by_subject(
            video_subject=params.video_subject,
            search_terms=video_terms,
        )

    # Always on, ALL video kinds (not persona-specific): weak terms never
    # reach the download queue. If every term is filtered the original list
    # is kept, so the worst case is the pre-filter behavior.
    video_terms = _filter_weak_stock_terms(params, video_terms)

    return video_terms


def _stock_adhesion_score(term: str, subject: str) -> float:
    """Offline adhesion score between a stock search term and the subject.

    Deterministic token-overlap fallback used when TwelveLabs Marengo
    embeddings are unavailable: the share of the term's significant tokens
    (length >= 3, casefolded, unique) that also appear in the subject. A
    term with no significant tokens scores 0.0 — it says nothing the subject
    confirms, and weak terms are exactly what selective stock drops.
    """
    def tokens(text: str) -> set[str]:
        # Unicode-letter-initial tokens only; short tokens (a, de, o) carry
        # no adhesion signal.
        return {
            token
            for token in re.findall(r"[^\W\d_][\w]*", text.casefold(), re.UNICODE)
            if len(token) >= 3
        }

    term_tokens = tokens(term)
    if not term_tokens:
        return 0.0
    subject_tokens = tokens(subject)
    return len(term_tokens & subject_tokens) / len(term_tokens)


def _filter_weak_stock_terms(params: VideoParams, video_terms: list[str]) -> list[str]:
    """Drop stock terms whose adhesion to the subject scores below the floor.

    Always on: weak stock never enters the download queue, so the timeline
    holds the persona/strong footage instead of swapping frames with
    off-topic B-roll. If every term is filtered, the original list is kept —
    a video with some stock beats a task failure for lack of footage.
    """
    if not params.video_subject or len(video_terms) <= 1:
        return video_terms
    min_score = PERSONA_SELECTIVE_STOCK_MIN_SCORE
    kept = [
        term
        for term in video_terms
        if _stock_adhesion_score(term, params.video_subject) >= min_score
    ]
    if not kept:
        logger.warning(
            "selective stock filtered every term; keeping the original list"
        )
        return video_terms
    dropped = [term for term in video_terms if term not in kept]
    if dropped:
        # Log counts, not term content — terms are user-derived content.
        logger.info(
            f"selective stock kept {len(kept)}/{len(video_terms)} terms "
            f"(min score {min_score}); {len(dropped)} weak terms dropped"
        )
    return kept


def save_script_data(task_id, video_script, video_terms, params):
    script_file = path.join(utils.task_dir(task_id), "script.json")
    script_data = {
        "script": video_script,
        "search_terms": video_terms,
        "params": params,
    }

    with open(script_file, "w", encoding="utf-8") as f:
        f.write(utils.to_json(script_data))


def resolve_custom_audio_file(task_id: str, custom_audio_file: str | None) -> str:
    """Resolve a user-supplied custom audio path inside the allowed directories.

    Only files inside the current task directory or the shared
    ``local_videos`` storage directory are accepted. Absolute paths,
    ``..`` traversal, and symlink escapes pointing elsewhere are rejected
    with ValueError. An empty input resolves to "" (no custom audio).
    """
    requested_file = (custom_audio_file or "").strip()
    if not requested_file:
        return ""

    # Absolute paths are never accepted, even when they happen to land
    # inside an allowed directory: the API contract is basename-only, so a
    # host path must never be echoed back or resolved.
    if os.path.isabs(requested_file):
        raise ValueError(
            f"custom audio file '{requested_file}' must be a file name, not an "
            "absolute path; supply a base name inside the task directory or "
            "local_videos"
        )

    allowed_bases = (
        utils.task_dir(task_id),
        utils.storage_dir("local_videos", create=True),
    )
    not_found = False
    for base_dir in allowed_bases:
        try:
            return file_security.resolve_path_within_directory(
                base_dir,
                requested_file,
            )
        except ValueError as exc:
            # file_security reports a missing file with "does not exist";
            # keep that distinction so the failure message stays helpful.
            if "does not exist" in str(exc):
                not_found = True
            continue
    if not_found:
        raise ValueError(f"custom audio file '{requested_file}' does not exist")
    raise ValueError(
        "custom audio file must be task-local or inside the local_videos "
        "storage directory"
    )


def cleanup_task_intermediates(task_id: str, preserved_paths: Sequence[str]) -> None:
    """Remove task-local files except paths still needed for recovery/publishing."""
    task_directory = path.realpath(utils.task_dir(task_id))
    preserved = {
        path.realpath(file_path)
        for file_path in preserved_paths
        if file_path
    }

    if not path.isdir(task_directory):
        return

    for root, directories, files in os.walk(task_directory, topdown=False):
        for file_name in files:
            file_path = path.realpath(path.join(root, file_name))
            if file_path not in preserved:
                os.remove(file_path)
        for directory_name in directories:
            directory_path = path.join(root, directory_name)
            if not os.listdir(directory_path):
                os.rmdir(directory_path)


def resolve_persona_audio(params: VideoParams) -> tuple[str, str | None]:
    """Resolve the effective voice from the job's inline persona.

    Returns (voice_name, voice_audio). When the persona carries
    ``voice_id``, it overrides ``params.voice_name``; when it carries
    ``voice_audio_url``, the sample is used as custom audio
    (skips TTS). Without a persona, passes through the payload default.
    """
    persona = getattr(params, "persona", None)
    if persona is None:
        return params.voice_name, None

    if persona.voice_audio_url:
        return params.voice_name, persona.voice_audio_url

    if persona.voice_id:
        # Return the RAW house id: generate_audio resolves it through
        # resolve_house_voice_name(name, params.video_language), which is the
        # only place that knows the per-language Neural voice. Expanding it
        # here with HOUSE_VOICE_NAMES pinned every persona to en-US.
        return persona.voice_id, None

    return params.voice_name, None


def generate_audio(task_id, params, video_script):
    '''
    Generate audio for the video script.
    If a custom audio file is provided, it will be used directly.
    There will be no subtitle maker object returned in this case.
    Otherwise, TTS will be used to generate the audio.
    Returns:
        - audio_file: path to the generated or provided audio file
        - audio_duration: duration of the audio in seconds
        - sub_maker: subtitle maker object if TTS is used, None otherwise
    '''
    logger.info("\n\n## generating audio")
    # The /audio and /subtitle request models don't include custom_audio_file;
    # read it defensively here so direct calls don't raise AttributeError.
    requested_custom_audio_file = getattr(params, "custom_audio_file", None)
    try:
        custom_audio_file = resolve_custom_audio_file(
            task_id, requested_custom_audio_file
        )
    except ValueError as exc:
        reason = safe_reason(exc)
        logger.error(
            "custom audio file is invalid, "
            f"task_id: {task_id}, path: {requested_custom_audio_file}, error: {reason}"
        )
        _fail_task(task_id, f"custom audio file is invalid: {reason}", params, stage="custom_audio")
        return None, None, None

    # Persona inline: the house voice overrides voice_name; the user's voice
    # sample becomes custom audio (ignores TTS).
    persona_voice_name, persona_voice_audio = resolve_persona_audio(params)
    if persona_voice_audio and not custom_audio_file:
        try:
            custom_audio_file = _download_persona_voice(task_id, persona_voice_audio)
        except PersonaVoiceError as exc:
            _fail_task(task_id, f"Custom audio rejected: {safe_reason(exc)}", params, stage="custom_audio", exc=exc)
            return None, None, None

    if not custom_audio_file:
        logger.info("no custom audio file provided, using TTS to generate audio.")
        audio_file = path.join(utils.task_dir(task_id), "audio.mp3")
        # Fail fast when nothing resolved to a usable voice name. An empty
        # voice_name (or empty-string persona voice_id) would otherwise reach
        # the provider and burn its retries before dying with a cryptic
        # "voice/subtitle mismatch".
        if not (persona_voice_name or "").strip():
            _fail_task(
                task_id,
                "no voice configured: the persona has no voice_id/voice_audio_url "
                "and no voice_name was provided",
                params,
                stage="audio",
            )
            logger.error(
                f"no voice configured for TTS, task_id: {task_id} "
                "(empty voice name)"
            )
            return None, None, None
        # The voice id goes straight to voice.tts, which routes it to
        # ElevenLabs (`elevenlabs:<id>`) or Chatterbox (`chatterbox:<name>`)
        # and fails loudly on anything else. There is no house-voice
        # resolution step left: the catalog is the provider's own voice list.
        result = voice.tts(
            text=video_script,
            voice_name=voice.parse_voice_name(persona_voice_name),
            voice_rate=params.voice_rate if params.voice_rate is not None else 1.0,
            voice_file=audio_file, language=params.video_language,
            user_id=str((sm.state.get_task(task_id) or {}).get("user_id") or ""), task_id=task_id,
        )
        if not result.ok:
            # Forward the real TTS failure cause to _fail_task (stored error + PostHog reason).
            reason = result.error or "unknown TTS failure"
            _fail_task(task_id, f"failed to generate audio: {reason}", params, stage="audio")
            logger.error(f"failed to generate audio: {reason} "
                         "(check voice name, provider API key, network)")
            return None, None, None
        sub_maker = result.sub_maker
        audio_duration = math.ceil(voice.get_audio_duration(sub_maker))
        if audio_duration == 0:
            _fail_task(task_id, "failed to get audio duration", params, stage="audio")
            logger.error("failed to get audio duration.")
            return None, None, None
        return audio_file, audio_duration, sub_maker
    else:
        logger.info(f"using custom audio file: {custom_audio_file}")
        audio_duration = voice.get_audio_duration(custom_audio_file)
        if audio_duration == 0:
            _fail_task(task_id, "failed to get audio duration from custom audio file", params, stage="audio")
            logger.error("failed to get audio duration from custom audio file.")
            return None, None, None
        return custom_audio_file, audio_duration, None

def generate_subtitle(task_id, params, video_script, sub_maker, audio_file):
    '''
    Generate subtitle for the video script.
    If subtitle generation is disabled or no subtitle maker is provided, it will return an empty string.
    Otherwise, it will generate the subtitle using the specified provider.
    Returns:
        - subtitle_path: path to the generated subtitle file
    '''
    logger.info("\n\n## generating subtitle")
    if not params.subtitle_enabled:
        return ""

    subtitle_path = path.join(utils.task_dir(task_id), "subtitle.srt")
    subtitle_provider = config.app.get("subtitle_provider", "edge").strip().lower()
    logger.info(f"\n\n## generating subtitle, provider: {subtitle_provider}")

    if sub_maker is None and subtitle_provider != "whisper":
        # Custom audio never goes through TTS, so there is no Edge/Azure TTS
        # sub_maker timeline. Only Whisper can transcribe subtitles directly
        # from the audio file; other subtitle providers keep their existing
        # behavior to avoid producing a wrong empty timeline.
        logger.warning(
            "subtitle maker is missing, skip subtitle generation for provider: "
            f"{subtitle_provider}"
        )
        return ""

    subtitle_fallback = False
    if subtitle_provider == "edge":
        voice.create_subtitle(
            text=video_script, sub_maker=sub_maker, subtitle_file=subtitle_path
        )
        if not os.path.exists(subtitle_path):
            subtitle_fallback = True
            logger.warning("subtitle file not found, fallback to whisper")

    if subtitle_provider == "whisper" or subtitle_fallback:
        subtitle.create(audio_file=audio_file, subtitle_file=subtitle_path)
        logger.info("\n\n## correcting subtitle")
        subtitle.correct(subtitle_file=subtitle_path, video_script=video_script)

    subtitle_lines = subtitle.file_to_subtitles(subtitle_path)
    if not subtitle_lines:
        logger.warning(f"subtitle file is invalid: {subtitle_path}")
        return ""

    return subtitle_path


def get_video_materials(task_id, params, video_terms, audio_duration):
    if params.video_materials:
        logger.info("\n\n## preprocess local materials")
        materials = video.preprocess_video(
            materials=params.video_materials, clip_duration=params.video_clip_duration
        )
        if not materials:
            _fail_task(task_id, "no valid materials found", params, stage="materials")
            logger.error(
                "no valid materials found, please check the materials and try again."
            )
            return None
        return [material_info.url for material_info in materials]
    else:
        source_order = list(REMOTE_VIDEO_SOURCES)
        random.shuffle(source_order)
        logger.info(
            f"\n\n## downloading videos from {' -> '.join(source_order)} (random cascade)"
        )
        # Ordered-match mode only applies when explicitly enabled by the user.
        # Force material downloads to round-robin in keyword order so an early
        # keyword can't download too many clips and squeeze later script
        # themes out of the final timeline.
        downloaded_videos = material.download_videos(
            task_id=task_id,
            search_terms=video_terms,
            video_aspect=params.video_aspect,
            video_concat_mode=(
                VideoConcatMode.sequential
                if params.match_materials_to_script
                else params.video_concat_mode
            ),
            audio_duration=audio_duration,
            max_clip_duration=params.video_clip_duration,
            match_script_order=params.match_materials_to_script,
            source_mix=source_order,
            exclude_faces=persona_lipsync_active(params),
        )
        if not downloaded_videos:
            _fail_task(task_id, "failed to download videos", params, stage="download")
            logger.error(
                "failed to download videos, maybe the network is not available. if you are in China, please use a VPN."
            )
            return None
        return downloaded_videos


def generate_final_videos(
    task_id, params, downloaded_videos, audio_file, subtitle_path, video_script, music_mood
) -> tuple[list[str], list[str], IntroCostReport]:
    """Assemble the final videos.

    Returns (final_video_paths, combined_video_paths, intro_report): the
    intro cost outcome (whether it ran, the Modal GPU cost, the job id).
    """
    final_video_paths = []
    combined_video_paths = []
    intro_report = IntroCostReport(ran=False, cost_usd=None, job_id=None)
    # Single output per task. match_materials_to_script forces sequential
    # concatenation (stable, explainable timeline); otherwise, respects the
    # configured concat mode.
    video_concat_mode = (
        VideoConcatMode.sequential
        if params.match_materials_to_script
        else params.video_concat_mode
    )
    video_transition_mode = params.video_transition_mode
    task = sm.state.get_task(task_id)
    user_id = str(task.get("user_id", "internal")) if task else "internal"
    recent_bgm_files = history_repository.recent(user_id)
    bgm_history_count = len(recent_bgm_files)

    combined_video_path = path.join(utils.task_dir(task_id), "combined-1.mp4")
    logger.info(f"\n\n## combining video => {combined_video_path}")
    video.combine_videos(
        combined_video_path=combined_video_path,
        video_paths=downloaded_videos,
        audio_file=audio_file,
        video_aspect=params.video_aspect,
        video_concat_mode=video_concat_mode,
        video_transition_mode=video_transition_mode,
        max_clip_duration=params.video_clip_duration,
        threads=params.n_threads,
    )

    video_for_render = combined_video_path
    if persona_lipsync_active(params):
        video_for_render, intro_report = render_persona_video(
            task_id=task_id,
            params=params,
            audio_file=audio_file,
            combined_video_path=combined_video_path,
            video_script=video_script,
            subtitle_path=subtitle_path,
            task=task,
            user_id=user_id,
            prepare_intro=prepare_persona_lipsync_video,
            apply_face_fill=_apply_persona_face_fill,
        )

    _update_task(task_id, progress=75, music_mood=music_mood)

    final_video_path = path.join(utils.task_dir(task_id), "final-1.mp4")
    logger.info(f"\n\n## generating video => {final_video_path}")
    video.generate_video(
        video_path=video_for_render,
        audio_path=audio_file,
        subtitle_path=subtitle_path,
        output_file=final_video_path,
        params=params,
        music_mood=music_mood,
        recent_bgm_files=recent_bgm_files,
    )
    if len(recent_bgm_files) > bgm_history_count:
        history_repository.record(user_id, recent_bgm_files[-1])

    _update_task(task_id, progress=100, music_mood=music_mood)

    final_video_paths.append(final_video_path)
    combined_video_paths.append(combined_video_path)

    return final_video_paths, combined_video_paths, intro_report


def archive_final_videos(
    task_id: str, final_video_paths: list[str], params: VideoParams
) -> None:
    """Archive each final video to the durable store and VERIFY it landed.

    Only the FINAL videos are uploaded — intermediates (combined-1.mp4),
    caches, and pre-audio renders never leave the local disk.

    R2 is the source of truth for serving: /stream/ and /download/ redirect to
    a signed URL on the archived object and never read the engine's local disk.
    That makes a verified upload a PRECONDITION of a usable video, so an
    unarchived or truncated object is recorded as an explicit
    ``video_storage_error`` instead of being silently ignored. Without this the
    task would look complete with no copy anywhere, and the user would pay for
    a video nobody can open.

    On success the object path is stored in ``video_storage_path``.
    """
    if not final_video_paths:
        return
    task = sm.state.get_task(task_id) or {}
    user_id = str(task.get("user_id") or "internal")
    folder = video_storage.persona_folder(task, params)
    for video_path in final_video_paths:
        object_path = video_storage.storage_object_path(user_id, folder, task_id)
        stored = video_storage.upload_final_video(object_path, str(video_path))
        if stored:
            _update_task(task_id, video_storage_path=stored)
        else:
            # Loud and persisted: the video exists only on ephemeral local disk.
            # Edge case: if a run archives more than one final video and some
            # succeed, the task row ends up with BOTH video_storage_path and
            # video_storage_error set. /stream/ + /download/ prefer the
            # archived copy; the error records which object failed to verify.
            # Normal workflows produce exactly one final video, so this is
            # informational, not actionable.
            logger.error(
                f"archive_final_videos: no verified archive for task {task_id} "
                f"(candidate={object_path}); video is NOT servable from storage"
            )
            _update_task(task_id, video_storage_error=object_path)


def prepare_persona_lipsync_video(
    task_id: str,
    params: VideoParams,
    audio_file: str,
    background_video: str,
    index: int,
    video_script: str,
    subtitle_path: str,
) -> tuple[str, float | None, str | None]:
    """Generate the persona intro through a complete hook paragraph.

    Returns (output_path, intro_cost_usd, intro_job_id): the Modal GPU cost
    in USD (None when the job reports no cost) and the Modal job id.
    """
    persona = params.persona
    if persona is None:
        raise longcat.LongCatError("lip sync requires a persona")
    image_url = persona.avatar_url or persona.photo_url
    if not image_url:
        raise longcat.LongCatError("lip sync requires a persona image")

    task_dir = utils.task_dir(task_id)
    image_path = path.join(task_dir, "persona-lipsync-image.png")
    if image_url.startswith("data:image/"):
        try:
            encoded = image_url.split(",", 1)[1]
            with open(image_path, "wb") as image_file:
                image_file.write(base64.b64decode(encoded))
        except (IndexError, ValueError) as exc:
            raise longcat.LongCatError("invalid persona image data URI") from exc
    else:
        # SSRF-safe download: public-address check on every redirect hop,
        # streamed body with a 20 MB cap, and image/* content-type required.
        # Rejections raise LongCatError and fail the task: the post was
        # priced with the face, so it never renders without the intro.
        try:
            ssrf.download_public_file(
                persona_image.resolve_persona_image_url(image_url),
                image_path,
                what="persona image",
                max_bytes=_PERSONA_IMAGE_MAX_BYTES,
                allowed_content_types=("image/",),
                timeout=60,
                tls_verify=config.app.get("tls_verify", True),
            )
        except ssrf.UnsafeUrlError as exc:
            raise longcat.LongCatError(
                f"persona image download rejected: {exc}"
            ) from exc
        except OSError as exc:
            raise longcat.LongCatError(
                f"persona image download failed: {exc}"
            ) from exc

    subtitles = subtitle.file_to_subtitles(subtitle_path)
    # Measure only: a hook that missed the quality window already shipped
    # best-effort upstream — re-validating the window here would fail the
    # video for the same mistiming. The GPU ceiling below still applies.
    hook_duration = _find_hook_end_seconds(video_script, subtitles)
    # Explicit GPU-ceiling guard: the hook is measured, not window-checked,
    # above (a mistimed hook ships best-effort), so an oversized intro
    # degrades to the normal video here instead of SIGKILLing inside the
    # Modal container past the LongCat segment ceiling (pinned by
    # test_hook_constants_stay_inside_the_gpu_ceiling).
    persona_hook.ensure_hook_within_lipsync_ceiling(hook_duration, PERSONA_LIPSYNC_MAX_SECONDS)
    lipsync_path = path.join(task_dir, f"lipsync-intro-{index}.mp4")
    _, intro_cost_usd, intro_job_id = longcat.generate_intro(
        image_path=image_path,
        audio_path=audio_file,
        quality=params.video_quality,
        output_path=lipsync_path,
        duration_seconds=hook_duration,
    )
    output_path = path.join(task_dir, f"combined-lipsync-{index}.mp4")
    return (
        video.compose_lipsync_layout(
            background_video,
            lipsync_path,
            output_path,
            duration=hook_duration,
            layout=params.video_layout.value,
        ),
        intro_cost_usd,
        intro_job_id,
    )


def _face_fill_tail_seconds(
    subtitles: Sequence[tuple[int, str, str]],
    video_duration: float,
) -> tuple[float, float] | None:
    """Tail (start, duration) for the face-fill outro, snapped to subtitles.

    The slot is chosen on the VIDEO timeline: the muxed narration starts at
    video second 0, so a boundary B on the video is also B on the audio —
    slicing the tail audio at B and rendering lipsync for [B, V] keeps the
    mouth in sync with the muxed voiceover. Boundaries only come from
    subtitle event starts (never mid-word). Among the valid windows
    (FACE_FILL_MIN_SECONDS..FACE_FILL_MAX_SECONDS, after the hook) the one
    closest to the window midpoint wins. Returns None when no valid
    boundary exists.
    """
    min_seconds = FACE_FILL_MIN_SECONDS
    max_seconds = FACE_FILL_MAX_SECONDS
    events: list[tuple[float, float]] = []
    for _, timing, _text in subtitles:
        match = re.search(
            r"(\d+):(\d+):(\d+)[,\.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,\.](\d+)",
            timing,
        )
        if match is None:
            continue
        g = [int(x) for x in match.groups()]
        start = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
        end = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
        if end > start:
            events.append((start, end))
    if not events:
        return None
    # The hook boundary is the end of the first subtitle event; a
    # single-event video has no separate body to protect.
    hook_end = events[0][1] if len(events) >= 2 else 0.0
    target = (min_seconds + max_seconds) / 2
    best: tuple[float, float] | None = None
    for start, _end in events:
        tail = video_duration - start
        if not min_seconds <= tail <= max_seconds:
            continue
        # The tail must not eat the hook: keep >=1s of body between them.
        if start <= hook_end + 1.0:
            continue
        if best is None or abs(tail - target) < abs(best[1] - target):
            best = (start, tail)
    return best


def _apply_persona_face_fill(
    task_id: str,
    params: VideoParams,
    video_file: str,
    audio_file: str,
    subtitle_path: str,
    index: int,
) -> str:
    """Close the video with a lipsync outro instead of trailing stock.

    Experimental face-fill: after the intro splice, the last subtitle-
    bounded segment of the VIDEO timeline is re-rendered as a second
    LongCat segment and spliced over the background tail. The slot is
    cut on the video timeline (not the audio's) so the muxed voiceover —
    which starts at video second 0 — stays lip-synced. When the tail window
    can't be derived the video is returned untouched. EVERY failure is
    swallowed with a logged warning: a complete intro-only video already
    exists, so a face-fill problem (Modal down, unreadable file, ffmpeg
    error) must degrade to the intro-only video, never fail the task.
    The accepted trade-off: a slow Modal backend can still hold the task
    for up to the configured LongCat timeout before the fallback
    kicks in — no separate timeout knob is added (product-fixed pacing).
    """
    try:
        filled = _build_persona_face_fill(
            task_id=task_id,
            params=params,
            video_file=video_file,
            audio_file=audio_file,
            subtitle_path=subtitle_path,
            index=index,
        )
    except longcat.LongCatUnavailableError:
        raise
    except Exception as exc:  # noqa: BLE001 — best-effort by contract
        logger.error(
            f"face-fill skipped after error (keeping intro-only video): "
            f"{scrub_secret_values(str(exc))[:500]}"
        )
        return video_file
    return video_file if filled is None else filled


def _build_persona_face_fill(
    task_id: str,
    params: VideoParams,
    video_file: str,
    audio_file: str,
    subtitle_path: str,
    index: int,
) -> str | None:
    """Build the face-fill outro; return None when no slot/image exists."""
    subtitles = subtitle.file_to_subtitles(subtitle_path)
    video_duration = video.video_duration_seconds(video_file)
    tail = _face_fill_tail_seconds(subtitles, video_duration)
    if tail is None:
        return None
    tail_start, tail_seconds = tail
    task_dir = utils.task_dir(task_id)
    image_path = path.join(task_dir, "persona-lipsync-image.png")
    if not os.path.isfile(image_path):
        logger.warning("face-fill skipped: persona image not found on disk")
        return None
    tail_audio = path.join(task_dir, f"tail-audio-{index}.mp3")
    longcat.trim_audio(
        audio_file,
        tail_audio,
        duration_seconds=tail_seconds,
        padding_seconds=0.2,
        start_seconds=tail_start,
    )
    lipsync_path = path.join(task_dir, f"lipsync-outro-{index}.mp4")
    longcat.generate_intro(
        image_path=image_path,
        audio_path=tail_audio,
        quality=params.video_quality,
        output_path=lipsync_path,
        duration_seconds=tail_seconds,
    )
    output_path = path.join(task_dir, f"combined-lipsync-outro-{index}.mp4")
    return video.replace_video_outro_with_lipsync(
        video_file,
        lipsync_path,
        output_path,
        duration=tail_seconds,
    )


def start(task_id, params: VideoParams, stop_at: str = "video"):
    logger.info(f"start task: {task_id}, stop_at: {stop_at}")
    music_mood = "pending"
    final_video_paths: list[str] = []
    # Phase tracking lives in app/services/pipeline_stage.py (this file is
    # grandfathered and must not grow): the tracker separates the current
    # phase (failure attribution) from the last completed phase (progress).
    phases = PhaseTracker(
        task_id, persist=lambda phase: sm.state.update_task(task_id, stage=phase)
    )

    try:
        if stop_at == "video":
            video_storage.require_r2_configuration()
        _update_task(task_id, state=const.TASK_STATE_PROCESSING, progress=5)
        track_generation_started(task_id)

        # 1. Generate script
        phases.begin("script")
        video_script = generate_script(task_id, params)
        phases.complete("script")
        if not video_script or "Error: " in video_script:
            _fail_task(task_id, "failed to generate video script", params, stage="script")
            cleanup_task_intermediates(task_id, ())
            return

        _update_task(task_id, state=const.TASK_STATE_PROCESSING, progress=10)

        if stop_at == "script":
            _complete_task(task_id, params, script=video_script)
            return {"script": video_script}

        # 2. Generate terms
        video_terms = ""
        if not params.video_materials:
            phases.begin("terms")
            video_terms = generate_terms(task_id, params, video_script)
            phases.complete("terms")
            if not video_terms:
                _fail_task(task_id, "failed to generate video terms", params, stage="terms")
                cleanup_task_intermediates(task_id, ())
                return

        save_script_data(task_id, video_script, video_terms, params)

        if stop_at == "terms":
            _complete_task(task_id, params, terms=video_terms)
            return {"script": video_script, "terms": video_terms}

        _update_task(task_id, state=const.TASK_STATE_PROCESSING, progress=20)

        # 3. Generate audio
        phases.begin("audio")
        audio_file, audio_duration, sub_maker = generate_audio(
            task_id, params, video_script
        )
        phases.complete("audio")
        if not audio_file:
            _fail_task(task_id, "failed to generate audio", params, stage="audio")
            cleanup_task_intermediates(task_id, ())
            return

        max_duration = int(config.app.get("max_video_duration_seconds", 40))
        if (
            persona_lipsync_active(params)
            and audio_duration is not None
            and audio_duration > max_duration
        ):
            limited_audio_file = path.join(
                utils.task_dir(task_id), "audio-limited.mp3"
            )
            longcat.trim_audio(
                audio_file,
                limited_audio_file,
                duration_seconds=max_duration,
            )
            audio_file = limited_audio_file
            audio_duration = max_duration

        _update_task(task_id, state=const.TASK_STATE_PROCESSING, progress=30)

        if stop_at == "audio":
            _complete_task(
                task_id, params, video_url=_first_http_url([audio_file]),
                audio_file=audio_file,
            )
            return {"audio_file": audio_file, "audio_duration": audio_duration}

        # 4. Generate subtitle
        phases.begin("subtitle")
        subtitle_path = generate_subtitle(
            task_id, params, video_script, sub_maker, audio_file
        )
        phases.complete("subtitle")

        if stop_at == "subtitle":
            _complete_task(task_id, params, subtitle_path=subtitle_path)
            return {"subtitle_path": subtitle_path}

        # 4b. Persona hook guard: the lip-sync intro needs the hook to end
        # between 3 and 6 seconds. Validate now — before the expensive
        # material/download/combine stages — and regenerate an overshooting
        # hook instead of failing the whole task. A ValueError here keeps
        # the previous behavior: the task fails with the hook error.
        script_before_hook_guard = video_script
        (
            video_script,
            audio_file,
            audio_duration,
            sub_maker,
            subtitle_path,
        ) = _ensure_persona_hook_fits(
            task_id, params, video_script, audio_file, audio_duration,
            sub_maker, subtitle_path,
        )
        if not audio_file:
            _fail_task(task_id, "failed to generate audio", params, stage="audio")
            cleanup_task_intermediates(task_id, ())
            return
        if video_script != script_before_hook_guard:
            save_script_data(task_id, video_script, video_terms, params)

        _update_task(task_id, state=const.TASK_STATE_PROCESSING, progress=40)

        # 5. Get video materials
        phases.begin("materials")
        downloaded_videos = get_video_materials(
            task_id, params, video_terms, audio_duration
        )
        phases.complete("materials")
        if not downloaded_videos:
            _fail_task(task_id, "failed to download videos", params, stage="download")
            cleanup_task_intermediates(task_id, ())
            return

        if stop_at == "materials":
            _complete_task(task_id, params, materials=downloaded_videos)
            return {"materials": downloaded_videos}

        _update_task(task_id, state=const.TASK_STATE_PROCESSING, progress=50)

        available_moods = video.get_available_music_moods()
        logger.info(f"available BGM moods for video: {available_moods}")
        phases.begin("music_mood")
        music_mood = llm.generate_music_mood(video_script, available_moods)
        sm.state.update_task(task_id, music_mood=music_mood)
        phases.complete("music_mood")
        logger.info(f"music mood selected for video: {music_mood}")

        # Only the full video pipeline needs the video concat mode handling;
        # this keeps /subtitle and /audio style requests from touching
        # fields that don't exist.
        if type(params.video_concat_mode) is str:
            params.video_concat_mode = VideoConcatMode(params.video_concat_mode)

        # 6. Generate final videos (marked first: a crash reports stage=render)
        phases.begin("render")
        phases.complete("render")
        final_video_paths, combined_video_paths, intro_report = generate_final_videos(
            task_id,
            params,
            downloaded_videos,
            audio_file,
            subtitle_path,
            video_script,
            music_mood,
        )

        if not final_video_paths:
            _fail_task(task_id, "failed to generate final videos", params, stage="render")
            cleanup_task_intermediates(task_id, ())
            return

        # Durable copy of the final video in R2 before
        # publishing: local disk is ephemeral, a restart must not lose it.
        archive_final_videos(task_id, final_video_paths, params)

        # Publishing now happens exclusively through the fill-schedule slot
        # worker (apps/engine/app/services/fill_schedule/publish.py): the
        # task completes here and the slot publisher posts at slot time.

        logger.success(
            f"task {task_id} finished, generated {len(final_video_paths)} videos."
        )

        # 7. Cross-post to social platforms (if enabled)
        cross_post_results = []
        if upload_post.upload_post_service.is_configured() and upload_post.upload_post_service.auto_upload:
            platforms = upload_post.upload_post_service.platforms
            logger.info(f"\n\n## cross-posting videos to {', '.join(platforms)}")

            youtube_extra = None
            if any(p.startswith("youtube") for p in platforms):
                metadata = llm.generate_social_metadata(
                    video_subject=params.video_subject,
                    video_script=video_script,
                    language=params.video_language or "",
                    platform="youtube_shorts",
                )
                youtube_extra = {
                    "youtube_title": metadata.get("title", params.video_subject),
                    "youtube_description": metadata.get("caption", ""),
                    "tags": metadata.get("hashtags", []),
                    "privacyStatus": upload_post.upload_post_service.youtube_privacy_status,
                    "containsSyntheticMedia": True,
                }

            for video_path in final_video_paths:
                current_task = sm.state.get_task(task_id) or {}
                object_path = current_task.get("video_storage_path")
                if not isinstance(object_path, str) or not object_path:
                    raise RuntimeError(
                        f"task {task_id} has no verified R2 video archive for cross-posting"
                    )
                video_bytes = video_storage.read_final_video_r2(object_path)
                result = upload_post.cross_post_video(
                    video_path=video_path,
                    title=params.video_subject or "Check out this video! #shorts #viral",
                    video_bytes=video_bytes,
                    youtube_extra=youtube_extra,
                )
                cross_post_results.append(result)
                if result.get('success'):
                    logger.info(f"✅ Cross-posted: {video_path}")
                else:
                    logger.warning(f"⚠️ Failed to cross-post: {video_path} - {result.get('error', 'Unknown error')}")

        kwargs = {
            "videos": final_video_paths,
            "combined_videos": combined_video_paths,
            "script": video_script,
            "terms": video_terms,
            "audio_file": audio_file,
            "audio_duration": audio_duration,
            "platform_ids": params.platform_ids,
            "video_quality": params.video_quality.value,
            "subtitle_path": subtitle_path,
            "materials": downloaded_videos,
            "music_mood": music_mood,
            "cross_post_results": cross_post_results if cross_post_results else None,
        }
        # Private unit-economics metric: persisted on the task row so the
        # batch reconciler can attach it to the PostHog video_generated
        # event (or record WHY it is missing). The API layer strips it from
        # every response — it is never visible to users, only in the
        # operator's PostHog.
        kwargs.update(completion_cost_kwargs(task_id, intro_report))
        _complete_task(
            task_id, params,
            video_url=_first_http_url(final_video_paths),
            **kwargs,
        )
        try:
            completed_task = sm.state.get_task(task_id) or {}
            archived = bool(completed_task.get("video_storage_path")) and not bool(
                completed_task.get("video_storage_error")
            )
            cleanup_task_intermediates(
                task_id, [] if archived else final_video_paths
            )
        except OSError as cleanup_error:
            logger.warning(
                "failed to clean task intermediates for %s: %s",
                task_id,
                cleanup_error,
            )
        return kwargs
    except Exception as exc:
        logger.exception("task %s crashed", task_id)
        _fail_task(task_id, safe_reason(exc), params, stage=phases.current, exc=exc, music_mood=music_mood)
        try:
            cleanup_task_intermediates(task_id, final_video_paths)
        except OSError as cleanup_error:
            logger.warning(
                "failed to clean task intermediates for failed task %s: %s",
                task_id,
                cleanup_error,
            )
        return


if __name__ == "__main__":
    task_id = "task_id"
    params = VideoParams(
        video_subject="金钱的作用",
        voice_name="zh-CN-XiaoyiNeural-Female",
        voice_rate=1.0,
    )
    start(task_id, params, stop_at="video")


# Limits for the persona lipsync reference image downloaded by URL.
_PERSONA_IMAGE_MAX_BYTES = 20 * 1024 * 1024  # 20 MB cap for the avatar/photo

# Limits for the persona voice sample downloaded by URL (custom audio_url).
# The 60s max duration is a temporary product limit ("for now").
PERSONA_VOICE_MAX_BYTES = 20 * 1024 * 1024  # 20 MB — fits 1 min of uncompressed audio
PERSONA_VOICE_MAX_SECONDS = 60
_PERSONA_VOICE_MAX_REDIRECTS = 5
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}


class PersonaVoiceError(ValueError):
    """Friendly reason (user-facing) why the persona voice URL was rejected."""


def _assert_public_url(url: str) -> None:
    """Ensure the URL points to a public address (anti-SSRF).

    Shared helper: blocks non-http(s) schemes, literal private IPs,
    hostnames resolving to private IPs, and hosts that don't resolve
    (closed failure). Raises PersonaVoiceError.
    """
    try:
        ssrf.assert_public_url(url, what="Audio URL")
    except ssrf.UnsafeUrlError as exc:
        raise PersonaVoiceError(str(exc)) from exc


def _probe_persona_voice_duration(audio_path: str) -> float | None:
    """Return the duration in seconds if ffprobe detects at least one audio stream.

    Returns None when the file isn't a valid audio (no audio stream,
    invalid duration, or ffprobe failed).
    """
    import json
    import subprocess

    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                audio_path,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        info = json.loads(result.stdout or "{}")
    except Exception as exc:
        logger.error(
            "ffprobe failed on persona voice audio, "
            f"path: {audio_path}, error: {str(exc)}"
        )
        return None
    streams = info.get("streams") or []
    if not any(s.get("codec_type") == "audio" for s in streams):
        return None
    try:
        duration = float((info.get("format") or {}).get("duration", 0))
    except (TypeError, ValueError):
        return None
    if not math.isfinite(duration) or duration <= 0:
        return None
    return duration


def _download_persona_voice(task_id: str, voice_audio_url: str) -> str:
    """Download the persona voice sample (signed URL) into the task dir.

    Stateless: the file lives only for the video generation.

    Only accepts a real audio file (audio stream detected by ffprobe),
    at most PERSONA_VOICE_MAX_SECONDS seconds and
    PERSONA_VOICE_MAX_BYTES bytes, served from a public address (anti-SSRF).
    Any violation raises PersonaVoiceError and cleans up the partial file.
    """
    import requests as http_client
    from urllib.parse import urljoin

    audio_file = path.join(utils.task_dir(task_id), "persona_voice")

    def _cleanup_partial() -> None:
        try:
            if os.path.exists(audio_file):
                os.remove(audio_file)
        except OSError:
            pass

    def _reject(reason: str) -> PersonaVoiceError:
        logger.error(
            f"rejected persona voice audio: {reason}, task_id: {task_id}"
        )
        _cleanup_partial()
        return PersonaVoiceError(reason)

    try:
        # Redirects followed manually to validate each destination (anti-SSRF).
        current_url = voice_audio_url
        for hop in range(_PERSONA_VOICE_MAX_REDIRECTS + 1):
            _assert_public_url(current_url)
            response = http_client.get(
                current_url, timeout=60, stream=True, allow_redirects=False
            )
            location = response.headers.get("location")
            if response.status_code in _REDIRECT_STATUSES and location:
                response.close()
                if hop == _PERSONA_VOICE_MAX_REDIRECTS:
                    raise _reject("audio URL redirected too many times")
                current_url = urljoin(current_url, location)
                continue
            break
        else:
            raise _reject("audio URL redirected too many times")

        response.raise_for_status()
        content_type = (
            (response.headers.get("content-type") or "").split(";")[0].strip().lower()
        )
        if not content_type.startswith("audio/"):
            raise _reject(
                f"not an audio file (content-type: {content_type or 'unknown'})"
            )
        downloaded = 0
        with open(audio_file, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                if not chunk:
                    continue
                downloaded += len(chunk)
                if downloaded > PERSONA_VOICE_MAX_BYTES:
                    raise _reject(
                        f"exceeds the {PERSONA_VOICE_MAX_BYTES // 1024 // 1024} MB size limit"
                    )
                f.write(chunk)
    except PersonaVoiceError:
        raise
    except Exception as exc:
        raise _reject(f"could not be downloaded ({exc}") from exc

    duration = _probe_persona_voice_duration(audio_file)
    if duration is None:
        raise _reject("not a valid audio file (no audio stream detected)")
    if duration > PERSONA_VOICE_MAX_SECONDS:
        raise _reject(
            f"is {duration:.0f}s long — the limit is {PERSONA_VOICE_MAX_SECONDS} seconds"
        )
    return audio_file


def download_persona_voice(task_id: str, voice_audio_url: str) -> str | None:
    """Wrap _download_persona_voice returning None on any rejection.

    Kept for compatibility — the friendly error goes to the log; the
    user-visible reason is recorded by the caller (generate_audio).
    """
    try:
        return _download_persona_voice(task_id, voice_audio_url)
    except PersonaVoiceError as exc:
        logger.error(f"rejected persona voice audio, task_id: {task_id}, reason: {exc}")
        return None
    except Exception as exc:
        logger.error(f"failed to download persona voice audio, task_id: {task_id}, error: {exc}")
        return None

"""LongCat workspace-disabled fallback: deliver faceless, warn, refund.

Extracted from task.py so the file-size ratchet stays at the grandfathered
line count. Direct unit tests live in test_longcat_faceless_fallback.py.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from loguru import logger

from app.models.schema import VideoParams
from app.services import longcat, longcat_breaker, persona_hook, state as sm
from app.services.analytics import scrub_error_text, track_event
from app.services.intro_cost import IntroCostReport

AVATAR_DISABLED_WARNING_CODE = "avatar_disabled"


def _discord_notify(message: str) -> None:
    """One operator-facing Discord ping (DISCORD_WEBHOOK_URL)."""
    from app.services import notify as notify_module

    try:
        notify_module.send_discord(message)
    except Exception as exc:  # noqa: BLE001 — the alert is best-effort
        logger.warning(f"discord billing alert failed: {exc}")


def report_longcat_faceless_fallback(
    task_id: str,
    task: dict[str, object],
    user_id: str,
    params: VideoParams | None = None,
) -> None:
    """Deliver the video faceless when the Modal backend is billing-dead.

    Behavior SPLIT by user (Ryan's 2026-10-25 decision):

    - TEST accounts (TEST_ACCOUNT_USER_IDS): informative
      `longcat_fallback_faceless` event (1/day) plus persisted breaker trip.
    - REAL users: always retry LongCat next dispatch; loud ERROR + Discord
      1/hour. Both paths set user_warning_codes [avatar_disabled] and refund
      the face premium the way it was charged.
    """
    from app.services.fill_schedule.support import FACELESS_PRICE, token_cost

    now = datetime.now(timezone.utc)
    if longcat_breaker.is_test_account(user_id):
        if longcat_breaker.should_emit_event(now):
            track_event(
                "longcat_fallback_faceless",
                {
                    "task_id": task_id,
                    "user_id": user_id,
                    "reason": "workspace_disabled",
                },
                immediate=False,
            )
        if not longcat_breaker.trip(now, "workspace_disabled"):
            logger.warning(
                "longcat breaker trip did not persist (marker write failed)"
            )
    elif longcat_breaker.should_alert(now):
        logger.error(
            "MODAL BILLING ALERT — Modal workspace disabled hits REAL users; "
            f"task {task_id} delivered faceless. Top up the Modal credits "
            "(they return on the 1st) to restore the avatar intro."
        )
        _discord_notify(
            (
                "🚨 Modal workspace disabled (LongCat): REAL users' videos are "
                f"losing the avatar intro (task {task_id}). Top up the Modal "
                "credits to restore it."
            ),
        )
    sm.persist_state_update(
        sm.state, task_id, user_warning_codes=[AVATAR_DISABLED_WARNING_CODE]
    )
    stored = sm.state.get_task(task_id) or task or {}
    face_quality = _face_quality(stored, params)
    premium = token_cost(False, face_quality) - FACELESS_PRICE
    refund_face_premium(task_id, premium)


def _quality_token(raw: object) -> str | None:
    value = getattr(raw, "value", raw)
    if not isinstance(value, str):
        return None
    normalized = value.replace("-", "_").strip().lower()
    if normalized == "very_good":
        return "very_good"
    return None


def _face_quality(task: dict[str, object], params: VideoParams | None = None) -> str:
    candidates: list[object] = []
    if params is not None:
        candidates.append(getattr(params, "video_quality", None))
    nested = task.get("params")
    if isinstance(nested, dict):
        candidates.append(nested.get("video_quality"))
        candidates.append(nested.get("face_quality"))
    candidates.append(task.get("video_quality"))
    candidates.append(task.get("face_quality"))
    candidates.append(task.get("post_face_quality"))
    for raw in candidates:
        token = _quality_token(raw)
        if token is not None:
            return token
    return "ok"


def _batch_generation_id(task: dict[str, object]) -> str | None:
    generation_id = str(task.get("generation_id", "") or "")
    if not generation_id.startswith("batch:"):
        schedule_id = str(task.get("schedule_id", "") or "")
        slot_id = str(task.get("slot_id", "") or "")
        if not schedule_id or not slot_id:
            return None
        generation_id = f"batch:{schedule_id}:slot:{slot_id}"
    if generation_id.count(":") < 2:
        return None
    return generation_id


def refund_face_premium(task_id: str, premium: int) -> None:
    """Refund the face/premium difference for BATCH-prefunded tasks."""
    task = sm.state.get_task(task_id) or {}
    generation_id = _batch_generation_id(task)
    if generation_id is None:
        return
    batch_generation_id = "batch:" + generation_id.split(":")[1]
    user_id = str(task.get("user_id", "") or "")
    try:
        from app.services.fill_schedule.store import ScheduleStore

        refunded = ScheduleStore().refund_batch_tokens(
            user_id,
            batch_generation_id,
            f"{generation_id}:shortface",
            premium,
            (
                "LongCat unavailable (Modal workspace disabled); video "
                "delivered without the face intro"
            ),
            engine_task_id=task_id,
        )
        if refunded:
            logger.info(
                f"refund landed for the face premium of task {task_id} ({premium} tokens)"
            )
    except Exception as inner_exp:  # noqa: BLE001 — refund is best-effort here
        logger.error(
            "refund_batch_tokens failed for task "
            f"{task_id} face premium: {scrub_error_text(str(inner_exp))}"
        )


PrepareIntro = Callable[..., tuple[str, float | None, str | None]]
ApplyFaceFill = Callable[..., str]


def render_persona_video(
    *,
    task_id: str,
    params: VideoParams,
    audio_file: str,
    combined_video_path: str,
    video_script: str,
    subtitle_path: str,
    task: dict[str, Any] | None,
    user_id: str,
    prepare_intro: PrepareIntro,
    apply_face_fill: ApplyFaceFill,
) -> tuple[str, IntroCostReport]:
    """Intro + optional face-fill, or faceless fallback on LongCat outage."""
    logger.info("generating persona lip-sync intro")
    faceless_fallback = False
    video_for_render = combined_video_path
    intro_report = IntroCostReport(ran=False, cost_usd=None, job_id=None)
    if longcat_breaker.is_test_account(user_id) and longcat_breaker.is_open(
        datetime.now(timezone.utc)
    ):
        faceless_fallback = True
        logger.warning(
            "LongCat breaker open (Modal workspace disabled) — rendering "
            f"task {task_id} faceless without asking the backend"
        )
        report_longcat_faceless_fallback(task_id, task or {}, user_id, params)
    else:
        try:
            video_for_render, intro_cost_usd, intro_job_id = prepare_intro(
                task_id=task_id,
                params=params,
                audio_file=audio_file,
                background_video=combined_video_path,
                index=1,
                video_script=video_script,
                subtitle_path=subtitle_path,
            )
        except longcat.LongCatUnavailableError:
            faceless_fallback = True
            report_longcat_faceless_fallback(task_id, task or {}, user_id, params)
        except persona_hook.HookExceedsLipsyncCeiling as exc:
            persona_hook.report_lipsync_intro_skipped(task_id, exc.hook_end_seconds)
        else:
            intro_report = IntroCostReport(
                ran=True, cost_usd=intro_cost_usd, job_id=intro_job_id
            )
    if not faceless_fallback:
        try:
            video_for_render = apply_face_fill(
                task_id=task_id,
                params=params,
                video_file=video_for_render,
                audio_file=audio_file,
                subtitle_path=subtitle_path,
                index=1,
            )
        except longcat.LongCatUnavailableError:
            # Intro already contains the avatar: keep it. Do not mark
            # avatar_disabled and do not refund the face premium.
            logger.warning(
                "face-fill skipped after LongCat unavailable "
                f"(keeping intro-only video) task {task_id}"
            )
    return video_for_render, intro_report

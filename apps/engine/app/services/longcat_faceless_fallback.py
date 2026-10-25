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
from app.services.analytics import track_event
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
    task_id: str, task: dict[str, object]
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

    user_id = str(task.get("user_id", "internal")) if task else "internal"
    now = datetime.now(timezone.utc)
    if longcat_breaker.is_test_account(user_id):
        if longcat_breaker.should_emit_event(now):
            track_event(
                "longcat_fallback_faceless",
                {"task_id": task_id, "reason": "workspace_disabled"},
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
    premium = token_cost(False, "ok") - FACELESS_PRICE
    refund_face_premium(task_id, premium)


def refund_face_premium(task_id: str, premium: int) -> None:
    """Refund the face/premium difference for BATCH-prefunded tasks."""
    task = sm.state.get_task(task_id) or {}
    generation_id = str(task.get("generation_id", "") or "")
    if not generation_id.startswith("batch:") or generation_id.count(":") < 2:
        return
    rpc = getattr(sm.state, "_rpc", None)
    if not callable(rpc):
        return
    batch_generation_id = "batch:" + generation_id.split(":")[1]
    user_id = str(task.get("user_id", "") or "")
    try:
        result = rpc(
            "refund_batch_tokens",
            {
                "p_user_id": user_id,
                "p_batch_generation_id": batch_generation_id,
                "p_refund_key": f"{generation_id}:shortface",
                "p_amount": premium,
                "p_reason": (
                    "LongCat unavailable (Modal workspace disabled); video "
                    "delivered without the face intro"
                ),
                "p_engine_task_id": task_id,
            },
        )
        refunded = bool((result.json() or {}).get("refunded"))
        if refunded:
            logger.info(
                f"refund landed for the face premium of task {task_id} ({premium} tokens)"
            )
    except Exception as inner_exp:  # noqa: BLE001 — refund is best-effort here
        logger.error(
            f"refund_batch_tokens failed for task {task_id} face premium: {inner_exp}"
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
        report_longcat_faceless_fallback(task_id, task or {})
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
            report_longcat_faceless_fallback(task_id, task or {})
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
            # Intro already landed: keep it, set the same warning, refund
            # once (report is idempotent by refund key).
            report_longcat_faceless_fallback(task_id, task or {})
    return video_for_render, intro_report

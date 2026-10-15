"""Intro GPU-cost outcome reporting for completed video tasks.

The persona lip-sync intro runs on a Modal GPU backend that reports its
cost on the completed job. That cost is a private unit-economics metric:
it rides the video_generated PostHog event (and the task row the batch
reconciler reads) but the API layer strips it from every response.

When a completed video has no cost to report, the reason travels with the
event instead, so "the video legitimately had no intro step" (no_intro)
and "the intro ran but the backend reported no cost"
(intro_no_cost_reported) never look identical in PostHog. The latter also
logs a warning with the task and job ids — a silent gap there means the
metric pipeline needs attention.
"""

from collections.abc import Mapping
from typing import NamedTuple

from loguru import logger


class IntroCostReport(NamedTuple):
    """Cost outcome of the persona lip-sync intro step.

    ran: True when the intro step executed. cost_usd: the Modal GPU cost in
    USD reported by the completed job (None when the job reported no cost).
    job_id: the Modal job id (None when the intro never ran).
    """

    ran: bool
    cost_usd: float | None
    job_id: str | None


# Why a completed video's video_generated event carries no cost_usd.
COST_MISSING_NO_INTRO = "no_intro"
COST_MISSING_NO_COST_REPORTED = "intro_no_cost_reported"
COST_MISSING_REASONS = frozenset({COST_MISSING_NO_INTRO, COST_MISSING_NO_COST_REPORTED})


def completion_cost_kwargs(
    task_id: str, intro: IntroCostReport
) -> dict[str, object]:
    """Cost telemetry kwargs for a completed task.

    Returns {"cost_usd": ...} when the intro reported a GPU cost; otherwise
    {"cost_missing_reason": ...} recording WHY the cost is missing. The
    caller persists these on the task row, which feeds both the direct
    video_generated event and the batch reconciler.
    """
    if intro.cost_usd is not None:
        return {"cost_usd": intro.cost_usd}
    reason = COST_MISSING_NO_COST_REPORTED if intro.ran else COST_MISSING_NO_INTRO
    if intro.ran:
        logger.warning(
            f"task {task_id} intro finished but the GPU backend reported "
            f"no cost (job_id={intro.job_id})"
        )
    return {"cost_missing_reason": reason}


def cost_event_props(source: Mapping[str, object]) -> dict[str, object]:
    """video_generated cost properties from a task row or completion kwargs.

    Returns {"cost_usd": ...} when a valid cost is present, else
    {"cost_missing_reason": ...} when the reason is a known value, else {}.
    Unknown reasons are dropped rather than leaked into PostHog.
    """
    cost = source.get("cost_usd")
    if isinstance(cost, (int, float)) and not isinstance(cost, bool):
        return {"cost_usd": float(cost)}
    reason = source.get("cost_missing_reason")
    if reason in COST_MISSING_REASONS:
        return {"cost_missing_reason": reason}
    return {}

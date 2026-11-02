"""Intro GPU-cost outcome reporting for completed video tasks.

The persona lip-sync intro runs on a Modal GPU backend that reports its
cost on the completed job. That cost is a private unit-economics metric:
it rides the video_generated PostHog event (and the task row the batch
reconciler reads) but the API layer strips it from every response.

``cost_usd`` is the MARGINAL handler cost of one clip only — handler entry
to exit. It is NEVER the total cost of a video. The total is computed
here, in :func:`completion_cost_kwargs`, as:

    total_cost_usd = handler_total
        + (container_cost_usd + scaledown_cost_usd) / videos_per_container

where ``container_cost_usd`` is the container-to-date spend reported by
the backend at the intro job's completion (cold-start weight load plus
handler time to date), ``scaledown_cost_usd`` is one scaledown hold, and
``videos_per_container`` counts DISTINCT videos (tasks), not clips: a
video that renders several clips in one container counts once, because
the shared container spend belongs to the video, not to each clip.

The total is labelled ``running``, never final: at video completion the
container may serve more videos later, which would lower every earlier
video's share. A container-exit final event (final container spend plus
final video count) is the documented follow-up; it needs a push channel
the backend does not have today, so it is not pretended here.

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

from app.services.longcat_cost import ModalJobCost


class IntroCostReport(NamedTuple):
    """Cost outcome of the persona lip-sync intro step.

    ran: True when the intro step executed. cost_usd: the Modal GPU cost in
    USD reported by the completed job (None when the job reported no cost).
    job_id: the Modal job id (None when the intro never ran).
    container_cost_usd / container_uptime_s / container_id /
    jobs_served_in_container / scaledown_cost_usd: the container snapshot
    reported by the backend at the intro job's completion (all None when
    the backend did not report them, e.g. an older deployment).
    handler_costs_usd: handler costs for this video's clips, when a caller
    knows more than one (intro + outro + full-mode windows). Empty means
    "only cost_usd is known", which is the intro-only behaviour today.
    """

    ran: bool
    cost_usd: float | None
    job_id: str | None
    container_cost_usd: float | None = None
    container_uptime_s: float | None = None
    container_id: str | None = None
    jobs_served_in_container: int | None = None
    scaledown_cost_usd: float | None = None
    handler_costs_usd: tuple[float, ...] = ()


# Why a completed video's video_generated event carries no cost_usd.
COST_MISSING_NO_INTRO = "no_intro"
COST_MISSING_NO_COST_REPORTED = "intro_no_cost_reported"
COST_MISSING_REASONS = frozenset({COST_MISSING_NO_INTRO, COST_MISSING_NO_COST_REPORTED})

# Label for every total_cost_usd this module emits. "running" means the
# container may still serve more videos, so the amortised share may fall.
# No other label is emitted today; a container-exit final event would
# introduce "final", and must not reuse this label for a different meaning.
TOTAL_COST_LABEL_RUNNING = "running"
TOTAL_COST_LABELS = frozenset({TOTAL_COST_LABEL_RUNNING})

# Distinct videos (tasks) seen per container id, in this engine process.
# A set, not a counter: a video rendering several clips in one container
# counts once, and a task completing twice (retry) must not double-count.
# Process-local by design — an engine restart resets the registry, so the
# first video after a restart amortises over fewer videos than the
# container really served, and its total is conservatively high.
_CONTAINER_VIDEOS: dict[str, set[str]] = {}


def register_container_video(container_id: str, task_id: str) -> int:
    """Record one video served by a container; return its video count."""
    videos = _CONTAINER_VIDEOS.setdefault(container_id, set())
    videos.add(task_id)
    return len(videos)


def amortize_video_cost(
    handler_total_usd: float | None,
    container_cost_usd: float | None,
    scaledown_cost_usd: float | None,
    videos_per_container: int,
) -> float | None:
    """Amortised total cost for one video, or None when unknowable.

    Shared spend (container-to-date + one scaledown hold) is divided by
    the number of distinct videos the container served, never by clips.
    Returns None — never a handler-only figure dressed as a total — when
    any input is missing, non-numeric, or bool, or the video count is
    not positive (bool is an int subclass, so True must not read as 1).
    """
    handler = _valid_number(handler_total_usd)
    container = _valid_number(container_cost_usd)
    scaledown = _valid_number(scaledown_cost_usd)
    videos = _valid_int(videos_per_container)
    if handler is None or container is None or scaledown is None:
        return None
    if videos is None or videos <= 0:
        return None
    shared = container + scaledown
    return round(handler + shared / videos, 4)


def report_from_job_cost(
    cost_usd: float | None,
    job_id: str | None,
    job_cost: ModalJobCost | None,
) -> IntroCostReport:
    """Build an IntroCostReport from one LongCat job's cost snapshot.

    ``job_cost`` is None only when the caller has no snapshot at all; for
    an older backend (or a job that reported no snapshot) it is a snapshot
    whose fields are None — that is the signal, never a None snapshot.
    A missing snapshot never breaks a video that already rendered.
    Handler costs stay as cost_usd alone here — multi-clip callers pass
    handler_costs through IntroCostReport directly.
    """
    if job_cost is None:
        return IntroCostReport(ran=True, cost_usd=cost_usd, job_id=job_id)
    return IntroCostReport(
        ran=True,
        cost_usd=cost_usd,
        job_id=job_id,
        container_cost_usd=job_cost.container_cost_usd,
        container_uptime_s=job_cost.container_uptime_s,
        container_id=job_cost.container_id,
        jobs_served_in_container=job_cost.jobs_served_in_container,
        scaledown_cost_usd=job_cost.scaledown_cost_usd,
    )


def completion_cost_kwargs(
    task_id: str, intro: IntroCostReport
) -> dict[str, object]:
    """Cost telemetry kwargs for a completed task.

    Returns {"cost_usd": ...} when the intro reported a GPU cost; otherwise
    {"cost_missing_reason": ...} recording WHY the cost is missing. The
    caller persists these on the task row, which feeds both the direct
    video_generated event and the batch reconciler.

    When the intro report also carries a container snapshot, the total
    (handler + amortised shared spend, labelled "running") is added under
    total_cost_usd, together with the container fields that produced it.
    When no container snapshot exists, the return is exactly the old
    {"cost_usd": ...} — the handler figure is never presented as a total.
    """
    if intro.cost_usd is None:
        reason = COST_MISSING_NO_COST_REPORTED if intro.ran else COST_MISSING_NO_INTRO
        if intro.ran:
            logger.warning(
                f"task {task_id} intro finished but the GPU backend reported "
                f"no cost (job_id={intro.job_id})"
            )
        return {"cost_missing_reason": reason}
    kwargs: dict[str, object] = {"cost_usd": intro.cost_usd}
    if intro.container_id is not None:
        handler_total = (
            sum(intro.handler_costs_usd)
            if intro.handler_costs_usd
            else intro.cost_usd
        )
        videos = register_container_video(intro.container_id, task_id)
        total = amortize_video_cost(
            handler_total,
            intro.container_cost_usd,
            intro.scaledown_cost_usd,
            videos,
        )
        if total is not None:
            kwargs.update(
                {
                    "total_cost_usd": total,
                    "total_cost_label": TOTAL_COST_LABEL_RUNNING,
                    "container_cost_usd": intro.container_cost_usd,
                    "container_uptime_s": intro.container_uptime_s,
                    "container_id": intro.container_id,
                    "jobs_served_in_container": intro.jobs_served_in_container,
                    "scaledown_cost_usd": intro.scaledown_cost_usd,
                    "videos_per_container": videos,
                }
            )
    return kwargs


def _valid_number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _valid_int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value


def cost_event_props(source: Mapping[str, object]) -> dict[str, object]:
    """video_generated cost properties from a task row or completion kwargs.

    Returns {"cost_usd": ...} when a valid cost is present, else
    {"cost_missing_reason": ...} when the reason is a known value, else {}.
    Unknown reasons are dropped rather than leaked into PostHog. When the
    source also carries a computed total, its fields ride along — each
    validated individually, so one bad field never drops the rest.
    """
    props: dict[str, object] = {}
    cost = source.get("cost_usd")
    if isinstance(cost, (int, float)) and not isinstance(cost, bool):
        props["cost_usd"] = float(cost)
    else:
        reason = source.get("cost_missing_reason")
        if reason in COST_MISSING_REASONS:
            props["cost_missing_reason"] = reason
        return props
    total = _valid_number(source.get("total_cost_usd"))
    if total is not None:
        props["total_cost_usd"] = total
    label = source.get("total_cost_label")
    if label in TOTAL_COST_LABELS:
        props["total_cost_label"] = label
    for key in ("container_cost_usd", "container_uptime_s", "scaledown_cost_usd"):
        value = _valid_number(source.get(key))
        if value is not None:
            props[key] = value
    container_id = source.get("container_id")
    if isinstance(container_id, str) and container_id:
        props["container_id"] = container_id
    for key in ("jobs_served_in_container", "videos_per_container"):
        value = _valid_int(source.get(key))
        if value is not None:
            props[key] = value
    return props

"""Restart orphaned direct generations after engine state exists.

``triage_redispatch_direct`` only marks the task and records a pending
job. The ASGI startup hook reconciles orphans (after
``app.services.state.state`` exists) and then calls
``start_pending_direct_redispatches``, through the shared task manager.
The review must not start the pipeline: it used to run inside
``SupabaseTaskState.__init__``, before that binding existed, and
``tm.start`` reads it.

Clearing ``stage`` is deliberate. A restart that dies before the pipeline
writes a new generation stage (crash between the mark and startup, a
pipeline-import or queue-full failure, or a crash inside ``tm.start``
before phases begin) is fail+refunded on the next boot instead of
redispatched again. An early crash is treated as deterministic. Attempts
that do reach a stage still count against ``MAX_AUTO_REQUEUES``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from loguru import logger
from pydantic import ValidationError

from app.controllers.manager.base_manager import TaskQueueFullError
from app.models import const
from app.models.schema import TaskVideoRequest
from app.services.analytics import track_event
from app.services.orphan_requeue import GENERATION_STAGES, MAX_AUTO_REQUEUES


@dataclass(frozen=True)
class _DirectRedispatch:
    """A direct orphan marked during boot review, started after state exists."""

    task_id: str
    request: TaskVideoRequest
    publish_mode: str
    stage: str
    requeue_count: int


# Filled by the boot reconcile and drained later in the same ASGI startup
# hook. Process local. Review already wrote stage=None and the requeue
# counter, so a crash before the drain is not retried: the next boot sees
# no generation stage and fail+refunds.
_pending_direct_redispatches: list[_DirectRedispatch] = []


def _direct_generation_row(state: Any, task_id: str) -> dict[str, Any] | None:
    """Fetch the video_generations row backing an orphaned direct task.

    Returns the row when it exists, is non-terminal, and carries the
    persisted job payload (issue #205). Returns None otherwise — never
    raises: without a usable row the orphan falls through to fail+refund.
    """
    try:
        response = state._request(
            "GET",
            f"engine_task_id=eq.{state._eq(task_id)}"
            "&select=params,publish_mode,status"
            "&order=created_at.asc",
            table="video_generations",
        )
        rows = response.json()
    except Exception as exc:  # noqa: BLE001 - loud; the non-terminal task retries next boot
        logger.warning(f"orphan {task_id}: video_generations lookup failed: {exc}")
        return None
    if not rows:
        return None
    row = rows[0]
    if not isinstance(row, dict):
        return None
    if row.get("status") in ("failed", "completed"):
        # Already settled (failed+refunded, or proof of delivery marked it
        # complete): re-dispatching would double-run a finished generation.
        return None
    if not isinstance(row.get("params"), dict):
        # Snapshot-only row (written before issue #205): the real params
        # died with the old process, so there is nothing to rebuild from.
        return None
    return row


def triage_redispatch_direct(state: Any, task_id: str, data: dict[str, Any]) -> bool:
    """Mark an orphaned direct generation for restart from its persisted params.

    Direct tasks (no slot_id on the row) whose full job payload was
    persisted on the video_generations row (issue #205) are claimed here:
    the task row goes back to PROCESSING/0 and the validated payload is
    recorded for ``start_pending_direct_redispatches``. This function does
    not start the pipeline. ``tm.start`` reads ``app.services.state.state``.
    The review used to run inside ``SupabaseTaskState.__init__``, before
    that name was assigned, so a thread started here could die with
    AttributeError and leave the task PROCESSING with no worker. The
    boot reconcile now runs from startup, after the binding exists; the
    start still waits for ``start_pending_direct_redispatches``.

    The slot binding (scheduled_posts.task_id) and the video_generations
    row are untouched, so the tick reconciler advances the slot when the
    task finishes. No billing change: the generation was prepaid at
    request time.

    Batch slots stay owned by triage_requeue; non-video pipelines and
    unvalidatable payloads keep the historical fail+refund.

    Returns True when the orphan was claimed (the caller must NOT
    fail+refund it).
    """
    if data.get("slot_id"):
        return False
    if data.get("stage") not in GENERATION_STAGES:
        return False
    if (data.get("pipeline") or "video") != "video":
        # Only full video pipelines are rebuildable: the persisted row
        # carries a TaskVideoRequest payload.
        return False
    row = _direct_generation_row(state, task_id)
    if row is None:
        return False
    requeue_count = int(data.get("requeue_count") or 0) + 1
    if requeue_count > MAX_AUTO_REQUEUES:
        logger.warning(
            f"orphan {task_id}: direct redispatch cap reached "
            f"({MAX_AUTO_REQUEUES}); leaving for fail+refund"
        )
        return False
    try:
        request = TaskVideoRequest.model_validate(row["params"])
    except ValidationError as exc:
        # Deterministic: the persisted payload can never validate (schema
        # drift or a corrupt row). Fail+refund instead of retrying it on
        # every boot forever.
        logger.error(f"orphan {task_id}: persisted params invalid: {exc}")
        return False
    publish_mode = str(row.get("publish_mode") or "unknown")
    stage = str(data.get("stage") or "unknown")
    # Persist the attempt BEFORE anything that can fail to start the
    # pipeline. Importing app.services.task here used to run inside
    # SupabaseTaskState.__init__; an import error skipped this write, so
    # the same task retried on every boot without counting. The worker
    # starts later, from startup_event, once state is bound.
    state.update_task(
        task_id,
        state=const.TASK_STATE_PROCESSING,
        progress=0,
        # Clear the stale pre-crash phase (a poll would keep reporting
        # e.g. "audio" at 0% until the pipeline re-marks). stage=None is
        # not a generation stage: a restart that dies before the pipeline
        # writes one (crash inside tm.start before phases.begin) is
        # failed+refunded on the next boot instead of redispatched again.
        # An early crash is treated as deterministic; attempts that do
        # reach a stage still count against MAX_AUTO_REQUEUES.
        stage=None,
        auto_requeued=True,
        requeue_count=requeue_count,
    )
    _pending_direct_redispatches.append(
        _DirectRedispatch(
            task_id=task_id,
            request=request,
            publish_mode=publish_mode,
            stage=stage,
            requeue_count=requeue_count,
        )
    )
    track_event(
        "task_auto_requeued",
        {
            "task_id": task_id,
            "flow": "direct",
            "publish_mode": publish_mode,
            "stage": stage,
            "requeue_count": requeue_count,
        },
    )
    logger.info(
        f"orphan {task_id} marked for redispatch from video_generations "
        f"(attempt {requeue_count})"
    )
    return True


def _load_pipeline_start() -> Any:
    """Import the pipeline entrypoint.

    Lazy on purpose: ``app.services.task`` pulls in the pipeline, and this
    module is imported while ``app.services.state`` is still initializing.
    Callers must run only after ``state`` is assigned.
    """
    from app.services import task as tm

    return tm.start


def start_pending_direct_redispatches(manager: Any | None = None) -> int:
    """Start direct redispatches marked during boot review.

    Called from the ASGI startup hook, after ``app.services.state.state``
    exists. Jobs go through the engine task manager so a boot with many
    orphans shares ``max_concurrent_tasks`` with live requests instead of
    spawning one thread each. The requeue counter and ``stage=None`` were
    already persisted during review. A failure here (pipeline import, queue
    full) does not start the job and does not retry it forever: the next
    boot fail+refunds because ``stage`` is no longer a generation stage.

    Returns how many jobs the manager accepted (running or queued).
    """
    if not _pending_direct_redispatches:
        return 0
    pending = list(_pending_direct_redispatches)
    _pending_direct_redispatches.clear()
    try:
        start = _load_pipeline_start()
    except Exception as exc:  # noqa: BLE001 - counter already persisted; next boot fail+refunds
        logger.error(
            f"orphan redispatch: pipeline import failed; "
            f"{len(pending)} marked task(s) keep stage cleared and are "
            f"failed+refunded on the next boot: {exc}"
        )
        return 0
    if manager is None:
        # Imported here, not at review time: the controller module builds
        # the process-wide manager at import, which must not run while
        # app.services.state is still initializing.
        from app.controllers.v1.video import task_manager

        manager = task_manager
    accepted = 0
    for index, job in enumerate(pending):
        try:
            manager.add_task(
                start,
                task_id=job.task_id,
                params=job.request,
                stop_at="video",
            )
        except TaskQueueFullError:
            left = len(pending) - index
            logger.error(
                f"orphan redispatch queue full after {accepted} accepted; "
                f"{left} marked task(s) keep stage cleared and are "
                f"failed+refunded on the next boot"
            )
            break
        except Exception as exc:  # noqa: BLE001 - one bad job must not block the rest
            logger.error(f"orphan {job.task_id}: redispatch start failed: {exc}")
            continue
        accepted += 1
    if accepted:
        logger.info(f"accepted {accepted} direct orphan redispatches after boot")
    return accepted

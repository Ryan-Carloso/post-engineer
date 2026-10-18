"""Death-diagnostics instrumentation for the Supabase task backend.

A dead process cannot report its own death, so the engine records telemetry
*before* death and performs an *autopsy at boot* (see
``app.services.engine_heartbeat``). This module wires that instrumentation
into the task state:

- ``DeathDiagnosticTaskState`` samples process RSS on every stage mark
  (``update_task``), so the task row carries per-phase memory pressure for
  the next boot's triage;
- it snapshots the orphan rows at boot reconcile and records
  ``last_reconcile_stats`` (orphan count, orphans by stage, failed count),
  which ``engine_heartbeat.report_boot_event`` reads for the PostHog
  ``engine_boot`` autopsy event.

This lives in its own module because ``app.services.state`` is grandfathered
over the file-size cap and may not grow by a single line: the base class
stays instrumentation-free and the engine singleton instantiates this
subclass instead (see the backend selection at the bottom of
``app.services.state``).
"""

from __future__ import annotations

from typing import Any

from app.models import const
from app.services import engine_heartbeat
from app.services import state as _state_module
from app.services.state import SupabaseTaskState


def _orphan_rows(task_state: SupabaseTaskState) -> list[dict[str, Any]]:
    """Snapshot the non-terminal rows the boot reconcile is about to triage.

    Uses the same filter as ``SupabaseTaskState.reconcile_orphaned_tasks``
    — keep in sync with it. The base owns the reconcile; this only reads
    the rows so the boot autopsy can report orphans by stage. Boot-only, so
    the extra SELECT is bounded by the same batch cap the base uses.
    """
    query = (
        "select=task_id,data"
        f"&state=not.in.({const.TASK_STATE_FAILED},{const.TASK_STATE_COMPLETE})"
        f"&order=updated_at.asc&limit={_state_module._RECONCILE_BATCH_LIMIT}"
    )
    response = task_state._request("GET", query)
    rows = response.json()
    return [row for row in rows if isinstance(row, dict)]


def _count_by_stage(rows: list[dict[str, Any]]) -> dict[str, int]:
    """Orphan counts keyed by last persisted stage (``unknown`` when absent)."""
    by_stage: dict[str, int] = {}
    for row in rows:
        stage = str(dict(SupabaseTaskState._safe_data(row)).get("stage") or "unknown")
        by_stage[stage] = by_stage.get(stage, 0) + 1
    return by_stage


class DeathDiagnosticTaskState(SupabaseTaskState):
    """SupabaseTaskState with death-diagnostics instrumentation.

    The engine singleton uses this class; every ``update_task``/reconcile
    call in the engine therefore flows through the instrumentation below.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        # Set before super().__init__ so it exists when the boot reconcile
        # (run explicitly in app.asgi.startup_event) records its stats via
        # our reconcile_orphaned_tasks override.
        self.last_reconcile_stats: dict[str, object] = {}
        super().__init__(*args, **kwargs)

    def update_task(
        self,
        task_id: str,
        state: int | None = None,
        progress: int | None = None,
        **kwargs: object,
    ) -> None:
        if "stage" in kwargs:
            # Per-phase memory pressure, persisted with the stage mark: when
            # the next boot triages this row as an orphan, the last stage's
            # RSS shows what the process was carrying when it died. Cheap
            # (/proc read); VRAM rides the heartbeat row.
            rss_mb = engine_heartbeat.current_rss_mb()
            if rss_mb is not None:
                kwargs["stage_rss_mb"] = round(rss_mb, 1)
        super().update_task(task_id, state=state, progress=progress, **kwargs)

    def reconcile_orphaned_tasks(self) -> int:
        # Snapshot before the base marks the rows failed: afterwards the
        # per-stage breakdown is no longer queryable as "orphans". The
        # single-writer assumption (one engine process owns the table) means
        # nothing changes between this SELECT and the base's own.
        rows = _orphan_rows(self)
        failed = super().reconcile_orphaned_tasks()
        self.last_reconcile_stats = {
            "orphans": len(rows),
            "by_stage": _count_by_stage(rows),
            "requeued": 0,
            "completed": 0,
            "failed": failed,
        }
        return failed

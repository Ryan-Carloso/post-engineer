"""Batch scheduling pipeline orchestrator.

Tick (every TICK_SECONDS): batch generation → reconciliation → publishing.
Only manual batch schedules (created by POST /api/schedule/batch) are
processed — there is no automatic recurring scheduling.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any

from loguru import logger

from app.services import notify as notify_module
from app.services import upload_publisher
from app.services.fill_schedule.constants import TICK_SECONDS
from app.services.fill_schedule.generate import BatchGenerator
from app.services.fill_schedule.publish import BatchPublisher
from app.services.fill_schedule.reconcile import BatchReconciler
from app.services.fill_schedule.store import ScheduleStore
from app.services.fill_schedule.support import token_cost


class FillScheduleScheduler:
    """Orchestrates batch generation → reconciliation → publishing, one tick at a time."""

    def __init__(
        self,
        store: ScheduleStore,
        task_state: Any,
        publish_video: Any = upload_publisher.publish_video,
        notify: Any = notify_module.send_discord,
    ) -> None:
        self.store = store
        self.task_state = task_state
        self.notify = notify
        self.generator = BatchGenerator(store=store, task_state=task_state, notify=notify)
        self.reconciler = BatchReconciler(store=store, task_state=task_state)
        self.publisher = BatchPublisher(
            store=store, task_state=task_state, publish_video=publish_video, notify=notify
        )

    def generate(self, now: datetime) -> int:
        """Dispatch video generation for pending batch slots."""
        return self.generator.run(now)

    def reconcile(self, now: datetime) -> int:
        """Advance generating slots whose tasks finished."""
        return self.reconciler.run(now)

    def publish_due(self, now: datetime) -> int:
        """Publish ready batch slots whose time has come."""
        return self.publisher.run(now)

    def run_once(self, now: datetime) -> dict[str, int]:
        """One full tick (called by the thread every TICK_SECONDS).

        M1 — each stage isolated: a failure in one doesn't block the others.
        A stage that raises reports -1 in the result.
        """
        results: dict[str, int] = {}
        for stage_name, stage in (
            ("generated", self.generate),
            ("reconciled", self.reconcile),
            ("published", self.publish_due),
        ):
            try:
                results[stage_name] = stage(now)
            except Exception as exc:  # noqa: BLE001
                # A failed tick stage is a real recurring error: log at ERROR
                # so the Bugsink bridge (loguru sink, ERROR+) forwards it.
                logger.error(f"fill_schedule: stage {stage_name} failed: {notify_module.safe_reason(exc)}")
                results[stage_name] = -1
        if any(value != 0 for value in results.values()):
            logger.info(f"fill_schedule tick: {results}")
        return results

    @staticmethod
    def _token_cost(face_mix_percent: float, face_quality: str) -> int:
        """Per-video token cost (also used by the batch billing flow)."""
        return token_cost(face_mix_percent, face_quality)


def start_fill_schedule_thread(scheduler: FillScheduleScheduler) -> threading.Thread:
    """Daemon thread that runs the tick."""
    import time

    def loop() -> None:
        while True:
            try:
                scheduler.run_once(datetime.now(timezone.utc))
            except Exception:
                logger.exception("fill_schedule tick failed")
            time.sleep(TICK_SECONDS)

    thread = threading.Thread(target=loop, name="fill-schedule-scheduler", daemon=True)
    thread.start()
    return thread

"""Publishing scheduler.

Tick (every TICK_SECONDS): publish the ready slots whose time has come.
Slots are created by POST /api/media/publish-existing with media the user
uploaded; Post Engineer does not generate media.
"""

from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone
from typing import Any

from loguru import logger

from app.services import notify as notify_module
from app.services import upload_publisher
from app.services.fill_schedule.constants import CONNECTION_FAILURES, TICK_SECONDS
from app.services.fill_schedule.publish import BatchPublisher
from app.services.fill_schedule.store import CONNECT_RETRIES, ScheduleStore

OUTAGE_REMINDER_SECONDS = 30 * 60

class FillScheduleScheduler:
    """Publishes due slots, one tick at a time."""

    def __init__(
        self,
        store: ScheduleStore,
        publish_video: Any = upload_publisher.publish_video,
        notify: Any = notify_module.send_discord,
    ) -> None:
        self.store = store
        self.notify = notify
        self.publisher = BatchPublisher(store=store, publish_video=publish_video, notify=notify)
        self._outage_since: datetime | None = None
        self._outage_reported_at: datetime | None = None
        self._outage_failures = 0

    def publish_due(self, now: datetime) -> int:
        """Publish ready batch slots whose time has come."""
        return self.publisher.run(now)

    def run_once(self, now: datetime) -> dict[str, int]:
        """One full tick (called by the thread every TICK_SECONDS).

        A stage that raises reports -1 in the result.
        """
        results: dict[str, int] = {}
        self.store.set_connect_retries(CONNECT_RETRIES)
        connection_failed = False
        for stage_name, stage in (("published", self.publish_due),):
            try:
                results[stage_name] = stage(now)
            except Exception as exc:
                diagnostic = notify_module.safe_diagnostic(exc)
                if isinstance(exc, CONNECTION_FAILURES):
                    connection_failed = True
                    self._report_outage(stage_name, diagnostic, now)
                else:
                    logger.error(f"fill_schedule: stage {stage_name} failed: {diagnostic}")
                results[stage_name] = -1
                self.store.set_connect_retries(0)
        if not connection_failed and self._outage_since is not None:
            logger.warning(
                f"fill_schedule: connection outage over after {self._outage_seconds(now)}s "
                f"and {self._outage_failures} failed stages"
            )
            self._outage_since = None
            self._outage_reported_at = None
            self._outage_failures = 0
        if any(value != 0 for value in results.values()):
            logger.info(f"fill_schedule tick: {results}")
        return results

    def _report_outage(self, stage_name: str, diagnostic: str, now: datetime) -> None:
        """Log a stage connection failure as part of one outage incident."""
        self._outage_failures += 1
        if self._outage_reported_at is None:
            self._outage_since = now
            self._outage_reported_at = now
            logger.error(f"fill_schedule: connection outage started in stage {stage_name}: {diagnostic}")
            return
        if now - self._outage_reported_at >= timedelta(seconds=OUTAGE_REMINDER_SECONDS):
            self._outage_reported_at = now
            logger.error(
                f"fill_schedule: connection outage ongoing for {self._outage_seconds(now)}s, "
                f"{self._outage_failures} failed stages, last in stage {stage_name}: {diagnostic}"
            )
            return
        logger.warning(f"fill_schedule: stage {stage_name} failed during connection outage: {diagnostic}")

    def _outage_seconds(self, now: datetime) -> int:
        if self._outage_since is None:
            return 0
        return int((now - self._outage_since).total_seconds())


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

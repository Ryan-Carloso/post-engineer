"""Batch scheduling pipeline orchestrator.

Tick (every TICK_SECONDS): batch generation → reconciliation → publishing.
Only unified generate+schedule operations (created by POST
/api/videos/generate-and-schedule) are processed — there is no automatic
recurring scheduling.
"""

from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone
from typing import Any

import requests
from loguru import logger

from app.services import notify as notify_module
from app.services import upload_publisher
from app.services.fill_schedule.constants import TICK_SECONDS
from app.services.fill_schedule.generate import BatchGenerator
from app.services.fill_schedule.publish import BatchPublisher
from app.services.fill_schedule.reconcile import BatchReconciler
from app.services.fill_schedule.store import CONNECT_RETRIES, ScheduleStore
from app.services.fill_schedule.support import token_cost

# A sustained outage fails every stage on every tick (~3 ERRORs a minute).
# It is reported as one incident instead: ERROR when it starts, ERROR again
# every OUTAGE_REMINDER_SECONDS while it lasts, WARNING for the failures in
# between (the PostHog sink forwards ERROR+ only).
OUTAGE_REMINDER_SECONDS = 30 * 60

# Transport-level failures: the request did not get a response (DNS, refused,
# TLS, connect/read timeout). SSLError is a requests ConnectionError.
_CONNECTION_FAILURES = (
    requests.exceptions.ConnectionError,
    requests.exceptions.Timeout,
    ConnectionError,
    TimeoutError,
)


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
        self._outage_since: datetime | None = None
        self._outage_reported_at: datetime | None = None
        self._outage_failures = 0

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
        # Connect circuit breaker: re-arm the retry budget every tick, then
        # disarm it as soon as a stage fails. The breaker does not classify
        # the failure (only the outage report below does), but a failure does say
        # Supabase is unreachable right now: paying the full connect budget
        # again on each later stage would stretch the tick to ~2min against a
        # 60s TICK_SECONDS without recovering anything. Re-armed next tick,
        # so a transient blip costs one tick only.
        #
        # Accepted false negative: an UNRELATED stage failure (LLM outage,
        # bad publish credentials) also disarms, so a genuine DNS blip in a
        # later stage of the same tick gets no retry. One tick of reduced
        # resilience, re-armed at the top of the next.
        self.store.set_connect_retries(CONNECT_RETRIES)
        connection_failed = False
        for stage_name, stage in (
            ("generated", self.generate),
            ("reconciled", self.reconcile),
            ("published", self.publish_due),
        ):
            try:
                results[stage_name] = stage(now)
            except Exception as exc:  # noqa: BLE001
                diagnostic = notify_module.safe_diagnostic(exc)
                if isinstance(exc, _CONNECTION_FAILURES):
                    connection_failed = True
                    self._report_outage(stage_name, diagnostic, now)
                else:
                    # A failed tick stage is a real recurring error: log at
                    # ERROR so the PostHog bridge (loguru sink, ERROR+)
                    # forwards it.
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

    @staticmethod
    def _token_cost(faceless: bool, face_quality: str) -> int:
        """Per-video token cost (also used by the batch billing flow)."""
        return token_cost(faceless, face_quality)


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

"""Persistent daily queue for persona videos that require InfiniteTalk."""

import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Optional


QUEUE_STATUS_WAITING = "waiting"
QUEUE_STATUS_CLAIMED = "claimed"
QUEUE_STATUS_COMPLETE = "complete"
QUEUE_STATUS_FAILED = "failed"
DAILY_CUTOFF_HOUR_UTC = 6


class PersonaBatchQueueFullError(RuntimeError):
    """Raised when the waiting persona queue has reached its configured limit."""


def next_daily_cutoff(created_at: datetime, cutoff_hour_utc: int = DAILY_CUTOFF_HOUR_UTC) -> datetime:
    """Return the first configured UTC cutoff strictly after a request timestamp."""
    timestamp = created_at.astimezone(timezone.utc)
    cutoff = timestamp.replace(hour=cutoff_hour_utc, minute=0, second=0, microsecond=0)
    if timestamp >= cutoff:
        cutoff += timedelta(days=1)
    return cutoff


class PersonaBatchQueue:
    def __init__(self, database_path: Path, cutoff_hour_utc: int = DAILY_CUTOFF_HOUR_UTC) -> None:
        self.database_path = database_path
        if not 0 <= cutoff_hour_utc <= 23:
            raise ValueError("cutoff_hour_utc must be between 0 and 23")
        self.cutoff_hour_utc = cutoff_hour_utc
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS persona_batch_queue (
                    task_id TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    eligible_at TEXT NOT NULL,
                    batch_id TEXT,
                    error TEXT
                )
                """
            )

    def requeue_claimed(self) -> int:
        """Return tasks claimed by an interrupted process to the waiting queue."""
        with self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE persona_batch_queue
                SET status = ?, batch_id = NULL
                WHERE status = ?
                """,
                (QUEUE_STATUS_WAITING, QUEUE_STATUS_CLAIMED),
            )
        return cursor.rowcount

    def waiting_count(self) -> int:
        """Return the number of tasks waiting to be dispatched."""
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT COUNT(*) FROM persona_batch_queue
                WHERE status = ?
                """,
                (QUEUE_STATUS_WAITING,),
            ).fetchone()
        return int(row[0]) if row else 0

    def enqueue(
        self,
        task_id: str,
        payload_json: str,
        created_at: datetime,
        max_waiting_tasks: int | None = None,
    ) -> None:
        if not isinstance(json.loads(payload_json), dict):
            raise ValueError("persona batch payload must be a JSON object")
        created = created_at.astimezone(timezone.utc)
        eligible = next_daily_cutoff(created, self.cutoff_hour_utc)
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if max_waiting_tasks is not None:
                row = connection.execute(
                    "SELECT COUNT(*) FROM persona_batch_queue WHERE status = ?",
                    (QUEUE_STATUS_WAITING,),
                ).fetchone()
                waiting_count = int(row[0]) if row else 0
                if waiting_count >= max_waiting_tasks:
                    raise PersonaBatchQueueFullError("persona batch queue is full")
            connection.execute(
                """
                INSERT INTO persona_batch_queue
                    (task_id, payload_json, status, created_at, eligible_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(task_id) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    created_at = excluded.created_at,
                    eligible_at = excluded.eligible_at
                WHERE status = ?
                """,
                (
                    task_id,
                    payload_json,
                    QUEUE_STATUS_WAITING,
                    created.isoformat(),
                    eligible.isoformat(),
                    QUEUE_STATUS_WAITING,
                ),
            )

    def delete(self, task_id: str) -> bool:
        """Remove a queued task so it cannot be dispatched later."""
        with self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM persona_batch_queue WHERE task_id = ?", (task_id,)
            )
        return cursor.rowcount > 0

    def pending_task_ids(self, cutoff: datetime) -> list[str]:
        cutoff_text = cutoff.astimezone(timezone.utc).isoformat()
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT task_id FROM persona_batch_queue
                WHERE status = ? AND eligible_at <= ?
                ORDER BY eligible_at, created_at, task_id
                """,
                (QUEUE_STATUS_WAITING, cutoff_text),
            ).fetchall()
        return [str(row[0]) for row in rows]

    def claim_due_batch(self, cutoff: datetime, batch_id: str) -> list[str]:
        cutoff_text = cutoff.astimezone(timezone.utc).isoformat()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            rows = connection.execute(
                """
                SELECT task_id FROM persona_batch_queue
                WHERE status = ? AND eligible_at <= ?
                ORDER BY eligible_at, created_at, task_id
                """,
                (QUEUE_STATUS_WAITING, cutoff_text),
            ).fetchall()
            task_ids = [str(row[0]) for row in rows]
            if task_ids:
                connection.executemany(
                    "UPDATE persona_batch_queue SET status = ?, batch_id = ? WHERE task_id = ?",
                    [(QUEUE_STATUS_CLAIMED, batch_id, task_id) for task_id in task_ids],
                )
        return task_ids

    def payload_for(self, task_id: str) -> Optional[str]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT payload_json FROM persona_batch_queue WHERE task_id = ?",
                (task_id,),
            ).fetchone()
        return str(row[0]) if row else None

    def finish(self, task_id: str, error: Optional[str] = None) -> None:
        status = QUEUE_STATUS_COMPLETE if error is None else QUEUE_STATUS_FAILED
        with self._connect() as connection:
            connection.execute(
                "UPDATE persona_batch_queue SET status = ?, error = ? WHERE task_id = ?",
                (status, error, task_id),
            )

    def release(self, task_id: str, error: str) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE persona_batch_queue
                SET status = ?, eligible_at = ?, error = ?, batch_id = NULL
                WHERE task_id = ?
                """,
                (
                    QUEUE_STATUS_WAITING,
                    next_daily_cutoff(datetime.now(timezone.utc), self.cutoff_hour_utc).isoformat(),
                    error,
                    task_id,
                ),
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=30)
        connection.row_factory = sqlite3.Row
        return connection


class DailyPersonaBatchScheduler:
    def __init__(
        self,
        queue: PersonaBatchQueue,
        dispatch: Callable[[str, str], None],
        cutoff_hour_utc: int = DAILY_CUTOFF_HOUR_UTC,
    ) -> None:
        self.queue = queue
        self.dispatch = dispatch
        self.cutoff_hour_utc = cutoff_hour_utc

    def run_once(self, now: datetime, batch_id: str) -> list[str]:
        current_time = now.astimezone(timezone.utc)
        cutoff = current_time.replace(
            hour=self.cutoff_hour_utc, minute=0, second=0, microsecond=0
        )
        if current_time < cutoff:
            return []
        task_ids = self.queue.claim_due_batch(cutoff, batch_id)
        for task_id in task_ids:
            payload = self.queue.payload_for(task_id)
            if payload is None:
                self.queue.release(task_id, "queued payload not found")
                continue
            try:
                self.dispatch(task_id, payload)
            except Exception as exc:
                self.queue.release(task_id, str(exc))
        return task_ids

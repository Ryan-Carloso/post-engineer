import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from app.services.persona_batch_queue import (
    DailyPersonaBatchScheduler,
    PersonaBatchQueue,
    PersonaBatchQueueFullError,
)


class PersonaBatchQueueTest(unittest.TestCase):
    def test_request_before_six_utc_is_eligible_for_the_same_day(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue = PersonaBatchQueue(Path(directory) / "queue.sqlite3")

            queue.enqueue("task-before", '{"topic":"first"}', datetime(2026, 9, 2, 5, 59, tzinfo=timezone.utc))

            self.assertEqual(
                queue.pending_task_ids(datetime(2026, 9, 2, 6, 0, tzinfo=timezone.utc)),
                ["task-before"],
            )

    def test_request_after_six_utc_waits_for_the_next_day(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue = PersonaBatchQueue(Path(directory) / "queue.sqlite3")

            queue.enqueue("task-after", '{"topic":"later"}', datetime(2026, 9, 2, 6, 0, 1, tzinfo=timezone.utc))

            self.assertEqual(queue.pending_task_ids(datetime(2026, 9, 2, 6, 0, tzinfo=timezone.utc)), [])
            self.assertEqual(
                queue.pending_task_ids(datetime(2026, 9, 3, 6, 0, tzinfo=timezone.utc)),
                ["task-after"],
            )

    def test_queue_can_use_a_configured_cutoff_hour(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue = PersonaBatchQueue(Path(directory) / "queue.sqlite3", cutoff_hour_utc=7)

            queue.enqueue("task-at-six", "{}", datetime(2026, 9, 2, 6, 30, tzinfo=timezone.utc))

            self.assertEqual(
                queue.pending_task_ids(datetime(2026, 9, 3, 7, 0, tzinfo=timezone.utc)),
                ["task-at-six"],
            )

    def test_claiming_a_batch_excludes_requests_created_after_the_cutoff(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue = PersonaBatchQueue(Path(directory) / "queue.sqlite3")
            cutoff = datetime(2026, 9, 2, 6, 0, tzinfo=timezone.utc)
            queue.enqueue("old", "{}", datetime(2026, 9, 2, 5, 0, tzinfo=timezone.utc))
            queue.enqueue("new", "{}", datetime(2026, 9, 2, 6, 1, tzinfo=timezone.utc))

            self.assertEqual(queue.claim_due_batch(cutoff, "batch-1"), ["old"])
            self.assertEqual(queue.pending_task_ids(cutoff), [])
            self.assertEqual(
                queue.pending_task_ids(datetime(2026, 9, 3, 6, 0, tzinfo=timezone.utc)),
                ["new"],
            )

    def test_queue_is_persistent_between_instances(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "queue.sqlite3"
            created_at = datetime(2026, 9, 2, 5, 0, tzinfo=timezone.utc)
            PersonaBatchQueue(path).enqueue("persistent", "{}", created_at)

            self.assertEqual(
                PersonaBatchQueue(path).pending_task_ids(
                    datetime(2026, 9, 2, 6, 0, tzinfo=timezone.utc)
                ),
                ["persistent"],
            )

    def test_requeue_claimed_tasks_makes_interrupted_batch_retryable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue = PersonaBatchQueue(Path(directory) / "queue.sqlite3")
            cutoff = datetime(2026, 9, 2, 6, 0, tzinfo=timezone.utc)
            queue.enqueue("interrupted", "{}", datetime(2026, 9, 2, 5, 0, tzinfo=timezone.utc))
            queue.claim_due_batch(cutoff, "crashed-process")

            queue.requeue_claimed()

            self.assertEqual(queue.pending_task_ids(cutoff), ["interrupted"])

    def test_waiting_count_counts_only_waiting_tasks(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue = PersonaBatchQueue(Path(directory) / "queue.sqlite3")
            created_at = datetime(2026, 9, 2, 5, 0, tzinfo=timezone.utc)
            queue.enqueue("waiting", "{}", datetime(2026, 9, 2, 6, 1, tzinfo=timezone.utc))
            queue.enqueue("claimed", "{}", created_at)
            queue.enqueue("complete", "{}", created_at)
            queue.claim_due_batch(datetime(2026, 9, 2, 6, 0, tzinfo=timezone.utc), "batch")
            queue.finish("complete")

            self.assertEqual(queue.waiting_count(), 1)

    def test_enqueue_rejects_when_waiting_limit_is_reached(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue = PersonaBatchQueue(Path(directory) / "queue.sqlite3")
            created_at = datetime(2026, 9, 2, 5, 0, tzinfo=timezone.utc)
            queue.enqueue("first", "{}", created_at, max_waiting_tasks=1)

            with self.assertRaises(PersonaBatchQueueFullError):
                queue.enqueue("second", "{}", created_at, max_waiting_tasks=1)

    def test_claimed_task_does_not_block_new_waiting_task(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue = PersonaBatchQueue(Path(directory) / "queue.sqlite3")
            created_at = datetime(2026, 9, 2, 5, 0, tzinfo=timezone.utc)
            cutoff = datetime(2026, 9, 2, 6, 0, tzinfo=timezone.utc)
            queue.enqueue("claimed", "{}", created_at, max_waiting_tasks=1)
            queue.claim_due_batch(cutoff, "batch")

            queue.enqueue("second", "{}", created_at, max_waiting_tasks=1)

            self.assertEqual(queue.waiting_count(), 1)

    def test_delete_removes_a_queued_task(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue = PersonaBatchQueue(Path(directory) / "queue.sqlite3")
            queue.enqueue("to-delete", "{}", datetime.now(timezone.utc))

            self.assertTrue(queue.delete("to-delete"))
            self.assertFalse(queue.delete("to-delete"))
            self.assertIsNone(queue.payload_for("to-delete"))

    def test_deleted_task_is_not_dispatched(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue = PersonaBatchQueue(Path(directory) / "queue.sqlite3")
            cutoff = datetime(2026, 9, 2, 6, 0, tzinfo=timezone.utc)
            queue.enqueue("deleted", "{}", datetime(2026, 9, 2, 5, 0, tzinfo=timezone.utc))
            queue.delete("deleted")
            dispatched: list[str] = []
            scheduler = DailyPersonaBatchScheduler(
                queue, lambda task_id, payload: dispatched.append(task_id)
            )

            scheduler.run_once(cutoff, "batch")

            self.assertEqual(dispatched, [])

    def test_waiting_count_limit_is_atomic_for_each_enqueue(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue = PersonaBatchQueue(Path(directory) / "queue.sqlite3")
            created_at = datetime(2026, 9, 2, 5, 0, tzinfo=timezone.utc)
            queue.enqueue("first", "{}", created_at, max_waiting_tasks=1)

            with self.assertRaises(PersonaBatchQueueFullError):
                queue.enqueue("second", "{}", created_at, max_waiting_tasks=1)

            self.assertEqual(queue.waiting_count(), 1)

    def test_scheduler_does_not_run_before_six_utc(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue = PersonaBatchQueue(Path(directory) / "queue.sqlite3")
            queue.enqueue("early", "{}", datetime(2026, 9, 2, 5, 0, tzinfo=timezone.utc))
            dispatched: list[str] = []
            scheduler = DailyPersonaBatchScheduler(
                queue, lambda task_id, payload: dispatched.append(task_id)
            )

            scheduler.run_once(datetime(2026, 9, 2, 5, 59, tzinfo=timezone.utc), "batch-early")

            self.assertEqual(dispatched, [])

    def test_scheduler_dispatches_every_due_video_in_one_daily_batch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue = PersonaBatchQueue(Path(directory) / "queue.sqlite3")
            cutoff = datetime(2026, 9, 2, 6, 0, tzinfo=timezone.utc)
            queue.enqueue("one", '{"topic":"one"}', datetime(2026, 9, 2, 1, tzinfo=timezone.utc))
            queue.enqueue("two", '{"topic":"two"}', datetime(2026, 9, 2, 2, tzinfo=timezone.utc))
            dispatched: list[tuple[str, str]] = []
            scheduler = DailyPersonaBatchScheduler(
                queue, lambda task_id, payload: dispatched.append((task_id, payload))
            )

            scheduler.run_once(cutoff, "batch-2026-09-02")

            self.assertEqual([task_id for task_id, _ in dispatched], ["one", "two"])

    def test_re_enqueue_same_task_id_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue = PersonaBatchQueue(Path(directory) / "queue.sqlite3")
            created = datetime(2026, 9, 2, 5, 0, tzinfo=timezone.utc)
            queue.enqueue("task-1", '{"topic":"first"}', created)
            # Re-enqueue doesn't raise IntegrityError and updates the payload when waiting
            queue.enqueue("task-1", '{"topic":"updated"}', created)
            self.assertEqual(
                queue.pending_task_ids(datetime(2026, 9, 2, 6, 0, tzinfo=timezone.utc)),
                ["task-1"],
            )
            self.assertEqual(queue.payload_for("task-1"), '{"topic":"updated"}')


if __name__ == "__main__":
    unittest.main()

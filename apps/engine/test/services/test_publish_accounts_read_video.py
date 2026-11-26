"""publish_slot_accounts when the stored video cannot be read."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from app.services.fill_schedule.publish_accounts import publish_slot_accounts

NOW = datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)


def _slot_and_schedule():
    schedule = {
        "id": "sched-1",
        "user_id": "user-1",
        "providers": ["bluesky", "threads"],
        "bluesky_account_ids": ["bsky-1"],
        "threads_account_ids": ["th-1"],
    }
    slot = {"id": "slot-1", "title": "Porto coffee", "publish_attempts": 0, "schedules": schedule}
    return slot, schedule


class ReadVideoFailureTests(unittest.TestCase):
    def _run(self, read_video):
        slot, schedule = _slot_and_schedule()
        published: list[dict] = []
        reads: list[int] = []

        def persist(saved, fields):
            slot["publish_outcomes"] = [dict(item) for item in saved]
            slot.update(fields)

        def counted_read():
            reads.append(1)
            return read_video()

        result = publish_slot_accounts(
            slot, schedule, ["/videos/clip.mp4"], counted_read, NOW,
            "Porto coffee", "Porto coffee description.",
            base_url="https://post-engineer.com",
            api_secret="s3cr3t",
            publish_video=lambda **kwargs: published.append(kwargs),
            persist_outcomes=persist,
        )
        return result, slot, published, reads

    def test_storage_error_fails_every_due_account_as_transient_without_publishing(self) -> None:
        def broken_read():
            raise OSError("storage unreachable")

        result, slot, published, reads = self._run(broken_read)

        self.assertEqual(published, [])
        self.assertEqual(len(reads), 1)
        self.assertEqual(result.first_error, "storage unreachable")
        self.assertIsInstance(result.transport_error, OSError)
        outcomes = {o["provider"]: o for o in slot["publish_outcomes"]}
        self.assertEqual(set(outcomes), {"bluesky", "threads"})
        for outcome in outcomes.values():
            self.assertEqual(outcome["code"], "transient")
            self.assertIn("storage unreachable", outcome["error"])

    def test_runtime_error_from_the_reader_is_a_transport_error_too(self) -> None:
        def broken_read():
            raise RuntimeError("signed url expired")

        result, slot, published, _ = self._run(broken_read)

        self.assertEqual(published, [])
        self.assertEqual(result.first_error, "signed url expired")
        self.assertTrue(all(o["code"] == "transient" for o in slot["publish_outcomes"]))

    def test_reader_returning_nothing_fails_as_video_unavailable(self) -> None:
        result, slot, published, reads = self._run(lambda: None)

        self.assertEqual(published, [])
        self.assertEqual(len(reads), 2)
        self.assertIsNone(result.transport_error)
        for outcome in slot["publish_outcomes"]:
            self.assertEqual(outcome["code"], "transient")
            self.assertIn("video unavailable", outcome["error"])


if __name__ == "__main__":
    unittest.main()

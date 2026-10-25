"""A raising task lookup must not refund the full prepaid faced amount."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.fill_schedule.publish import BatchPublisher


class _Store:
    def __init__(self) -> None:
        self.refund_batch_calls: list[tuple] = []
        self.updates: list[tuple] = []

    def update_slot(self, slot_id, **fields):
        self.updates.append((slot_id, fields))

    def refund_batch_tokens(
        self, user_id, generation_id, refund_key, amount, reason, engine_task_id=None
    ):
        self.refund_batch_calls.append(
            (user_id, generation_id, refund_key, amount, reason, engine_task_id)
        )
        return True


class TestPublishTaskLookup(unittest.TestCase):
    def test_fail_slot_skips_refund_when_get_task_raises(self):
        store = _Store()
        state = MagicMock()
        state.get_task.side_effect = RuntimeError("state down")
        publisher = BatchPublisher(store=store, task_state=state)
        slot = {
            "id": "slot-1",
            "task_id": "t-1",
            "user_id": "user-1",
            "faceless": False,
        }
        schedule = {
            "id": "sched-1",
            "user_id": "user-1",
            "post_voice_id": "energetic",
            "post_face_quality": "ok",
        }
        with patch("app.services.fill_schedule.publish.track_event"), patch(
            "app.services.fill_schedule.publish.track_refund_issued"
        ):
            publisher._fail_slot_permanently(slot, schedule, "boom", "publish failed")
        self.assertEqual(store.refund_batch_calls, [])
        self.assertEqual(store.updates[0][1]["status"], "failed")

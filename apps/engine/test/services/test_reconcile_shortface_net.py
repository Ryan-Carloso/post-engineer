"""Generation-failure refund nets the :shortface premium already paid back."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models import const
from app.services.fill_schedule.reconcile import BatchReconciler


class _Store:
    def __init__(self, slots):
        self._slots = slots
        self.updates = []
        self.refund_batch_calls = []

    def generating_slots(self):
        return self._slots

    def update_slot(self, slot_id, **fields):
        self.updates.append((slot_id, fields))

    def refund_batch_tokens(self, user_id, generation_id, refund_key, amount, reason, engine_task_id=None):
        self.refund_batch_calls.append(
            (user_id, generation_id, refund_key, amount, reason, engine_task_id)
        )
        return True


class TestReconcileShortfaceNet(unittest.TestCase):
    def test_generation_failure_refund_is_net_of_shortface_premium(self):
        """Faced very_good prepaid 3; :shortface already refunded 2.

        A later generation failure refunds the remaining 1, not another 3.
        """
        slot = {
            "id": "slot-1",
            "user_id": "user-1",
            "task_id": "t-1",
            "faceless": False,
            "schedules": {
                "id": "sched-1",
                "user_id": "user-1",
                "personas": {"face_quality": "very_good"},
                "post_face_quality": "very_good",
            },
        }
        store = _Store([slot])
        state = MagicMock()
        state.get_task.return_value = {
            "state": const.TASK_STATE_FAILED,
            "error": "ffmpeg died",
            "user_warning_codes": ["avatar_disabled"],
        }
        with patch("app.services.fill_schedule.reconcile.track_event"), patch(
            "app.services.fill_schedule.reconcile.track_refund_issued"
        ) as issued:
            updated = BatchReconciler(store, state).run(
                datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)
            )
        self.assertEqual(updated, 1)
        self.assertEqual(len(store.refund_batch_calls), 1)
        self.assertEqual(store.refund_batch_calls[0][3], 1)
        issued.assert_called_once()
        self.assertEqual(issued.call_args.kwargs["amount"], 1)

    def test_generation_failure_refund_is_faceless_price_after_ok_premium(self):
        slot = {
            "id": "slot-1",
            "user_id": "user-1",
            "task_id": "t-1",
            "faceless": False,
            "schedules": {
                "id": "sched-1",
                "user_id": "user-1",
                "personas": {"face_quality": "ok"},
            },
        }
        store = _Store([slot])
        state = MagicMock()
        state.get_task.return_value = {
            "state": const.TASK_STATE_FAILED,
            "error": "ffmpeg died",
            "user_warning_codes": ["avatar_disabled"],
        }
        with patch("app.services.fill_schedule.reconcile.track_event"), patch(
            "app.services.fill_schedule.reconcile.track_refund_issued"
        ):
            BatchReconciler(store, state).run(
                datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)
            )
        self.assertEqual(store.refund_batch_calls[0][3], 1)
        self.assertEqual(store.updates[0][1]["status"], "failed")

    def test_faceless_slot_with_avatar_disabled_does_not_refund_again(self):
        slot = {
            "id": "slot-1",
            "user_id": "user-1",
            "task_id": "t-1",
            "faceless": True,
            "schedules": {
                "id": "sched-1",
                "user_id": "user-1",
                "personas": {"face_quality": "very_good"},
            },
        }
        store = _Store([slot])
        state = MagicMock()
        state.get_task.return_value = {
            "state": const.TASK_STATE_FAILED,
            "error": "ffmpeg died",
            "user_warning_codes": ["avatar_disabled"],
        }
        with patch("app.services.fill_schedule.reconcile.track_event"), patch(
            "app.services.fill_schedule.reconcile.track_refund_issued"
        ) as issued:
            BatchReconciler(store, state).run(
                datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)
            )
        self.assertEqual(store.refund_batch_calls, [])
        issued.assert_not_called()

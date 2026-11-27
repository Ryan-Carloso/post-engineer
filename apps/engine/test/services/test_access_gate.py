import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.publisher.access_gate import access_states, parse_access_until, partition_slots

NOW = datetime(2026, 11, 26, 12, 0, tzinfo=timezone.utc)


def _slot(slot_id, user_id, status="ready"):
    return {"id": slot_id, "user_id": user_id, "status": status, "schedules": {"user_id": user_id}}


class AccessGateTests(unittest.TestCase):
    def test_parse_access_until_handles_z_and_naive(self):
        self.assertEqual(parse_access_until("2026-11-27T12:00:00Z"), datetime(2026, 11, 27, 12, 0, tzinfo=timezone.utc))
        self.assertIsNone(parse_access_until("not-a-date"))
        self.assertIsNone(parse_access_until(None))

    def test_active_when_access_ends_after_now(self):
        store = MagicMock()
        store.access_until_by_user.return_value = {"u1": (NOW + timedelta(days=1)).isoformat()}
        self.assertEqual(access_states(store, ["u1"], NOW), {"u1": True})

    def test_active_when_a_paid_period_extends_past_the_trial(self):
        store = MagicMock()
        store.access_until_by_user.return_value = {"u1": (NOW + timedelta(days=300)).isoformat()}
        self.assertEqual(access_states(store, ["u1"], NOW), {"u1": True})

    def test_inactive_when_access_ended(self):
        store = MagicMock()
        store.access_until_by_user.return_value = {"u1": (NOW - timedelta(seconds=1)).isoformat()}
        self.assertEqual(access_states(store, ["u1"], NOW), {"u1": False})

    def test_unknown_when_row_missing(self):
        store = MagicMock()
        store.access_until_by_user.return_value = {}
        self.assertEqual(access_states(store, ["u1"], NOW), {"u1": None})

    def test_unknown_when_lookup_raises(self):
        store = MagicMock()
        store.access_until_by_user.side_effect = RuntimeError("db down")
        self.assertEqual(access_states(store, ["u1", "u2"], NOW), {"u1": None, "u2": None})

    def test_partition_slots_groups_by_state(self):
        slots = [_slot("a", "u1"), _slot("b", "u2"), _slot("c", "u3")]
        active, inactive, unknown = partition_slots(slots, {"u1": True, "u2": False, "u3": None})
        self.assertEqual([s["id"] for s in active], ["a"])
        self.assertEqual([s["id"] for s in inactive], ["b"])
        self.assertEqual([s["id"] for s in unknown], ["c"])


if __name__ == "__main__":
    unittest.main()

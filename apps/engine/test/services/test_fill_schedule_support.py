import unittest
from unittest.mock import MagicMock, patch

from app.services.fill_schedule.support import notify_safe, slot_user_id


class SlotUserIdTests(unittest.TestCase):
    def test_prefers_the_slot_row(self) -> None:
        self.assertEqual(slot_user_id({"user_id": "u1", "schedules": {"user_id": "u2"}}), "u1")

    def test_falls_back_to_the_schedule_embed(self) -> None:
        self.assertEqual(slot_user_id({"user_id": "", "schedules": {"user_id": "u2"}}), "u2")

    def test_none_without_an_owner(self) -> None:
        self.assertIsNone(slot_user_id({}))
        self.assertIsNone(slot_user_id({"schedules": {"user_id": 5}}))
        self.assertIsNone(slot_user_id({"schedules": "junk"}))


class NotifySafeTests(unittest.TestCase):
    def test_sends_the_message(self) -> None:
        notify = MagicMock()
        notify_safe(notify, "hello")
        notify.assert_called_once_with("hello")

    def test_a_failing_notifier_only_logs(self) -> None:
        notify = MagicMock(side_effect=RuntimeError("discord down"))
        with patch("app.services.fill_schedule.support.logger") as logger:
            notify_safe(notify, "hello")
        logger.warning.assert_called_once_with("fill_schedule: notify failed: discord down")


if __name__ == "__main__":
    unittest.main()

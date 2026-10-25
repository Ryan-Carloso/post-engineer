"""Direct tests for publish_tracking_context.

The helper used to live in fill_schedule/publish.py; as its own module it
needs a direct test file (mutmut attributes no publisher test to it).
"""

from __future__ import annotations

import unittest

from app.services.fill_schedule.publish_tracking import publish_tracking_context


class PublishTrackingContextTests(unittest.TestCase):
    def test_carries_identity_props(self) -> None:
        context = publish_tracking_context(
            {"id": "slot-1", "task_id": "task-9", "user_id": "user-1"},
            {"id": "sched-2", "user_id": "user-1", "persona_id": "persona-3"},
        )
        self.assertEqual(context["slotId"], "slot-1")
        self.assertEqual(context["task_id"], "task-9")
        self.assertEqual(context["user_id"], "user-1")
        self.assertEqual(context["schedule_id"], "sched-2")
        self.assertEqual(context["persona_id"], "persona-3")

    def test_omits_blank_props(self) -> None:
        context = publish_tracking_context(
            {"id": "slot-1", "task_id": ""},
            {"id": "", "user_id": "", "persona_id": None},
        )
        self.assertEqual(context, {"slotId": "slot-1"})

    def test_prefers_slot_user_id(self) -> None:
        context = publish_tracking_context(
            {"id": "slot-1", "user_id": "user-slot"},
            {"id": "sched-2", "user_id": "user-sched"},
        )
        self.assertEqual(context["user_id"], "user-slot")

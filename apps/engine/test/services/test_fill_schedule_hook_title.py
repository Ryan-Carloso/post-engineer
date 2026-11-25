"""A slot's stored hook_title reaches the engine request on the batch path.

scheduled_posts.hook_title (migration 084) is written by the web when the
post is scheduled. A tick-dispatched slot must forward it, or a scheduled
video silently renders without the title the user asked for.
"""

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import fill_schedule as fs
from test.services.test_fill_schedule_full_lipsync import _slot, _Store

UTC = timezone.utc


class BatchDispatchHookTitleTests(unittest.TestCase):
    def _dispatched_request(self, slot):
        store = _Store(slot)
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=MagicMock(), publish_video=MagicMock()
        )
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")
        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(enqueued, 1, "the dispatch path under test was taken")
        return dispatch.call_args[0][1]

    def test_a_stored_title_is_forwarded_to_the_engine_request(self):
        request = self._dispatched_request(_slot(hook_title="I entered the sea clothed?"))
        self.assertEqual(request.hook_title, "I entered the sea clothed?")

    def test_a_slot_without_a_title_dispatches_without_one(self):
        self.assertIsNone(self._dispatched_request(_slot()).hook_title)
        self.assertIsNone(self._dispatched_request(_slot(hook_title=None)).hook_title)


if __name__ == "__main__":
    unittest.main()

"""The batch pipeline forwards the per-post material choice.

scheduled_posts.faceless_material (migration 029) is written by the web
and must reach the engine request on the batch path too, or an "svg"
post dispatched here would silently render stock.
"""

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import fill_schedule as fs
from app.services.fill_schedule.support import slot_material

UTC = timezone.utc


def _slot(**extra):
    slot = {
        "id": "slot-1",
        "slot_at": "2026-09-08T09:00:00+00:00",
        "topic": "Batch topic one",
        "schedules": {
            "id": "sched-1",
            "user_id": "user-1",
            "providers": ["youtube"],
            "youtube_account_ids": ["yt-1"],
            "personas": {
                "name": "Ana",
                "niche": "travel",
                "script_prompt": "",
                "language": "en",
                "video_aspect": "9:16",
                "photo_path": "user-1/foto.png",
                "avatar_url": None,
                "voice_id": "calm",
                "voice_audio_path": None,
                "paragraph_number": 1,
                "face_quality": "ok",
            },
        },
    }
    slot.update(extra)
    return slot


class _Store:
    def __init__(self, slot):
        self._slot = slot
        self.updates = []

    def pending_slots(self, now):
        return [self._slot]

    def update_slot(self, slot_id, **fields):
        self.updates.append((slot_id, fields))

    def spend_tokens(self, *args):
        return True

    def set_connect_retries(self, n):
        pass


class SlotMaterialTests(unittest.TestCase):
    def test_only_literal_svg_selects_illustrations(self):
        self.assertEqual(slot_material({"faceless_material": "svg"}), "svg")
        for value in ("broll", None, "SVG", True, ""):
            self.assertEqual(slot_material({"faceless_material": value}), "broll")
        self.assertEqual(slot_material({}), "broll")


class BatchDispatchMaterialTests(unittest.TestCase):
    def _dispatched_request(self, slot):
        store = _Store(slot)
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=MagicMock(), publish_video=MagicMock()
        )
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")
        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(enqueued, 1)
        return dispatch.call_args[0][1]

    def test_svg_slot_with_face_dispatches_svg(self):
        request = self._dispatched_request(_slot(faceless=False, faceless_material="svg"))
        self.assertEqual(request.faceless_material, "svg")
        self.assertTrue(request.lipsync_enabled)

    def test_faceless_svg_slot_dispatches_svg(self):
        request = self._dispatched_request(_slot(faceless=True, faceless_material="svg"))
        self.assertEqual(request.faceless_material, "svg")

    def test_legacy_slot_without_the_column_dispatches_broll(self):
        request = self._dispatched_request(_slot())
        self.assertEqual(request.faceless_material, "broll")


if __name__ == "__main__":
    unittest.main()

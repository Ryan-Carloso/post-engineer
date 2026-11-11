"""The batch pipeline forwards the per-post full lip-sync choice.

scheduled_posts.full_lipsync (migration 035) is written by the web and
must reach the engine request on the batch path too, or a tick-dispatched
pending slot — or a slot requeued after an engine restart mid-generation
— silently renders intro-only even though the user asked for the
whole video as talking head.
"""

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import fill_schedule as fs
from app.services.fill_schedule.support import slot_full_lipsync

UTC = timezone.utc


def _slot(**extra):
    slot = {
        "id": "slot-1",
        "slot_at": "2026-09-08T09:00:00+00:00",
        "title": "Batch title one",
        "segments": [
            {"kind": "hook", "text": "Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.", "media": [{"url": "https://example.com/h0.jpg"}, {"url": "https://example.com/h1.jpg"}, {"url": "https://example.com/h2.jpg"}]},
            {"kind": "body", "text": "Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.", "media": [{"url": "https://example.com/b0.jpg"}, {"url": "https://example.com/b1.jpg"}, {"url": "https://example.com/b2.jpg"}, {"url": "https://example.com/b3.jpg"}, {"url": "https://example.com/b4.jpg"}, {"url": "https://example.com/b5.jpg"}]},
            {"kind": "cta", "text": "Save this video before your next trip to Porto.", "media": [{"url": "https://example.com/c0.jpg"}, {"url": "https://example.com/c1.jpg"}]},
        ],
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


class SlotFullLipsyncTests(unittest.TestCase):
    def test_only_literal_true_selects_full_lipsync(self):
        self.assertTrue(slot_full_lipsync({"full_lipsync": True}))
        for value in (False, None, "true", 1, "True", ""):
            self.assertFalse(slot_full_lipsync({"full_lipsync": value}))
        self.assertFalse(slot_full_lipsync({}))


class BatchDispatchFullLipsyncTests(unittest.TestCase):
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

    def test_full_lipsync_slot_dispatches_full_lipsync(self):
        # Full lip sync needs no media (at most 6 photos for the whole
        # video), so the slot dispatches with the media stripped.
        slot = _slot(full_lipsync=True)
        for segment in slot["segments"]:
            segment.pop("media", None)
        request = self._dispatched_request(slot)
        self.assertTrue(request.full_lipsync)

    def test_legacy_slot_without_the_column_dispatches_intro_only(self):
        request = self._dispatched_request(_slot())
        self.assertFalse(request.full_lipsync)

    def test_non_literal_full_lipsync_dispatches_intro_only(self):
        request = self._dispatched_request(_slot(full_lipsync="true"))
        self.assertFalse(request.full_lipsync)


if __name__ == "__main__":
    unittest.main()

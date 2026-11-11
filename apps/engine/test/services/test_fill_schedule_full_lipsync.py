"""The batch pipeline forwards the per-post video_type choice.

scheduled_posts.video_type (migration 056) is written by the web and
must reach the engine request on the batch path too, or a tick-dispatched
pending slot — or a slot requeued after an engine restart mid-generation
— silently renders intro-only even though the user asked for the
whole video as talking head. A slot without a valid video_type fails
loudly in the pre-flight instead of guessing a mode.
"""

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models.schema import VIDEO_TYPE_ERROR_SUFFIX
from app.services import fill_schedule as fs
from app.services.fill_schedule.support import slot_video_type

UTC = timezone.utc


def _slot(**extra):
    slot = {
        "id": "slot-1",
        "slot_at": "2026-09-08T09:00:00+00:00",
        "title": "Batch title one",
        "description": "Agent description.",
        "video_type": "hook_lipsync",
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


class SlotVideoTypeTests(unittest.TestCase):
    def test_valid_video_types_pass_through(self):
        for video_type in ("full_lipsync", "hook_lipsync", "faceless"):
            self.assertEqual(slot_video_type({"video_type": video_type}), video_type)

    def test_missing_video_type_fails_with_the_valid_values(self):
        with self.assertRaises(RuntimeError) as caught:
            slot_video_type({})
        self.assertIn(VIDEO_TYPE_ERROR_SUFFIX, str(caught.exception))

    def test_invalid_video_type_fails_with_the_valid_values(self):
        for bad in ("full", "true", 1, None, ""):
            with self.assertRaises(RuntimeError) as caught:
                slot_video_type({"video_type": bad})
            self.assertIn(VIDEO_TYPE_ERROR_SUFFIX, str(caught.exception))


class BatchDispatchVideoTypeTests(unittest.TestCase):
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
        slot = _slot(video_type="full_lipsync")
        for segment in slot["segments"]:
            segment.pop("media", None)
        request = self._dispatched_request(slot)
        self.assertEqual(request.video_type, "full_lipsync")

    def test_hook_lipsync_slot_dispatches_hook_lipsync(self):
        request = self._dispatched_request(_slot())
        self.assertEqual(request.video_type, "hook_lipsync")

    def test_slot_without_video_type_fails_without_dispatch(self):
        slot = _slot()
        del slot["video_type"]
        store = _Store(slot)
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=MagicMock(), publish_video=MagicMock()
        )
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")
        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(enqueued, 0)
        dispatch.assert_not_called()
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertIn(VIDEO_TYPE_ERROR_SUFFIX, store.updates[0][1]["error"])

    def test_invalid_video_type_fails_without_dispatch(self):
        slot = _slot(video_type="true")
        store = _Store(slot)
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=MagicMock(), publish_video=MagicMock()
        )
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")
        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(enqueued, 0)
        dispatch.assert_not_called()
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertIn(VIDEO_TYPE_ERROR_SUFFIX, store.updates[0][1]["error"])


if __name__ == "__main__":
    unittest.main()

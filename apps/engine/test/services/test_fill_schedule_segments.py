"""The batch pipeline forwards the slot's segments.

scheduled_posts.segments (migration 030) is written by the web and must
reach the engine request on the batch path too, or a requeued slot
(engine restart mid-generation) regenerates from the topic alone: the
script differs and every user photo disappears with no warning.
"""

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import fill_schedule as fs

UTC = timezone.utc

SEGMENTS = [
    {
        "kind": "hook",
        "text": "Porto is the city that wins you over slowly, one riverside morning and one golden sunset at a time.",
    },
    {
        "kind": "body",
        "text": "Walk the Ribeira in the morning light, cross the Dom Luis bridge, taste francesinha where the locals eat, and finish with port wine as the river turns gold at sunset before heading home through the old town streets.",
        "media": {"mediaId": "abc123def456abc123def456abc12345.jpg"},
    },
    {"kind": "cta", "text": "Follow for more Porto walks every week."},
]


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


class BatchDispatchSegmentsTests(unittest.TestCase):
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

    def test_segment_slot_dispatches_segments_and_joined_script(self):
        request = self._dispatched_request(_slot(faceless=True, segments=SEGMENTS))
        self.assertIsNotNone(request.segments)
        self.assertEqual(
            [segment.kind for segment in request.segments],
            ["hook", "body", "cta"],
        )
        self.assertEqual(
            request.segments[1].media.mediaId,
            "abc123def456abc123def456abc12345.jpg",
        )
        self.assertEqual(
            request.video_script,
            "Porto is the city that wins you over slowly, one riverside morning "
            "and one golden sunset at a time.\n\n"
            "Walk the Ribeira in the morning light, cross the Dom Luis bridge, "
            "taste francesinha where the locals eat, and finish with port wine "
            "as the river turns gold at sunset before heading home through "
            "the old town streets.\n\n"
            "Follow for more Porto walks every week.",
        )

    def test_slot_without_segments_dispatches_without_them(self):
        request = self._dispatched_request(_slot(faceless=True))
        self.assertIsNone(request.segments)

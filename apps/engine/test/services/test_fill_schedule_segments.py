"""The batch pipeline forwards the slot's segments.

scheduled_posts.segments (migration 030) is written by the web and must
reach the engine request on the batch path too. A slot without segments
has no script: it fails with a segments error instead of dispatching.
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
        "media": [{"url": f"https://e.com/h{i}.jpg"} for i in range(3)],
    },
    {
        "kind": "content",
        "text": "Walk the Ribeira in the morning light, cross the Dom Luis bridge, taste francesinha where the locals eat, and finish with port wine as the river turns gold at sunset before heading home through the old town streets.",
        "media": [{"mediaId": "abc123def456abc123def456abc12345.jpg"}]
        + [{"url": f"https://e.com/b{i}.jpg"} for i in range(4)],
    },
    {"kind": "content", "text": "Follow for more Porto walks every week.", "media": [{"url": "https://e.com/c0.jpg"}]},
]


def _slot(**extra):
    slot = {
        "id": "slot-1",
        "slot_at": "2026-09-08T09:00:00+00:00",
        "title": "Batch title one",
        "description": "Agent description.",
        "video_type": "hook_lipsync",
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
        request = self._dispatched_request(_slot(video_type="faceless", segments=SEGMENTS))
        self.assertIsNotNone(request.segments)
        self.assertEqual(
            [segment.kind for segment in request.segments],
            ["hook", "content", "content"],
        )
        self.assertEqual(
            request.segments[1].media[0].mediaId,
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

    def test_slot_with_pre_takes_kinds_dispatches_as_content(self):
        # Rows stored before the takes contract carry kind body/cta;
        # dispatch maps both to content, so the prepaid slot renders
        # instead of failing validation on the renamed kind.
        legacy = [
            {**SEGMENTS[0]},
            {**SEGMENTS[1], "kind": "body"},
            {**SEGMENTS[2], "kind": "cta"},
        ]
        request = self._dispatched_request(_slot(video_type="faceless", segments=legacy))
        self.assertEqual(
            [segment.kind for segment in request.segments],
            ["hook", "content", "content"],
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

    def test_slot_without_segments_fails_without_dispatch(self):
        store = _Store(_slot(video_type="faceless"))
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=MagicMock(), publish_video=MagicMock()
        )
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")
        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(enqueued, 0)
        dispatch.assert_not_called()
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertIn("segments", store.updates[0][1]["error"])

    def test_legacy_single_object_media_dispatches_as_a_list(self):
        # Rows stored before the media-list contract carry one object per
        # segment; dispatch normalizes it to a list instead of failing the
        # prepaid slot on a Pydantic list_type error with no refund. A
        # single photo can never satisfy the images density rule on a long
        # body, so the legacy row dispatches as full lip-sync (media
        # optional there) — the normalization is what this pins.
        legacy = [
            dict(SEGMENTS[0]),
            dict(SEGMENTS[1], media={"mediaId": "abc123def456abc123def456abc12345.jpg"}),
            dict(SEGMENTS[2]),
        ]
        request = self._dispatched_request(
            _slot(video_type="full_lipsync", segments=legacy)
        )
        self.assertIsNotNone(request.segments)
        self.assertEqual(
            request.segments[1].media[0].mediaId,
            "abc123def456abc123def456abc12345.jpg",
        )

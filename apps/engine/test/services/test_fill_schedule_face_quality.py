"""The engine batch path forwards the persona face quality as video_quality,
and the hook panel choice (post snapshot first, persona second) as hook_panel.

The web prices a slot by face quality (hook lip-sync 2 tokens ok / 3 very_good,
full lip-sync 8 / 15) and its direct dispatch sends video_quality="very-good"
for a very_good persona. The batch path (a tick-dispatched pending slot, or a
slot requeued after an engine restart) used to drop the field, so a user who
paid for very_good got an ok render.

Repo rule (AGENTS.md, Engine): "A persona field the engine consumes ... must be
forwarded on EVERY dispatch path — web direct payload (buildJobPayload), engine
batch (build_persona_params), MCP — a field populated on only one path is
silently dead on the others. Pin each path with a dispatch test, not a
hand-built params object." These tests capture the real TaskVideoRequest at
_dispatch_generation.
"""

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models.schema import LipSyncQuality
from app.services import fill_schedule as fs

UTC = timezone.utc


def _slot(**extra):
    slot = {
        "id": "slot-1",
        "slot_at": "2026-09-08T09:00:00+00:00",
        "title": "Batch title one",
        "description": "Agent description.",
        "video_type": "hook_lipsync",
        "segments": [
            {"kind": "hook", "text": "Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is still waiting nearby for you today.", "media": [{"url": "https://example.com/h0.jpg"}, {"url": "https://example.com/h1.jpg"}, {"url": "https://example.com/h2.jpg"}, {"url": "https://example.com/h3.jpg"}, {"url": "https://example.com/h4.jpg"}]},
            {"kind": "content", "text": "Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.", "media": [{"url": "https://example.com/b0.jpg"}, {"url": "https://example.com/b1.jpg"}, {"url": "https://example.com/b2.jpg"}, {"url": "https://example.com/b3.jpg"}, {"url": "https://example.com/b4.jpg"}, {"url": "https://example.com/b5.jpg"}, {"url": "https://example.com/b6.jpg"}, {"url": "https://example.com/b7.jpg"}]},
            {"kind": "content", "text": "Save this video before your next trip to Porto.", "media": [{"url": "https://example.com/c0.jpg"}, {"url": "https://example.com/c1.jpg"}]},
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
        self.refund_batch_calls = []

    def pending_slots(self, now, limit):
        return [self._slot]

    def update_slot(self, slot_id, **fields):
        self.updates.append((slot_id, fields))

    def refund_batch_tokens(
        self, user_id, generation_id, refund_key, amount, reason, engine_task_id=None
    ):
        self.refund_batch_calls.append(
            (user_id, generation_id, refund_key, amount, reason, engine_task_id)
        )
        return True

    def spend_tokens(self, *args):
        return True

    def set_connect_retries(self, n):
        pass


class BatchDispatchFaceQualityTests(unittest.TestCase):
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

    def test_very_good_persona_hook_lipsync_dispatches_very_good(self):
        slot = _slot()
        slot["schedules"]["personas"]["face_quality"] = "very_good"
        request = self._dispatched_request(slot)
        self.assertEqual(request.video_type, "hook_lipsync")
        self.assertEqual(request.video_quality, LipSyncQuality.very_good)

    def test_very_good_snapshot_wins_over_ok_persona(self):
        slot = _slot()
        slot["schedules"]["personas"]["face_quality"] = "ok"
        slot["schedules"]["post_face_quality"] = "very_good"
        request = self._dispatched_request(slot)
        self.assertEqual(request.video_quality, LipSyncQuality.very_good)

    def test_ok_persona_dispatches_ok(self):
        request = self._dispatched_request(_slot())
        self.assertEqual(request.video_quality, LipSyncQuality.ok)

    def test_very_good_full_lipsync_dispatches_very_good(self):
        slot = _slot(video_type="full_lipsync")
        for segment in slot["segments"]:
            segment.pop("media", None)
        slot["schedules"]["personas"]["face_quality"] = "very_good"
        request = self._dispatched_request(slot)
        self.assertEqual(request.video_type, "full_lipsync")
        self.assertEqual(request.video_quality, LipSyncQuality.very_good)

    def test_faceless_keeps_the_engine_default(self):
        slot = _slot(video_type="faceless")
        slot["schedules"]["personas"]["face_quality"] = "very_good"
        request = self._dispatched_request(slot)
        self.assertEqual(request.video_type, "faceless")
        self.assertEqual(request.video_quality, LipSyncQuality.ok)

    def test_unknown_quality_dispatches_ok(self):
        for value in (None, "weird"):
            slot = _slot()
            slot["schedules"]["personas"]["face_quality"] = value
            request = self._dispatched_request(slot)
            self.assertEqual(request.video_quality, LipSyncQuality.ok, value)


class BatchDispatchHookPanelTests(unittest.TestCase):
    _dispatched_request = BatchDispatchFaceQualityTests._dispatched_request

    def test_legacy_schedule_and_persona_without_the_field_keep_the_hook_panel(self):
        self.assertIs(self._dispatched_request(_slot()).hook_panel, True)

    def test_persona_off_turns_the_hook_panel_off(self):
        slot = _slot()
        slot["schedules"]["personas"]["hook_panel"] = False
        self.assertIs(self._dispatched_request(slot).hook_panel, False)

    def test_post_snapshot_off_wins_over_a_persona_that_keeps_it_on(self):
        slot = _slot()
        slot["schedules"]["personas"]["hook_panel"] = True
        slot["schedules"]["post_hook_panel"] = False
        self.assertIs(self._dispatched_request(slot).hook_panel, False)

    def test_post_snapshot_on_wins_over_a_persona_that_turns_it_off(self):
        slot = _slot()
        slot["schedules"]["personas"]["hook_panel"] = False
        slot["schedules"]["post_hook_panel"] = True
        self.assertIs(self._dispatched_request(slot).hook_panel, True)


if __name__ == "__main__":
    unittest.main()

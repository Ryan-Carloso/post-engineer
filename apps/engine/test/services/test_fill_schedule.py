"""Automatic Fill Schedule tests (app/services/fill_schedule.py).

Slots are computed with pure timezone arithmetic; the scheduler stages
are tested with fake injected store/state, no network.
"""

import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import requests
from loguru import logger

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import fill_schedule as fs
from app.services.fill_schedule.publish import BatchPublisher, _failed_outcomes
from app.services.fill_schedule.publish_accounts import AccountPublishResult
from app.services.owner_alert import notify_publish_partial
from app.services.fill_schedule.store import ScheduleStore
from app.services import notify as nf
from app.utils.supabase_retry import build_retrying_session
from app.models import const as model_const
from app.services.upload_publisher import InstagramMetadata, LinkedInMetadata, YouTubeMetadata

UTC = timezone.utc


class _FakeStore:
    def __init__(self, schedules=None):
        self.schedules = schedules or []
        self.inserted = []
        self.updates = []
        self.spent = []
        self.refunded = []
        self.refund_batch_calls = []
        self.generating = []
        self.connect_retries = fs.store.CONNECT_RETRIES
        self.retry_calls = []
        self.bound_accounts = {}

    def set_connect_retries(self, n):
        self.retry_calls.append(n)
        self.connect_retries = n

    def pending_slots(self, now, limit):
        raise AssertionError("override pending_slots per test")

    def generating_slots(self):
        return self.generating

    def active_schedules(self):
        return self.schedules

    def insert_slots_ignore_duplicates(self, rows):
        self.inserted.extend(rows)

    def update_slot(self, slot_id, **fields):
        self.updates.append((slot_id, fields))

    def spend_tokens(self, user_id, generation_id, amount, reason):
        self.spent.append((user_id, generation_id, amount, reason))
        return True

    def refund_tokens(self, user_id, generation_id, reason):
        self.refunded.append((user_id, generation_id, reason))
        return True

    def refund_batch_tokens(
        self, user_id, generation_id, refund_key, amount, reason, engine_task_id=None
    ):
        self.refund_batch_calls.append(
            (user_id, generation_id, refund_key, amount, reason, engine_task_id)
        )
        return True

    def claim_ready_slot(self, slot_id, now_utc=None):
        return True

    def publishing_slots(self):
        return []

    def persona_bound_accounts(self, persona_id):
        return self.bound_accounts


class BatchScheduleTests(unittest.TestCase):
    """Manual video batches (kind='batch'): finite, user-requested, prepaid.

    plan() must skip batch schedules (their slots are pre-materialized by
    POST /api/videos/generate-and-schedule); generate() must always process their pending
    slots using the stored segments — no LLM script, no token spend.
    """

    def _batch_slot(self, title="Batch title one"):
        return {
            "id": "slot-batch-1",
            "slot_at": "2026-09-08T09:00:00+00:00",
            "title": title,
            "description": "Agent description.",
            "video_type": "hook_lipsync",
            "charged_tokens": 2,
            "segments": [
                {
                    "kind": "hook",
                    "text": "Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is still waiting nearby for you today.",
                    "media": [{"url": "https://example.com/h0.jpg"}, {"url": "https://example.com/h1.jpg"}, {"url": "https://example.com/h2.jpg"}, {"url": "https://example.com/h3.jpg"}, {"url": "https://example.com/h4.jpg"}],
                },
                {
                    "kind": "content",
                    "text": "Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.",
                    "media": [
                        {"url": "https://example.com/b0.jpg"},
                        {"url": "https://example.com/b1.jpg"},
                        {"url": "https://example.com/b2.jpg"},
                        {"url": "https://example.com/b3.jpg"},
                        {"url": "https://example.com/b4.jpg"},
                        {"url": "https://example.com/b5.jpg"}, {"url": "https://example.com/b6.jpg"}, {"url": "https://example.com/b7.jpg"},
                    ],
                },
                {
                    "kind": "content",
                    "text": "Save this video before your next trip to Porto.",
                    "media": [
                        {"url": "https://example.com/c0.jpg"},
                        {"url": "https://example.com/c1.jpg"},
                    ],
                },
            ],
            "schedules": {
                "id": "sched-batch-1",
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

    def _scheduler(self, store):
        return fs.FillScheduleScheduler(
            store=store,
            task_state=MagicMock(),
            publish_video=MagicMock(),
        )

    def test_generate_batch_slot_uses_stored_segments_no_llm_no_spend(self):
        slot = self._batch_slot()
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 1)
        self.assertEqual(store.spent, [])
        dispatch_generation.assert_called_once()
        task_id, request, user_id = dispatch_generation.call_args.args
        self.assertEqual(user_id, "user-1")
        self.assertIn("Batch title one", request.model_dump_json())
        self.assertNotIn("LLM topic", request.model_dump_json())
        self.assertEqual(request.video_title, "Batch title one")
        update = dict(store.updates[0][1])
        self.assertEqual(update["status"], "generating")
        self.assertEqual(update["title"], "Batch title one")
        self.assertEqual(update["task_id"], task_id)

    def test_generate_batch_slot_forwards_the_stored_music_mood(self):
        slot = self._batch_slot()
        slot["music_mood"] = "calm"
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 1)
        _task_id, request, _user_id = dispatch_generation.call_args.args
        self.assertEqual(request.music_mood, "calm")

    def test_generate_batch_slot_forwards_the_stored_description(self):
        slot = self._batch_slot()
        slot["description"] = "Agent description."
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 1)
        _task_id, request, _user_id = dispatch_generation.call_args.args
        self.assertEqual(request.video_title, "Batch title one")
        self.assertEqual(request.video_description, "Agent description.")

    def test_generate_batch_slot_without_a_stored_description_fails_without_dispatch(self):
        slot = self._batch_slot()
        slot["title"] = ""
        del slot["description"]
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 0)
        dispatch_generation.assert_not_called()
        self.assertEqual(store.spent, [])
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertIn("description", store.updates[0][1]["error"])

    def test_generate_batch_slot_fails_when_the_account_is_not_bound_to_the_persona(self):
        slot = self._batch_slot()
        slot["schedules"]["persona_id"] = "persona-1"
        store = _FakeStore()
        store.bound_accounts = {"youtube": ["yt-other"]}
        store.pending_slots = lambda now, limit: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 0)
        dispatch_generation.assert_not_called()
        self.assertEqual(store.spent, [])
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertIn("not bound to persona", store.updates[0][1]["error"])

    def test_generate_batch_slot_binding_read_failure_leaves_slot_pending_for_retry(self):
        slot = self._batch_slot()
        slot["schedules"]["persona_id"] = "persona-1"
        store = _FakeStore()
        store.persona_bound_accounts = MagicMock(side_effect=RuntimeError("supabase down"))
        store.pending_slots = lambda now, limit: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 0)
        dispatch_generation.assert_not_called()
        self.assertEqual(store.spent, [])
        self.assertEqual(store.updates, [])
        self.assertEqual(store.refund_batch_calls, [])

    def test_generate_batch_slot_dispatches_when_the_account_is_bound_to_the_persona(self):
        slot = self._batch_slot()
        slot["schedules"]["persona_id"] = "persona-1"
        store = _FakeStore()
        store.bound_accounts = {"youtube": ["yt-1"]}
        store.pending_slots = lambda now, limit: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 1)
        dispatch_generation.assert_called_once()

    def test_generate_batch_slot_without_a_stored_mood_uses_the_engine_default(self):
        for stored in (None, ""):
            with self.subTest(stored=stored):
                slot = self._batch_slot()
                if stored is not None:
                    slot["music_mood"] = stored
                store = _FakeStore()
                store.pending_slots = lambda now, limit: [slot]
                scheduler = self._scheduler(store)
                scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

                with patch.object(
                    scheduler.generator, "_dispatch_generation"
                ) as dispatch_generation:
                    enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

                self.assertEqual(enqueued, 1)
                _task_id, request, _user_id = dispatch_generation.call_args.args
                self.assertIsNone(request.music_mood)

    def test_batch_dispatch_carries_the_video_language(self):
        slot = self._batch_slot()
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 1)
        request = dispatch_generation.call_args.args[1]
        self.assertEqual(request.video_language, "en")

    def test_persona_less_batch_dispatch_uses_the_snapshot_language(self):
        slot = self._batch_slot()
        del slot["schedules"]["personas"]
        slot["video_type"] = "faceless"
        slot["schedules"].update(
            {
                "post_voice_id": "energetic",
                "post_language": "en-GB",
                "post_video_aspect": "16:9",
                "post_face_quality": "ok",
            }
        )
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 1)
        request = dispatch_generation.call_args.args[1]
        self.assertEqual(request.video_language, "en-GB")

    def test_generate_slot_without_segments_fails_without_dispatch_or_spend(self):
        slot = self._batch_slot()
        slot["title"] = "Porto trip"
        slot["segments"] = None
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 0)
        dispatch_generation.assert_not_called()
        self.assertEqual(store.spent, [])
        self.assertEqual(store.refund_batch_calls, [])
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertIn("segments", store.updates[0][1]["error"])

    def test_generate_slot_with_segments_uses_title_as_video_title(self):
        slot = self._batch_slot()
        slot["title"] = "Porto trip"
        slot["segments"] = [
            {
                "kind": "hook",
                "text": "Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is still waiting nearby for you today.",
                "media": [{"url": "https://example.com/h0.jpg"}, {"url": "https://example.com/h1.jpg"}, {"url": "https://example.com/h2.jpg"}, {"url": "https://example.com/h3.jpg"}, {"url": "https://example.com/h4.jpg"}],
            },
            {
                "kind": "content",
                "text": "Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.",
                "media": [
                    {"url": "https://example.com/b0.jpg"},
                    {"url": "https://example.com/b1.jpg"},
                    {"url": "https://example.com/b2.jpg"},
                    {"url": "https://example.com/b3.jpg"},
                    {"url": "https://example.com/b4.jpg"},
                    {"url": "https://example.com/b5.jpg"}, {"url": "https://example.com/b6.jpg"}, {"url": "https://example.com/b7.jpg"},
                ],
            },
            {
                "kind": "content",
                "text": "Save this video before your next trip to Porto.",
                "media": [
                    {"url": "https://example.com/c0.jpg"},
                    {"url": "https://example.com/c1.jpg"},
                ],
            },
        ]
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 1)
        dispatch_generation.assert_called_once()
        task_id, request, user_id = dispatch_generation.call_args.args
        self.assertEqual(request.video_title, "Porto trip")
        self.assertIn("ninety minute line", request.video_script)
        update = dict(store.updates[0][1])
        self.assertEqual(update["status"], "generating")
        self.assertEqual(update["title"], "Porto trip")
        self.assertEqual(update["task_id"], task_id)

    def test_generate_batch_slot_without_persona_fails_slot_without_throwing(self):
        slot = self._batch_slot()
        del slot["schedules"]["personas"]
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 0)
        dispatch_generation.assert_not_called()
        self.assertEqual(store.updates[0][1]["status"], "failed")

    def test_generate_persona_less_slot_from_the_snapshot_generates(self):
        slot = self._batch_slot()
        del slot["schedules"]["personas"]
        slot["video_type"] = "faceless"
        slot["schedules"].update(
            {
                "post_voice_id": "energetic",
                "post_video_aspect": "16:9",
                "post_face_quality": "ok",
            }
        )
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 1)
        self.assertEqual(store.updates[0][1]["status"], "generating")
        request = dispatch_generation.call_args.args[1]
        self.assertEqual(request.persona.voice_id, "energetic")
        self.assertIsNone(request.persona.avatar_url)
        self.assertIsNone(request.persona.photo_url)
        self.assertEqual(request.video_aspect, "16:9")
        self.assertNotIn("video_script_prompt", request.model_dump())
        self.assertFalse(hasattr(request, "video_script_prompt"))

    def test_generate_slot_forwards_the_snapshot_cta_type(self):
        slot = self._batch_slot()
        del slot["schedules"]["personas"]
        slot["video_type"] = "faceless"
        slot["segments"][2]["cta"] = True
        slot["schedules"].update(
            {
                "post_voice_id": "energetic",
                "post_face_quality": "ok",
                "post_cta_type": "link",
            }
        )
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch_generation:
            scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(dispatch_generation.call_args.args[1].cta_type, "link")

    def test_generate_slot_stored_before_cta_rule_renders_without_a_cta(self):
        slot = self._batch_slot()
        del slot["schedules"]["personas"]
        slot["video_type"] = "faceless"
        slot["schedules"].update(
            {
                "post_voice_id": "energetic",
                "post_face_quality": "ok",
                "post_cta_type": "follow",
            }
        )
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch_generation:
            scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertIsNone(dispatch_generation.call_args.args[1].cta_type)

    def test_generate_slot_without_any_voice_fails_before_dispatch(self):
        slot = self._batch_slot()
        slot["schedules"]["personas"] = {"name": "Ana"}
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 0)
        dispatch_generation.assert_not_called()
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertIn("no voice", store.updates[0][1]["error"])

    def test_generate_batch_dispatch_failure_refunds_single_video(self):
        slot = self._batch_slot()
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        store.refund_batch_calls = []
        store.refund_batch_tokens = lambda *args, **kwargs: (
            store.refund_batch_calls.append(args + (kwargs.get("engine_task_id"),)) or True
        )
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(
            scheduler.generator, "_dispatch_generation", side_effect=RuntimeError("dispatch down")
        ):
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 0)
        self.assertEqual(len(store.refund_batch_calls), 1)
        user_id, batch_gen_id, refund_key, amount, _reason, _task_id = store.refund_batch_calls[0]
        self.assertEqual(user_id, "user-1")
        self.assertEqual(batch_gen_id, "batch:sched-batch-1")
        self.assertIn("slot-batch-1", refund_key)
        self.assertEqual(amount, 2)
        self.assertEqual(store.updates[0][1]["status"], "failed")

    def test_generate_batch_dispatch_failure_refunds_the_stored_charge(self):
        slot = self._batch_slot()
        slot["video_type"] = "full_lipsync"
        slot["charged_tokens"] = 8
        slot["segments"] = [
            {key: value for key, value in segment.items() if key != "media"}
            for segment in slot["segments"]
        ]
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        store.refund_batch_calls = []
        store.refund_batch_tokens = lambda *args, **kwargs: (
            store.refund_batch_calls.append(args + (kwargs.get("engine_task_id"),)) or True
        )
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(
            scheduler.generator, "_dispatch_generation", side_effect=RuntimeError("dispatch down")
        ):
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 0)
        self.assertEqual(len(store.refund_batch_calls), 1)
        user_id, batch_gen_id, refund_key, amount, _reason, _task_id = store.refund_batch_calls[0]
        self.assertEqual(amount, 8)
        self.assertEqual(store.updates[0][1]["status"], "failed")

    def test_generate_dispatch_failure_of_a_free_slot_makes_no_refund_call(self):
        slot = self._batch_slot()
        slot["charged_tokens"] = 0
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        store.refund_batch_tokens = MagicMock(return_value=True)
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(
            scheduler.generator, "_dispatch_generation", side_effect=RuntimeError("dispatch down")
        ):
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 0)
        store.refund_batch_tokens.assert_not_called()
        self.assertEqual(store.updates[0][1]["status"], "failed")

    def test_non_english_slot_fails_and_refunds_without_dispatch(self):
        slot = self._batch_slot()
        slot["schedules"]["personas"]["language"] = "pt-BR"
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        store.refund_batch_calls = []
        store.refund_batch_tokens = lambda *args, **kwargs: (
            store.refund_batch_calls.append(args) or True
        )
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with (
            patch.object(scheduler.generator, "_dispatch_generation") as dispatch_generation,
            patch("app.services.task.track_generation_requested") as track_requested,
        ):
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 0)
        dispatch_generation.assert_not_called()
        track_requested.assert_not_called()
        self.assertEqual(len(store.refund_batch_calls), 1)
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertIn("Only English videos", store.updates[0][1]["error"])

    def test_generate_dispatch_failure_emits_refund_issued_on_landed_refund(self):
        import uuid

        from app.services.fill_schedule import support as support_module

        slot = self._batch_slot()
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        refund_kwargs = {}

        def fake_refund(*args, **kwargs):
            refund_kwargs.update(kwargs)
            return True

        store.refund_batch_tokens = fake_refund
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(support_module, "track_event") as track:
            with patch.object(
                scheduler.generator,
                "_dispatch_generation",
                side_effect=RuntimeError("dispatch down"),
            ):
                scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        expected_task_id = str(uuid.uuid5(uuid.NAMESPACE_URL, "fill-schedule:slot-batch-1"))
        self.assertEqual(refund_kwargs.get("engine_task_id"), expected_task_id)
        refund_calls = [c for c in track.call_args_list if c[0][0] == "refund_issued"]
        self.assertEqual(len(refund_calls), 1)
        _, props = refund_calls[0][0]
        self.assertEqual(props["kind"], "batch_slot")
        self.assertEqual(props["user_id"], "user-1")
        self.assertEqual(props["amount"], 2)
        self.assertEqual(props["reason"], "Batch generation could not be dispatched")
        self.assertEqual(props["batch_generation_id"], "batch:sched-batch-1")
        self.assertEqual(props["slot_id"], "slot-batch-1")
        self.assertEqual(props["engine_task_id"], expected_task_id)

    def test_generate_dispatch_failure_no_refund_issued_when_not_refunded(self):
        from app.services.fill_schedule import support as support_module

        slot = self._batch_slot()
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        store.refund_batch_tokens = lambda *args, **kwargs: False
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(support_module, "track_event") as track:
            with patch.object(
                scheduler.generator,
                "_dispatch_generation",
                side_effect=RuntimeError("dispatch down"),
            ):
                scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        refund_calls = [c for c in track.call_args_list if c[0][0] == "refund_issued"]
        self.assertEqual(refund_calls, [])

    def test_dispatch_generation_updates_state_and_submits_to_the_task_manager(self):
        from app.models.schema import TaskVideoRequest
        from app.services import task as tm

        store = _FakeStore()
        scheduler = self._scheduler(store)
        request = TaskVideoRequest(
            video_type="faceless",
            video_title="Batch topic one",
            video_description="Batch description.",
        )

        with patch("app.controllers.v1.video.task_manager") as manager:
            scheduler.generator._dispatch_generation(
                "task-1",
                request,
                "user-1",
                slot_id="slot-1",
                schedule_id="sched-1",
                persona_id="persona-1",
            )

        scheduler.task_state.update_task.assert_called_once_with(
            "task-1",
            user_id="user-1",
            flow="batch",
            pipeline="video",
            state=model_const.TASK_STATE_PROCESSING,
            progress=0,
            slot_id="slot-1",
            schedule_id="sched-1",
            persona_id="persona-1",
            subtitle_position=request.subtitle_position,
        )
        manager.try_reserve_running.assert_called_once_with()
        manager.add_task.assert_not_called()
        reservation = manager.try_reserve_running.return_value
        reservation.start.assert_called_once()
        self.assertIs(reservation.start.call_args.args[0], tm.start)
        kwargs = reservation.start.call_args.kwargs
        self.assertEqual(kwargs["task_id"], "task-1")
        self.assertIs(kwargs["params"], request)
        self.assertEqual(kwargs["stop_at"], "video")

    def test_dispatch_generation_omits_blank_identity_ids(self):
        from app.models.schema import TaskVideoRequest

        store = _FakeStore()
        scheduler = self._scheduler(store)
        request = TaskVideoRequest(
            video_type="faceless",
            video_title="Batch topic one",
            video_description="Batch description.",
        )

        with patch("app.controllers.v1.video.task_manager"):
            scheduler.generator._dispatch_generation("task-2", request, "user-1")

        scheduler.task_state.update_task.assert_called_once_with(
            "task-2",
            user_id="user-1",
            flow="batch",
            pipeline="video",
            state=model_const.TASK_STATE_PROCESSING,
            progress=0,
            subtitle_position=request.subtitle_position,
        )

    def test_dispatch_generation_omits_only_the_blank_identity_ids(self):
        from app.models.schema import TaskVideoRequest

        store = _FakeStore()
        scheduler = self._scheduler(store)
        request = TaskVideoRequest(
            video_type="faceless",
            video_title="Batch topic one",
            video_description="Batch description.",
        )

        with patch("app.controllers.v1.video.task_manager"):
            scheduler.generator._dispatch_generation(
                "task-3",
                request,
                "user-1",
                slot_id="",
                schedule_id="sched-3",
                persona_id="persona-3",
            )

        scheduler.task_state.update_task.assert_called_once_with(
            "task-3",
            user_id="user-1",
            flow="batch",
            pipeline="video",
            state=model_const.TASK_STATE_PROCESSING,
            progress=0,
            schedule_id="sched-3",
            persona_id="persona-3",
            subtitle_position=request.subtitle_position,
        )

    def test_dispatch_generation_omits_blank_schedule_id_only(self):
        from app.models.schema import TaskVideoRequest

        store = _FakeStore()
        scheduler = self._scheduler(store)
        request = TaskVideoRequest(
            video_type="faceless",
            video_title="Batch topic one",
            video_description="Batch description.",
        )

        with patch("app.controllers.v1.video.task_manager"):
            scheduler.generator._dispatch_generation(
                "task-4",
                request,
                "user-1",
                slot_id="slot-4",
                schedule_id="",
                persona_id="persona-4",
            )

        scheduler.task_state.update_task.assert_called_once_with(
            "task-4",
            user_id="user-1",
            flow="batch",
            pipeline="video",
            state=model_const.TASK_STATE_PROCESSING,
            progress=0,
            slot_id="slot-4",
            persona_id="persona-4",
            subtitle_position=request.subtitle_position,
        )

    def test_dispatch_generation_omits_all_explicitly_blank_identity_ids(self):
        from app.models.schema import TaskVideoRequest

        store = _FakeStore()
        scheduler = self._scheduler(store)
        request = TaskVideoRequest(
            video_type="faceless",
            video_title="Batch topic one",
            video_description="Batch description.",
        )

        with patch("app.controllers.v1.video.task_manager"):
            scheduler.generator._dispatch_generation(
                "task-5",
                request,
                "user-1",
                slot_id="",
                schedule_id="",
                persona_id="",
            )

        scheduler.task_state.update_task.assert_called_once_with(
            "task-5",
            user_id="user-1",
            flow="batch",
            pipeline="video",
            state=model_const.TASK_STATE_PROCESSING,
            progress=0,
            subtitle_position=request.subtitle_position,
        )


class ReconcileTests(unittest.TestCase):
    def test_complete_task_becomes_ready(self):
        slot = {"id": "slot-1", "task_id": "t-1", "schedule_id": "sched-1", "charged_tokens": 2}
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": 1}
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=MagicMock(),
        )
        self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        self.assertEqual(store.updates[0][1]["status"], "ready")

    def test_reconcile_generated_event_carries_funnel_context(self):
        from app.services.fill_schedule import reconcile as rec_module

        slot = {
            "id": "slot-1",
            "task_id": "t-1",
            "user_id": "user-1",
            "schedule_id": "sched-1",
            "charged_tokens": 2,
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "cost_usd": 0.1,
        }
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=MagicMock(),
        )
        with patch.object(rec_module, "track_event") as track:
            self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        generated_calls = [c for c in track.call_args_list if c[0][0] == "video_generated"]
        self.assertEqual(len(generated_calls), 1)
        _, props = generated_calls[0][0]
        self.assertEqual(props["task_id"], "t-1")
        self.assertEqual(props["flow"], "batch")
        self.assertEqual(props["pipeline"], "video")
        self.assertEqual(props["user_id"], "user-1")
        self.assertEqual(props["slotId"], "slot-1")
        self.assertEqual(props["cost_usd"], 0.1)

    def test_reconcile_generated_event_carries_the_batch_id(self):
        from app.services.fill_schedule import reconcile as rec_module

        for batch_id, expected in (("batch-1", "batch-1"), (None, None), ("", None)):
            with self.subTest(batch_id=batch_id):
                slot = {
                    "id": "slot-1",
                    "task_id": "t-1",
                    "user_id": "user-1",
                    "schedule_id": "sched-1",
                    "charged_tokens": 2,
                    "batch_id": batch_id,
                }
                store = _FakeStore()
                store.generating_slots = lambda slot=slot: [slot]
                state = MagicMock()
                state.get_task.return_value = {"state": 1}
                scheduler = fs.FillScheduleScheduler(
                    store=store, task_state=state, publish_video=MagicMock()
                )
                with patch.object(rec_module, "track_event") as track:
                    scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
                ((_, props),) = [c[0] for c in track.call_args_list if c[0][0] == "video_generated"]
                self.assertEqual(props.get("batch_id"), expected)

    def test_reconcile_generated_event_omits_cost_usd_when_absent(self):
        from app.services.fill_schedule import reconcile as rec_module

        slot = {
            "id": "slot-1",
            "task_id": "t-1",
            "user_id": "user-1",
            "schedule_id": "sched-1",
            "charged_tokens": 2,
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": 1}
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=MagicMock(),
        )
        with patch.object(rec_module, "track_event") as track:
            self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        generated_calls = [c for c in track.call_args_list if c[0][0] == "video_generated"]
        self.assertEqual(len(generated_calls), 1)
        _, props = generated_calls[0][0]
        self.assertNotIn("cost_usd", props)

    def test_failed_task_becomes_failed(self):
        slot = {
            "id": "slot-1",
            "task_id": "t-1",
            "user_id": "user-1",
            "schedule_id": "sched-1",
            "charged_tokens": 2,
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": -1, "error": "gpu exploded"}
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=MagicMock(),
        )
        self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        self.assertEqual(store.updates[0][1]["status"], "failed")

    def test_failed_task_error_is_scrubbed_before_storage(self):
        from app.services import analytics as analytics_module
        from app.services.fill_schedule import reconcile as rec_module

        slot = {
            "id": "slot-1",
            "task_id": "t-1",
            "user_id": "user-1",
            "schedule_id": "sched-1",
            "charged_tokens": 2,
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        task_error = "E" * 450 + " api_key=TOPSECRET123 " + "F" * 200
        state.get_task.return_value = {
            "state": -1,
            "error": task_error,
        }
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=MagicMock(),
        )
        with patch.object(
            rec_module,
            "scrub_secret_values",
            wraps=analytics_module.scrub_secret_values,
        ) as scrub:
            self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        scrub.assert_called_once_with(task_error)
        error = store.updates[0][1]["error"]
        self.assertIn("[redacted]", error)
        self.assertNotIn("TOPSECRET123", error)
        self.assertLessEqual(len(error), 500)

    def test_failed_task_none_error_stores_empty_string(self):
        slot = {
            "id": "slot-1",
            "task_id": "t-1",
            "user_id": "user-1",
            "schedule_id": "sched-1",
            "charged_tokens": 2,
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": -1, "error": None}
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=MagicMock(),
        )
        self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        self.assertEqual(store.updates[0][1]["error"], "")

    def test_failed_slot_refunds_its_stored_charge_without_any_identity(self):
        slot = {
            "id": "slot-1",
            "task_id": "t-1",
            "user_id": "user-1",
            "schedule_id": "sched-1",
            "charged_tokens": 2,
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": -1, "error": "gpu exploded"}
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=MagicMock(),
        )
        self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertEqual(
            store.refund_batch_calls,
            [
                (
                    "user-1",
                    "batch:sched-1",
                    "batch:sched-1:slot:slot-1",
                    2,
                    "Batch generation failed",
                    "t-1",
                )
            ],
        )

    def test_failed_slot_refunds_the_stored_charge_not_the_list_price(self):
        slot = {
            "id": "slot-d",
            "task_id": "t-d",
            "user_id": "user-1",
            "video_type": "full_lipsync",
            "schedule_id": "sched-d",
            "charged_tokens": 5,
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": -1, "error": "gpu exploded"}
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state, publish_video=MagicMock()
        )
        scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual([call[3] for call in store.refund_batch_calls], [5])

    def test_failed_free_slot_is_marked_failed_without_a_refund_call(self):
        from app.services.fill_schedule import support as support_module

        slot = {
            "id": "slot-free",
            "task_id": "t-free",
            "user_id": "user-1",
            "schedule_id": "sched-f",
            "charged_tokens": 0,
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": -1, "error": "gpu exploded"}
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state, publish_video=MagicMock()
        )
        with patch.object(support_module.logger, "error") as log_error:
            self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertEqual(store.refund_batch_calls, [])
        log_error.assert_not_called()

    def test_failed_slot_with_unreadable_charge_skips_the_refund_loudly(self):
        from app.services.fill_schedule import support as support_module

        for bad in (None, -1, 1.5, "2", True):
            with self.subTest(charged_tokens=bad):
                slot = {
                    "id": "slot-bad",
                    "task_id": "t-bad",
                    "user_id": "user-1",
                    "schedule_id": "sched-bad",
                    "charged_tokens": bad,
                }
                store = _FakeStore()
                store.generating_slots = lambda slot=slot: [slot]
                state = MagicMock()
                state.get_task.return_value = {"state": -1, "error": "gpu exploded"}
                scheduler = fs.FillScheduleScheduler(
                    store=store, task_state=state, publish_video=MagicMock()
                )
                with patch.object(support_module.logger, "error") as log_error:
                    scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
                self.assertEqual(store.updates[0][1]["status"], "failed")
                self.assertEqual(store.refund_batch_calls, [])
                log_error.assert_called_once_with(
                    "fill_schedule: slot has no readable charged_tokens; refund skipped",
                    slot_id="slot-bad",
                )

    def test_failed_batch_task_refunds_batch_charge(self):
        slot = {
            "id": "slot-b1",
            "user_id": "user-1",
            "task_id": "t-b1",
            "faceless": True,
            "schedule_id": "sched-b1",
            "charged_tokens": 1,
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": -1, "error": "gpu exploded"}
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=MagicMock(),
        )
        self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertEqual(len(store.refund_batch_calls), 1)
        user_id, generation_id, refund_key, amount, _reason, _task_id = store.refund_batch_calls[0]
        self.assertEqual(user_id, "user-1")
        self.assertEqual(generation_id, "batch:sched-b1")
        self.assertEqual(refund_key, "batch:sched-b1:slot:slot-b1")
        self.assertEqual(amount, 1)
        self.assertEqual(store.refunded, [])

    def test_failed_slot_emits_refund_issued_on_landed_refund(self):
        from app.services.fill_schedule import support as support_module

        slot = {
            "id": "slot-b1",
            "user_id": "user-1",
            "task_id": "t-b1",
            "faceless": True,
            "schedule_id": "sched-b1",
            "charged_tokens": 1,
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": -1, "error": "gpu exploded"}
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state, publish_video=MagicMock()
        )
        with patch.object(support_module, "track_event") as track:
            self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        refund_calls = [c for c in track.call_args_list if c[0][0] == "refund_issued"]
        self.assertEqual(len(refund_calls), 1)
        _, props = refund_calls[0][0]
        self.assertEqual(props["kind"], "batch_slot")
        self.assertEqual(props["user_id"], "user-1")
        self.assertEqual(props["amount"], 1)
        self.assertEqual(props["reason"], "Batch generation failed")
        self.assertEqual(props["batch_generation_id"], "batch:sched-b1")
        self.assertEqual(props["slot_id"], "slot-b1")
        self.assertEqual(props["engine_task_id"], "t-b1")
        self.assertEqual(store.refund_batch_calls[0][5], "t-b1")

    def test_failed_slot_no_refund_issued_when_rpc_reports_not_refunded(self):
        from app.services.fill_schedule import support as support_module

        slot = {
            "id": "slot-b1",
            "user_id": "user-1",
            "task_id": "t-b1",
            "faceless": True,
            "schedule_id": "sched-b1",
            "charged_tokens": 1,
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        store.refund_batch_tokens = lambda *a, **k: False
        state = MagicMock()
        state.get_task.return_value = {"state": -1, "error": "gpu exploded"}
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state, publish_video=MagicMock()
        )
        with patch.object(support_module, "track_event") as track:
            self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        refund_calls = [c for c in track.call_args_list if c[0][0] == "refund_issued"]
        self.assertEqual(refund_calls, [])

    def test_failed_slot_no_refund_issued_when_rpc_raises(self):
        from app.services.fill_schedule import support as support_module

        slot = {
            "id": "slot-b1",
            "user_id": "user-1",
            "task_id": "t-b1",
            "faceless": True,
            "schedule_id": "sched-b1",
            "charged_tokens": 1,
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        store.refund_batch_tokens = MagicMock(side_effect=RuntimeError("rpc down"))
        state = MagicMock()
        state.get_task.return_value = {"state": -1, "error": "gpu exploded"}
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state, publish_video=MagicMock()
        )
        with patch.object(support_module, "track_event") as track:
            updated = scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(updated, 0)
        refund_calls = [c for c in track.call_args_list if c[0][0] == "refund_issued"]
        self.assertEqual(refund_calls, [])

    def test_failed_batch_task_without_user_id_still_marks_failed(self):
        slot = {
            "id": "slot-b2",
            "task_id": "t-b2",
            "schedule_id": "sched-b2",
            "charged_tokens": 2,
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": -1, "error": "gpu exploded"}
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=MagicMock(),
        )
        self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertEqual(store.refund_batch_calls, [])


class PublishDueTests(unittest.TestCase):
    def setUp(self) -> None:
        from app.services import video_storage

        storage_patcher = patch.object(
            video_storage, "read_final_video_r2", return_value=b"fake-video-bytes"
        )
        storage_patcher.start()
        self.addCleanup(storage_patcher.stop)
        handle, self.video_path = tempfile.mkstemp(suffix=".mp4")
        with os.fdopen(handle, "wb") as video_file:
            video_file.write(b"fake-video-bytes")
        self.addCleanup(os.unlink, self.video_path)

    def _slot(self):
        return {
            "id": "slot-1",
            "title": "Tokyo coffee",
            "description": "Tokyo coffee description.",
            "task_id": "t-1",
            "schedules": {"user_id": "user-1", "providers": ["youtube"]},
        }

    def test_due_slot_is_published_and_marked(self):
        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        publish = MagicMock(return_value={"success": True, "results": [{"success": True}]})
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=publish,
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"

        published = scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(published, 1)
        publish.assert_called_once()
        kwargs = publish.call_args.kwargs
        self.assertIsInstance(kwargs["metadata"], YouTubeMetadata)
        self.assertEqual(kwargs["owner_user_id"], "user-1")
        self.assertEqual(kwargs["video_bytes"], b"fake-video-bytes")
        self.assertEqual(kwargs["video_path"], os.path.basename(self.video_path))
        self.assertEqual(kwargs["content_type"], "video/mp4")
        self.assertEqual(store.updates[-1][1]["status"], "published")

    def _bound_slot(self, bound_accounts):
        slot = self._slot()
        slot["charged_tokens"] = 1
        slot["schedules"]["id"] = "sched-1"
        slot["schedules"]["persona_id"] = "persona-1"
        slot["schedules"]["youtube_account_ids"] = ["yt-1"]
        store = _FakeStore()
        store.bound_accounts = bound_accounts
        store.ready_due_slots = lambda now: [slot]
        return slot, store

    def _run_publish_ok(self, slot, store):
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        publish = MagicMock(return_value={"success": True, "results": [{"success": True}]})
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=publish,
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        published = scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        return store, published, publish

    def test_publish_fails_when_the_account_is_not_bound_to_the_persona(self):
        from app.services.fill_schedule import publish as pub_module

        slot, store = self._bound_slot({"youtube": ["yt-other"]})
        with patch.object(pub_module, "track_event") as track:
            _, published, publish = self._run_publish_ok(slot, store)
        self.assertEqual(published, 0)
        publish.assert_not_called()
        self.assertEqual(store.updates[-1][1]["status"], "failed")
        self.assertIn("not bound to persona", store.updates[-1][1]["error"])
        self.assertEqual(len(store.refund_batch_calls), 1)
        self.assertEqual(
            store.refund_batch_calls[0][4],
            "Publish blocked by the persona binding check; video refunded",
        )
        failed_calls = [c for c in track.call_args_list if c[0][0] == "video_publish_failed"]
        self.assertEqual(len(failed_calls), 1)
        self.assertFalse(failed_calls[0][0][1]["retryable"])

    def test_publish_plan_failure_uses_a_neutral_refund_reason(self):
        from app.services.fill_schedule import publish as pub_module

        slot, store = self._bound_slot({"youtube": ["yt-1"]})
        slot["description"] = ""
        with patch.object(pub_module, "track_event"):
            _, published, publish = self._run_publish_ok(slot, store)
        self.assertEqual(published, 0)
        publish.assert_not_called()
        self.assertEqual(store.updates[-1][1]["status"], "failed")
        self.assertIn("no video description", store.updates[-1][1]["error"])
        self.assertEqual(len(store.refund_batch_calls), 1)
        self.assertEqual(
            store.refund_batch_calls[0][4],
            "Publish plan failed validation; video refunded",
        )

    def test_publish_proceeds_when_the_account_is_bound_to_the_persona(self):
        slot, store = self._bound_slot({"youtube": ["yt-1"]})
        _, published, publish = self._run_publish_ok(slot, store)
        self.assertEqual(published, 1)
        publish.assert_called_once()
        self.assertEqual(store.updates[-1][1]["status"], "published")

    def test_publish_fails_when_the_persona_has_no_bound_accounts(self):
        slot, store = self._bound_slot({})
        _, published, publish = self._run_publish_ok(slot, store)
        self.assertEqual(published, 0)
        publish.assert_not_called()
        self.assertEqual(store.updates[-1][1]["status"], "failed")
        self.assertIn("not bound to persona", store.updates[-1][1]["error"])

    def test_publish_without_persona_skips_the_binding_check(self):
        slot = self._slot()
        slot["schedules"]["youtube_account_ids"] = ["yt-1"]
        store = _FakeStore()
        store.bound_accounts = {}
        store.ready_due_slots = lambda now: [slot]
        _, published, publish = self._run_publish_ok(slot, store)
        self.assertEqual(published, 1)
        publish.assert_called_once()

    def test_publish_binding_read_failure_leaves_slot_publishing_for_retry(self):
        slot, store = self._bound_slot({"youtube": ["yt-1"]})
        store.persona_bound_accounts = MagicMock(side_effect=RuntimeError("supabase down"))
        _, published, publish = self._run_publish_ok(slot, store)
        self.assertEqual(published, 0)
        publish.assert_not_called()
        self.assertEqual(store.updates, [])
        self.assertEqual(store.refund_batch_calls, [])

    def test_scheduled_publish_reads_from_the_verified_archive_path(self):
        from app.services import video_storage

        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=MagicMock(return_value={"success": True, "results": [{"success": True}]}),
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "test-shared-secret"

        with patch.object(
            video_storage, "read_final_video_r2", return_value=b"fake-video-bytes"
        ) as read_mock:
            scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        read_mock.assert_called_once_with("user-1/faceless/t-1/final-1.mp4")

    def test_instagram_provider_uses_caption_metadata(self):
        slot = self._slot()
        slot["schedules"]["providers"] = ["instagram"]
        store = _FakeStore()
        store.ready_due_slots = lambda now: [slot]
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=MagicMock(return_value={"success": True, "results": [{"success": True}]}),
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertIsInstance(
            scheduler.publisher.publish_video.call_args.kwargs["metadata"], InstagramMetadata
        )

    def test_linkedin_provider_uses_linkedin_metadata(self):
        slot = self._slot()
        slot["schedules"]["providers"] = ["linkedin"]
        slot["schedules"]["linkedin_account_ids"] = ["urn:li:person:1", "urn:li:organization:2"]
        store = _FakeStore()
        store.ready_due_slots = lambda now: [slot]
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=MagicMock(return_value={"success": True, "results": [{"success": True}]}),
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        metadata = scheduler.publisher.publish_video.call_args.kwargs["metadata"]
        self.assertIsInstance(metadata, LinkedInMetadata)
        self.assertEqual(metadata.caption, "Tokyo coffee description.")
        self.assertEqual(metadata.account_ids, ("urn:li:person:1", "urn:li:organization:2"))

    def test_transient_publish_error_stays_publishing(self):
        from app.services.upload_publisher import PublishError

        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        publish = MagicMock(side_effect=PublishError("boom"))
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=publish,
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        published = scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(published, 0)
        self.assertEqual(store.updates[-1][1]["status"], "publishing")

    def test_publish_failure_scrubs_full_message_before_truncation(self):
        from app.services import analytics as analytics_module
        from app.services.fill_schedule import publish as pub_module
        from app.services.upload_publisher import PublishError

        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        error = PublishError("E" * 150 + " api_key=TOPSECRET123 " + "F" * 150)
        publish = MagicMock(side_effect=error)
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=publish,
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        with (
            patch.object(pub_module, "track_event") as track,
            patch.object(
                analytics_module,
                "scrub_error_text",
                wraps=analytics_module.scrub_error_text,
            ) as scrub,
        ):
            published = scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(published, 0)
        reason_calls = [c for c in scrub.call_args_list if c[1].get("max_chars") == 200]
        wrapped = [c[0][0] for c in reason_calls if str(error) in c[0][0] and "youtube" in c[0][0]]
        self.assertTrue(wrapped)
        scrubbed_input = wrapped[0]
        self.assertIn(str(error), scrubbed_input)
        self.assertIn("youtube", scrubbed_input)
        failed_calls = [c for c in track.call_args_list if c[0][0] == "video_publish_failed"]
        self.assertEqual(len(failed_calls), 1)
        _, props = failed_calls[0][0]
        self.assertIn("[redacted]", props["reason"])
        self.assertNotIn("TOPSECRET123", props["reason"])
        self.assertLessEqual(len(str(props["reason"])), 200)


class PublishRetryLimitTests(unittest.TestCase):
    """Bounded publish retries: after MAX_PUBLISH_ATTEMPTS failures the slot
    is auto-cancelled (failed) and the prepaid token refunded — publish must
    never retry forever waiting on a human to cancel the slot."""

    def setUp(self) -> None:
        from app.services import video_storage

        storage_patcher = patch.object(
            video_storage, "read_final_video_r2", return_value=b"fake-video-bytes"
        )
        storage_patcher.start()
        self.addCleanup(storage_patcher.stop)
        handle, self.video_path = tempfile.mkstemp(suffix=".mp4")
        with os.fdopen(handle, "wb") as video_file:
            video_file.write(b"fake-video-bytes")
        self.addCleanup(os.unlink, self.video_path)

    def _slot(self, publish_attempts=0):
        return {
            "id": "slot-1",
            "title": "Tokyo coffee",
            "description": "Tokyo coffee description.",
            "task_id": "t-1",
            "faceless": True,
            "charged_tokens": 1,
            "publish_attempts": publish_attempts,
            "schedules": {
                "id": "sched-1",
                "user_id": "user-1",
                "providers": ["youtube"],
                "post_voice_id": "energetic",
                "post_face_quality": "ok",
            },
        }

    def _run_publish(self, slot, video_storage_path="user-1/faceless/t-1/final-1.mp4"):
        from app.services.upload_publisher import PublishError

        store = _FakeStore()
        store.ready_due_slots = lambda now: [slot]
        state = MagicMock()
        task = {"state": 1, "videos": [self.video_path]}
        if video_storage_path is not None:
            task["video_storage_path"] = video_storage_path
        state.get_task.return_value = task
        publish = MagicMock(side_effect=PublishError("boom"))
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=publish,
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        published = scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        return store, published

    def test_max_publish_attempts_is_three(self):
        from app.services.fill_schedule.constants import MAX_PUBLISH_ATTEMPTS

        self.assertEqual(MAX_PUBLISH_ATTEMPTS, 3)

    def test_failure_below_limit_stays_publishing_with_attempts_incremented(self):
        store, published = self._run_publish(self._slot(publish_attempts=1))
        self.assertEqual(published, 0)
        self.assertEqual(store.updates[-1][1]["status"], "publishing")
        self.assertEqual(store.updates[-1][1]["publish_attempts"], 2)
        self.assertEqual(store.refund_batch_calls, [])

    def test_retry_backoff_schedules_the_next_attempt_by_the_failed_attempt_number(self):
        store, _ = self._run_publish(self._slot(publish_attempts=0))
        self.assertEqual(
            store.updates[-1][1]["publish_not_before"],
            "2026-09-07T12:00:30+00:00",
        )
        store, _ = self._run_publish(self._slot(publish_attempts=1))
        self.assertEqual(
            store.updates[-1][1]["publish_not_before"],
            "2026-09-07T12:02:00+00:00",
        )
        store, _ = self._run_publish(self._slot(publish_attempts=2))
        self.assertEqual(store.updates[-1][1]["status"], "failed")

    def test_retry_delays_match_the_documented_schedule(self):
        from app.services.fill_schedule.constants import PUBLISH_RETRY_DELAY_SECONDS

        self.assertEqual(PUBLISH_RETRY_DELAY_SECONDS, (30, 120, 600))

    def test_attempts_default_to_zero_when_column_missing(self):
        slot = self._slot()
        del slot["publish_attempts"]
        store, _ = self._run_publish(slot)
        self.assertEqual(store.updates[-1][1]["status"], "publishing")
        self.assertEqual(store.updates[-1][1]["publish_attempts"], 1)
        self.assertEqual(store.refund_batch_calls, [])

    def test_final_failure_marks_slot_failed_and_refunds_token(self):
        store, published = self._run_publish(self._slot(publish_attempts=2))
        self.assertEqual(published, 0)
        self.assertEqual(store.updates[-1][1]["status"], "failed")
        self.assertEqual(store.updates[-1][1]["publish_attempts"], 3)
        self.assertEqual(len(store.refund_batch_calls), 1)
        user_id, generation_id, refund_key, amount, reason, _task_id = store.refund_batch_calls[0]
        self.assertEqual(user_id, "user-1")
        self.assertEqual(generation_id, "batch:sched-1")
        self.assertEqual(refund_key, "batch:sched-1:slot:slot-1:publish")
        self.assertEqual(amount, 1)
        self.assertIn("3 attempts", reason)

    def test_final_failure_of_a_free_slot_makes_no_refund_call(self):
        slot = self._slot(publish_attempts=2)
        slot["charged_tokens"] = 0
        store, published = self._run_publish(slot)
        self.assertEqual(published, 0)
        self.assertEqual(store.updates[-1][1]["status"], "failed")
        self.assertEqual(store.refund_batch_calls, [])

    def test_final_failure_refunds_the_stored_charge_without_an_identity(self):
        slot = self._slot(publish_attempts=2)
        slot["charged_tokens"] = 3
        for key in ("post_voice_id", "post_face_quality"):
            del slot["schedules"][key]
        store, _published = self._run_publish(slot)
        self.assertEqual([call[3] for call in store.refund_batch_calls], [3])

    def test_final_failure_emits_refund_issued_on_landed_refund(self):
        from app.services.fill_schedule import support as support_module
        from app.services.upload_publisher import PublishError

        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot(publish_attempts=2)]
        refund_kwargs = {}

        def fake_refund(*args, **kwargs):
            refund_kwargs.update(kwargs)
            return True

        store.refund_batch_tokens = fake_refund
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        publish = MagicMock(side_effect=PublishError("boom"))
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=publish,
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        with patch.object(support_module, "track_event") as track:
            published = scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(published, 0)
        self.assertEqual(refund_kwargs.get("engine_task_id"), "t-1")
        refund_calls = [c for c in track.call_args_list if c[0][0] == "refund_issued"]
        self.assertEqual(len(refund_calls), 1)
        _, props = refund_calls[0][0]
        self.assertEqual(props["kind"], "batch_slot")
        self.assertEqual(props["user_id"], "user-1")
        self.assertEqual(props["amount"], 1)
        self.assertIn("3 attempts", props["reason"])
        self.assertEqual(props["batch_generation_id"], "batch:sched-1")
        self.assertEqual(props["slot_id"], "slot-1")
        self.assertEqual(props["engine_task_id"], "t-1")

    def test_final_failure_no_refund_issued_when_not_refunded(self):
        from app.services.fill_schedule import support as support_module
        from app.services.upload_publisher import PublishError

        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot(publish_attempts=2)]
        store.refund_batch_tokens = lambda *args, **kwargs: False
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        publish = MagicMock(side_effect=PublishError("boom"))
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=publish,
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        with patch.object(support_module, "track_event") as track:
            published = scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(published, 0)
        refund_calls = [c for c in track.call_args_list if c[0][0] == "refund_issued"]
        self.assertEqual(refund_calls, [])

    def test_missing_r2_archive_marks_slot_failed_and_refunds_token(self):
        store, published = self._run_publish(self._slot(), video_storage_path=None)
        self.assertEqual(published, 0)
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertEqual(len(store.refund_batch_calls), 1)
        self.assertEqual(store.refund_batch_calls[0][1], "batch:sched-1")

    def test_missing_r2_archive_emits_publish_failed(self):
        from app.services.fill_schedule import publish as pub_module

        with patch.object(pub_module, "track_event") as track:
            store, published = self._run_publish(self._slot(), video_storage_path=None)
        self.assertEqual(published, 0)
        failed_calls = [c for c in track.call_args_list if c[0][0] == "video_publish_failed"]
        self.assertEqual(len(failed_calls), 1)
        _, props = failed_calls[0][0]
        self.assertEqual(props["reason"], "task has no verified R2 video archive")
        self.assertFalse(props["retryable"])
        self.assertEqual(props["slotId"], "slot-1")
        self.assertEqual(props["task_id"], "t-1")
        self.assertEqual(props["user_id"], "user-1")
        self.assertEqual(props["schedule_id"], "sched-1")

    def test_final_failure_emits_single_publish_failed(self):
        from app.services.fill_schedule import publish as pub_module

        with patch.object(pub_module, "track_event") as track:
            store, published = self._run_publish(self._slot(publish_attempts=2))
        self.assertEqual(published, 0)
        failed_calls = [c for c in track.call_args_list if c[0][0] == "video_publish_failed"]
        self.assertEqual(len(failed_calls), 1)
        _, props = failed_calls[0][0]
        self.assertEqual(props["attempts"], 3)
        self.assertFalse(props["retryable"])
        self.assertIn("boom", props["reason"])
        self.assertIn("youtube", props["reason"])

    def test_refund_error_does_not_break_the_tick(self):
        from app.services.upload_publisher import PublishError

        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot(publish_attempts=2)]
        store.refund_batch_tokens = MagicMock(side_effect=RuntimeError("rpc down"))
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        publish = MagicMock(side_effect=PublishError("boom"))
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=publish,
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(store.updates[-1][1]["status"], "failed")

    def test_refund_soft_failure_is_logged_loudly(self):
        from app.services.upload_publisher import PublishError

        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot(publish_attempts=2)]

        def soft_fail(user_id, generation_id, refund_key, amount, reason, engine_task_id=None):
            store.refund_batch_calls.append((user_id, generation_id, refund_key, amount, reason))
            return False

        store.refund_batch_tokens = soft_fail
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        publish = MagicMock(side_effect=PublishError("boom"))
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=publish,
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        with patch("app.services.fill_schedule.publish.logger") as mock_logger:
            published = scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(published, 0)
        self.assertEqual(store.updates[-1][1]["status"], "failed")
        error_messages = [str(call.args[0]) for call in mock_logger.error.call_args_list]
        self.assertTrue(
            any("refund" in message for message in error_messages),
            f"expected a loud refund-failure log, got: {error_messages}",
        )


class NotifyIntegrationTests(unittest.TestCase):
    """Discord events on the stages - injected, fire-and-forget, no crash."""

    def setUp(self) -> None:
        from app.services import video_storage

        storage_patcher = patch.object(
            video_storage, "read_final_video_r2", return_value=b"fake-video-bytes"
        )
        storage_patcher.start()
        self.addCleanup(storage_patcher.stop)

    def _scheduler(self, store, **kwargs):
        defaults = dict(
            store=store,
            task_state=MagicMock(),
            publish_video=MagicMock(return_value={"success": True, "results": [{"success": True}]}),
        )
        defaults.update(kwargs)
        return fs.FillScheduleScheduler(**defaults)

    def test_generate_batch_notifies_with_titles(self):
        slot = {
            "id": "slot-1",
            "slot_at": "2026-09-07T12:00:00+00:00",
            "title": "Batch title one",
            "description": "Agent description.",
            "video_type": "faceless",
            "segments": [
                {
                    "kind": "hook",
                    "text": "Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is still waiting nearby for you today.",
                    "media": [{"url": "https://example.com/h0.jpg"}, {"url": "https://example.com/h1.jpg"}, {"url": "https://example.com/h2.jpg"}, {"url": "https://example.com/h3.jpg"}, {"url": "https://example.com/h4.jpg"}],
                },
                {
                    "kind": "content",
                    "text": "Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.",
                    "media": [
                        {"url": "https://example.com/b0.jpg"},
                        {"url": "https://example.com/b1.jpg"},
                        {"url": "https://example.com/b2.jpg"},
                        {"url": "https://example.com/b3.jpg"},
                        {"url": "https://example.com/b4.jpg"},
                        {"url": "https://example.com/b5.jpg"}, {"url": "https://example.com/b6.jpg"}, {"url": "https://example.com/b7.jpg"},
                    ],
                },
                {
                    "kind": "content",
                    "text": "Save this video before your next trip to Porto.",
                    "media": [
                        {"url": "https://example.com/c0.jpg"},
                        {"url": "https://example.com/c1.jpg"},
                    ],
                },
            ],
            "schedules": {
                "id": "sched-1",
                "user_id": "user-1",
                "providers": ["youtube"],
                "youtube_account_ids": ["yt-1"],
                "personas": {
                    "name": "Ana",
                    "niche": "travel",
                    "language": "en",
                    "voice_id": "calm",
                },
            },
        }
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        notify = MagicMock()
        scheduler = self._scheduler(
            store,
            notify=notify,
        )
        with patch.object(scheduler.generator, "_dispatch_generation"):
            scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        notify.assert_called_once()
        message = notify.call_args.args[0]
        self.assertIn("Batch title one", message)
        self.assertIn("Ana", message)

    def test_generate_failure_notifies(self):
        slot = {
            "id": "slot-2",
            "slot_at": "2026-09-07T12:00:00+00:00",
            "title": "Batch title",
            "description": "Agent description.",
            "video_type": "faceless",
            "segments": [
                {
                    "kind": "hook",
                    "text": "Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is still waiting nearby for you today.",
                    "media": [{"url": "https://example.com/h0.jpg"}, {"url": "https://example.com/h1.jpg"}, {"url": "https://example.com/h2.jpg"}, {"url": "https://example.com/h3.jpg"}, {"url": "https://example.com/h4.jpg"}],
                },
                {
                    "kind": "content",
                    "text": "Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.",
                    "media": [
                        {"url": "https://example.com/b0.jpg"},
                        {"url": "https://example.com/b1.jpg"},
                        {"url": "https://example.com/b2.jpg"},
                        {"url": "https://example.com/b3.jpg"},
                        {"url": "https://example.com/b4.jpg"},
                        {"url": "https://example.com/b5.jpg"}, {"url": "https://example.com/b6.jpg"}, {"url": "https://example.com/b7.jpg"},
                    ],
                },
                {
                    "kind": "content",
                    "text": "Save this video before your next trip to Porto.",
                    "media": [
                        {"url": "https://example.com/c0.jpg"},
                        {"url": "https://example.com/c1.jpg"},
                    ],
                },
            ],
            "schedules": {
                "id": "sched-2",
                "user_id": "user-1",
                "providers": ["youtube"],
                "youtube_account_ids": ["yt-1"],
                "personas": {"name": "Ana", "voice_id": "calm"},
            },
        }
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        notify = MagicMock()
        scheduler = self._scheduler(
            store,
            notify=notify,
        )
        with patch.object(
            scheduler.generator, "_dispatch_generation", side_effect=RuntimeError("gpu down")
        ):
            scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        notify.assert_called_once()
        message = notify.call_args.args[0]
        self.assertIn("❌", message)
        self.assertIn("gpu down", message)
        self.assertIn("Ana", message)

    def test_preflight_failure_notifies_validation_reason(self):
        slot = {
            "id": "slot-3",
            "slot_at": "2026-09-07T12:00:00+00:00",
            "title": "Batch title",
            "description": "Agent description.",
            "video_type": "faceless",
            "segments": [
                {
                    "kind": "hook",
                    "text": "Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is still waiting nearby for you today.",
                    "media": [{"url": "https://example.com/h0.jpg"}, {"url": "https://example.com/h1.jpg"}, {"url": "https://example.com/h2.jpg"}, {"url": "https://example.com/h3.jpg"}, {"url": "https://example.com/h4.jpg"}],
                },
                {
                    "kind": "content",
                    "text": "Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.",
                    "media": [
                        {"url": "https://example.com/b0.jpg"},
                        {"url": "https://example.com/b1.jpg"},
                        {"url": "https://example.com/b2.jpg"},
                        {"url": "https://example.com/b3.jpg"},
                        {"url": "https://example.com/b4.jpg"},
                        {"url": "https://example.com/b5.jpg"}, {"url": "https://example.com/b6.jpg"}, {"url": "https://example.com/b7.jpg"},
                    ],
                },
                {
                    "kind": "content",
                    "text": "Save this video before your next trip to Porto.",
                    "media": [
                        {"url": "https://example.com/c0.jpg"},
                        {"url": "https://example.com/c1.jpg"},
                    ],
                },
            ],
            "schedules": {
                "id": "sched-3",
                "user_id": "user-1",
                "providers": [],
                "personas": {"name": "Ana"},
            },
        }
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        notify = MagicMock()
        scheduler = self._scheduler(store, notify=notify)
        scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        notify.assert_called_once()
        message = notify.call_args.args[0]
        self.assertIn("❌", message)
        self.assertIn("provider", message)

    def test_publish_success_notifies_persona_title_providers(self):
        handle, video_path = tempfile.mkstemp(suffix=".mp4")
        with os.fdopen(handle, "wb") as video_file:
            video_file.write(b"fake-video-bytes")
        self.addCleanup(os.unlink, video_path)

        slot = {
            "id": "slot-1",
            "title": "Tokyo coffee",
            "description": "Tokyo coffee description.",
            "task_id": "t-1",
            "schedules": {
                "user_id": "user-1",
                "providers": ["youtube", "instagram"],
                "personas": {"name": "Ana"},
            },
        }
        store = _FakeStore()
        store.ready_due_slots = lambda now: [slot]
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "videos": [video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        notify = MagicMock()
        scheduler = self._scheduler(store, task_state=state, notify=notify)
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"

        scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        notify.assert_called_once()
        message = notify.call_args.args[0]
        self.assertIn("✅", message)
        self.assertIn("Ana", message)
        self.assertIn("Tokyo coffee", message)
        self.assertIn("youtube", message)
        self.assertIn("instagram", message)

    def test_publish_failure_notifies_reason(self):
        from app.services.upload_publisher import PublishError

        handle, video_path = tempfile.mkstemp(suffix=".mp4")
        with os.fdopen(handle, "wb") as video_file:
            video_file.write(b"fake-video-bytes")
        self.addCleanup(os.unlink, video_path)

        slot = {
            "id": "slot-1",
            "title": "Tokyo coffee",
            "description": "Tokyo coffee description.",
            "task_id": "t-1",
            "publish_attempts": 2,
            "charged_tokens": 1,
            "schedules": {
                "user_id": "user-1",
                "providers": ["youtube"],
                "personas": {"name": "Ana"},
            },
        }
        store = _FakeStore()
        store.ready_due_slots = lambda now: [slot]
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "videos": [video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        notify = MagicMock()
        scheduler = self._scheduler(
            store,
            task_state=state,
            notify=notify,
            publish_video=MagicMock(side_effect=PublishError("quota exceeded")),
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"

        scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        notify.assert_called_once()
        message = notify.call_args.args[0]
        self.assertIn("❌", message)
        self.assertIn("quota exceeded", message)

    def test_notify_never_crashes_the_stage(self):
        slot = {
            "id": "slot-1",
            "slot_at": "2026-09-07T12:00:00+00:00",
            "title": "Batch title",
            "description": "Agent description.",
            "video_type": "faceless",
            "segments": [
                {
                    "kind": "hook",
                    "text": "Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is still waiting nearby for you today.",
                    "media": [{"url": "https://example.com/h0.jpg"}, {"url": "https://example.com/h1.jpg"}, {"url": "https://example.com/h2.jpg"}, {"url": "https://example.com/h3.jpg"}, {"url": "https://example.com/h4.jpg"}],
                },
                {
                    "kind": "content",
                    "text": "Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.",
                    "media": [
                        {"url": "https://example.com/b0.jpg"},
                        {"url": "https://example.com/b1.jpg"},
                        {"url": "https://example.com/b2.jpg"},
                        {"url": "https://example.com/b3.jpg"},
                        {"url": "https://example.com/b4.jpg"},
                        {"url": "https://example.com/b5.jpg"}, {"url": "https://example.com/b6.jpg"}, {"url": "https://example.com/b7.jpg"},
                    ],
                },
                {
                    "kind": "content",
                    "text": "Save this video before your next trip to Porto.",
                    "media": [
                        {"url": "https://example.com/c0.jpg"},
                        {"url": "https://example.com/c1.jpg"},
                    ],
                },
            ],
            "schedules": {
                "id": "sched-1",
                "user_id": "user-1",
                "providers": ["youtube"],
                "youtube_account_ids": ["yt-1"],
                "personas": {
                    "name": "Ana",
                    "niche": "travel",
                    "language": "en",
                    "voice_id": "calm",
                },
            },
        }
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        notify = MagicMock(side_effect=RuntimeError("discord exploded"))
        scheduler = self._scheduler(
            store,
            notify=notify,
        )
        with patch.object(scheduler.generator, "_dispatch_generation"):
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(enqueued, 1)
        self.assertEqual(store.updates[0][1]["status"], "generating")

    def test_default_notify_is_noop_without_env(self):
        scheduler = self._scheduler(_FakeStore())
        self.assertEqual(scheduler.notify, nf.send_discord)


class CoverageGapTests(unittest.TestCase):
    """Covers paths not yet exercised: explicit times, generate_topic,
    build_persona_params (all variants), reconcile without task, publish
    without env/task without videos, run_once, helpers and bluesky/linkedin
    metadata."""

    def setUp(self) -> None:
        from app.services import video_storage

        storage_patcher = patch.object(
            video_storage, "read_final_video_r2", return_value=b"fake-video-bytes"
        )
        storage_patcher.start()
        self.addCleanup(storage_patcher.stop)
        handle, self.video_path = tempfile.mkstemp(suffix=".mp4")
        with os.fdopen(handle, "wb") as video_file:
            video_file.write(b"fake-video-bytes")
        self.addCleanup(os.unlink, self.video_path)

    def _slot(self):
        return {
            "id": "slot-1",
            "title": "Tokyo coffee",
            "description": "Tokyo coffee description.",
            "task_id": "t-1",
            "schedules": {
                "user_id": "user-1",
                "providers": ["youtube"],
                "personas": {"name": "Ana"},
            },
        }

    def _scheduler(self, store, **kwargs):
        defaults = dict(
            store=store,
            task_state=MagicMock(),
            publish_video=MagicMock(),
        )
        defaults.update(kwargs)
        return fs.FillScheduleScheduler(**defaults)

    def test_persona_params_avatar_url_and_voice_id(self):
        params = fs.build_persona_params(
            {"name": "Ana", "avatar_url": "https://cdn/a.png", "voice_id": "calm"},
            store=MagicMock(),
        )
        self.assertEqual(params["avatar_url"], "https://cdn/a.png")
        self.assertEqual(params["voice_id"], "calm")
        self.assertNotIn("photo_url", params)

    def test_persona_params_forwards_the_identity_niche(self):
        params = fs.build_persona_params(
            {"name": "Ana", "voice_id": "calm", "niche": "barista caseiro"},
            store=MagicMock(),
        )
        self.assertEqual(params["niche"], "barista caseiro")

    def test_persona_params_photo_path_and_voice_audio(self):
        store = MagicMock(return_value="https://signed/x")
        store.signed_url = MagicMock(side_effect=lambda bucket, path: f"https://signed/{path}")
        params = fs.build_persona_params(
            {"name": "", "photo_path": "u/f.png", "voice_audio_path": "u/v.mp3"},
            store=store,
        )
        self.assertEqual(params["name"], "Persona")
        self.assertEqual(params["photo_url"], "https://signed/u/f.png")
        self.assertEqual(params["voice_audio_url"], "https://signed/u/v.mp3")

    def test_persona_params_passes_through_a_snapshot_audio_url(self):
        store = MagicMock()
        params = fs.build_persona_params(
            {"voice_audio_url": "https://cdn/v.mp3"},
            store=store,
        )
        self.assertEqual(params["voice_audio_url"], "https://cdn/v.mp3")
        self.assertNotIn("voice_id", params)
        store.signed_url.assert_not_called()

    def test_persona_params_faceless_drops_visual_identity(self):
        store = MagicMock()
        store.signed_url = MagicMock(
            side_effect=AssertionError("must not sign a photo for a faceless post")
        )
        params = fs.build_persona_params(
            {
                "name": "Ana",
                "avatar_url": "https://cdn/a.png",
                "photo_path": "u/f.png",
                "voice_id": "calm",
            },
            store=store,
            video_type="faceless",
        )
        self.assertEqual(params["name"], "Ana")
        self.assertEqual(params["voice_id"], "calm")
        self.assertNotIn("avatar_url", params)
        self.assertNotIn("photo_url", params)

    def test_slot_refund_amount_returns_the_stored_charge(self):
        self.assertEqual(fs.slot_refund_amount({"id": "s", "charged_tokens": 15}), 15)
        self.assertEqual(fs.slot_refund_amount({"id": "s", "charged_tokens": 1}), 1)

    def test_slot_refund_amount_ignores_the_video_type(self):
        slot = {"id": "s", "video_type": "faceless", "charged_tokens": 7}
        self.assertEqual(fs.slot_refund_amount(slot), 7)

    def test_slot_refund_amount_is_none_for_a_free_slot(self):
        self.assertIsNone(fs.slot_refund_amount({"id": "s", "charged_tokens": 0}))

    def test_slot_refund_amount_is_none_for_an_unreadable_charge(self):
        for bad in (None, -1, 1.5, "2", True, False):
            with self.subTest(charged_tokens=bad):
                self.assertIsNone(fs.slot_refund_amount({"id": "s", "charged_tokens": bad}))
        self.assertIsNone(fs.slot_refund_amount({"id": "s"}))

    def test_publish_due_skips_without_base_url(self):
        scheduler = self._scheduler(_FakeStore())
        scheduler.publisher.base_url = ""
        scheduler.publisher.api_secret = "secret"
        self.assertEqual(scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC)), 0)

    def test_publish_due_skips_without_api_secret(self):
        scheduler = self._scheduler(_FakeStore())
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = ""
        self.assertEqual(scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC)), 0)

    def test_due_slot_without_videos_fails(self):
        store = _FakeStore()
        store.ready_due_slots = lambda now: [
            {
                "id": "slot-x",
                "title": "T",
                "task_id": "t-1",
                "schedules": {"user_id": "u1", "providers": []},
            }
        ]
        state = MagicMock()
        state.get_task.return_value = {"state": 1, "videos": []}
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=MagicMock(),
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        self.assertEqual(scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC)), 0)
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertIn("no finished videos", store.updates[0][1]["error"])

    def test_due_slot_without_videos_emits_publish_failed(self):
        from app.services.fill_schedule import publish as pub_module

        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]
        state = MagicMock()
        state.get_task.return_value = {"state": 1, "videos": []}
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=MagicMock(),
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        with patch.object(pub_module, "track_event") as track:
            scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        failed_calls = [c for c in track.call_args_list if c[0][0] == "video_publish_failed"]
        self.assertEqual(len(failed_calls), 1)
        _, props = failed_calls[0][0]
        self.assertEqual(props["reason"], "task has no finished videos")
        self.assertFalse(props["retryable"])
        self.assertEqual(props["slotId"], "slot-1")
        self.assertEqual(props["task_id"], "t-1")
        self.assertEqual(props["user_id"], "user-1")

    def test_reconcile_skips_unknown_task(self):
        store = _FakeStore()
        store.generating_slots = lambda: [{"id": "slot-1", "task_id": "ghost", "schedules": {}}]
        state = MagicMock()
        state.get_task.return_value = None
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=MagicMock(),
        )
        self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 0)
        self.assertEqual(store.updates, [])

    def test_run_once_returns_stage_counts(self):
        store = _FakeStore()
        store.pending_slots = lambda now, limit: []
        store.generating_slots = lambda: []
        store.ready_due_slots = lambda now: []
        scheduler = fs.FillScheduleScheduler(
            store=store,
            task_state=MagicMock(),
            publish_video=MagicMock(),
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        results = scheduler.run_once(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(sorted(results.keys()), ["generated", "published", "reconciled"])

    def test_persona_for_raises_without_embed(self):
        with self.assertRaises(RuntimeError) as ctx:
            fs.persona_for({"id": "sched-1"})
        self.assertIn("no persona embed", str(ctx.exception))

    def test_metadata_for_bluesky_truncates_caption(self):
        metadata = fs.metadata_for(
            "bluesky",
            "x" * 500,
            {"bluesky_account_ids": ["did:1"]},
            "x" * 500,
        )
        from app.services.upload_publisher import BlueskyMetadata, BLUESKY_CAPTION_MAX_GRAPHEMES

        self.assertIsInstance(metadata, BlueskyMetadata)
        self.assertLessEqual(len(metadata.caption), BLUESKY_CAPTION_MAX_GRAPHEMES)

    def test_metadata_for_unsupported_provider_raises(self):
        with self.assertRaises(RuntimeError) as ctx:
            fs.metadata_for("tiktok", "title", {}, "Agent description.")
        self.assertIn("unsupported schedule provider", str(ctx.exception))

    def test_validate_publish_plan_accepts_all_providers(self):
        schedule = {
            "providers": ["youtube", "instagram", "bluesky", "linkedin"],
            "youtube_account_ids": ["yt-1"],
            "instagram_account_ids": ["ig-1"],
            "bluesky_account_ids": ["did:1"],
            "linkedin_account_ids": ["urn:li:person:1"],
        }
        fs.validate_publish_plan(schedule, "title", "Agent description.")

    def test_validate_publish_plan_rejects_bluesky_without_accounts(self):
        with self.assertRaises(ValueError) as ctx:
            fs.validate_publish_plan(
                {"providers": ["bluesky"], "bluesky_account_ids": []}, "", "Agent description."
            )
        self.assertIn("bluesky", str(ctx.exception))

    def test_start_fill_schedule_thread_runs_ticks(self):
        import threading
        import time as time_module

        ticks = []

        class _SpyScheduler:
            def run_once(self, now):
                ticks.append(now)

        thread = fs.start_fill_schedule_thread(_SpyScheduler())
        self.assertIsInstance(thread, threading.Thread)
        self.assertTrue(thread.daemon)
        time_module.sleep(0.15)
        self.assertGreaterEqual(len(ticks), 1)

    def test_publish_claims_slot_before_publishing(self):
        store = _FakeStore()
        store.claim_ready_slot = MagicMock(return_value=True)
        store.ready_due_slots = lambda now: [self._slot()]
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        publish = MagicMock(return_value={"success": True, "results": [{"success": True}]})
        manager = MagicMock()
        manager.attach_mock(store.claim_ready_slot, "claim")
        manager.attach_mock(publish, "publish")
        scheduler = self._scheduler(store, task_state=state, publish_video=publish)
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"

        published = scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(published, 1)
        store.claim_ready_slot.assert_called_once_with(
            "slot-1", datetime(2026, 9, 7, 12, 0, tzinfo=UTC)
        )
        self.assertEqual(
            [call[0] for call in manager.mock_calls],
            ["claim", "publish"],
        )
        publish.assert_called_once()
        self.assertEqual(store.updates[-1][1]["status"], "published")

    def test_publish_skips_slot_already_claimed(self):
        store = _FakeStore()
        store.claim_ready_slot = MagicMock(return_value=False)
        store.ready_due_slots = lambda now: [self._slot()]
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        publish = MagicMock()
        scheduler = self._scheduler(store, task_state=state, publish_video=publish)
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"

        published = scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(published, 0)
        publish.assert_not_called()
        self.assertEqual(store.updates, [])

    def test_transient_publish_failure_after_claim_stays_publishing(self):
        from app.services.upload_publisher import PublishError

        store = _FakeStore()
        store.claim_ready_slot = MagicMock(return_value=True)
        store.ready_due_slots = lambda now: [self._slot()]
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        notify = MagicMock()
        scheduler = self._scheduler(
            store,
            task_state=state,
            notify=notify,
            publish_video=MagicMock(side_effect=PublishError("boom")),
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"

        published = scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(published, 0)
        statuses = [fields.get("status") for _, fields in store.updates]
        self.assertIn("publishing", statuses)
        self.assertNotIn("ready", statuses)
        notify.assert_not_called()

    def test_resumable_lookup_log_names_the_root_cause(self):
        store = _FakeStore()
        store.resumable_publishing_slots = MagicMock(
            side_effect=ConnectionError(
                "HTTPSConnectionPool(host='db.example', port=443): Max retries "
                "exceeded with url: /rest/v1/scheduled_posts?select="
                + "x" * 600
                + " (Caused by NameResolutionError('Failed to resolve'))"
            )
        )
        store.ready_due_slots = lambda now: []
        scheduler = self._scheduler(store)
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"

        records = []
        handler_id = logger.add(lambda message: records.append(message.record))
        try:
            scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        finally:
            logger.remove(handler_id)
        messages = [r["message"] for r in records if r["level"].name == "WARNING"]
        self.assertTrue(
            any("NameResolutionError" in m for m in messages),
            f"expected the resume lookup log to name the root cause, got: {messages}",
        )

    def test_safe_diagnostic_is_confined_to_log_only_sites(self):
        import ast
        import pathlib

        def called_helpers(path):
            """Helper names actually CALLED in the file.

            Parsed, not grepped: the explanatory comments name both helpers,
            so a substring match would pass even after the call site changed.
            """
            tree = ast.parse(path.read_text())
            names = set()
            for node in ast.walk(tree):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and node.func.attr in {"safe_reason", "safe_diagnostic"}
                ):
                    names.add(node.func.attr)
            return names

        root = pathlib.Path(fs.__file__).parent
        by_file = {p.name: called_helpers(p) for p in root.glob("*.py")}

        self.assertIn(
            "safe_diagnostic",
            by_file["publish.py"],
            "publish.py lost its safe_diagnostic call site",
        )
        log_only = {"scheduler.py", "publish.py"}
        for name, names in by_file.items():
            if name in log_only:
                continue
            self.assertNotIn(
                "safe_diagnostic",
                names,
                f"{name} calls safe_diagnostic on a user-facing path",
            )

    def test_a_failed_stage_disables_retries_for_the_rest_of_the_tick(self):
        store = _FakeStore()
        store.pending_slots = MagicMock(side_effect=ConnectionError("dns"))
        store.generating_slots = MagicMock(side_effect=ConnectionError("dns"))
        store.ready_due_slots = MagicMock(side_effect=ConnectionError("dns"))
        scheduler = self._scheduler(store)
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"

        results = scheduler.run_once(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(results, {"generated": -1, "reconciled": -1, "published": -1})
        self.assertEqual(store.connect_retries, 0)
        self.assertEqual(store.retry_calls, [fs.store.CONNECT_RETRIES, 0, 0, 0])

    def test_breaker_rearms_at_the_start_of_the_next_tick(self):
        store = _FakeStore()
        store.pending_slots = MagicMock(side_effect=[ConnectionError("dns"), []])
        store.generating_slots = MagicMock(return_value=[])
        store.ready_due_slots = MagicMock(return_value=[])
        scheduler = self._scheduler(store)
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"

        scheduler.run_once(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(store.connect_retries, 0)
        scheduler.run_once(datetime(2026, 9, 7, 12, 1, tzinfo=UTC))
        self.assertEqual(store.connect_retries, fs.store.CONNECT_RETRIES)
        self.assertEqual(store.retry_calls[-1], fs.store.CONNECT_RETRIES)

    def test_a_healthy_tick_keeps_retries_armed(self):
        store = _FakeStore()
        store.pending_slots = MagicMock(return_value=[])
        store.generating_slots = MagicMock(return_value=[])
        store.ready_due_slots = MagicMock(return_value=[])
        scheduler = self._scheduler(store)
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"

        results = scheduler.run_once(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(results["generated"], 0)
        self.assertEqual(store.connect_retries, fs.store.CONNECT_RETRIES)

    def _outage_scheduler(self, error):
        store = _FakeStore()
        store.pending_slots = MagicMock(side_effect=error)
        store.generating_slots = MagicMock(side_effect=error)
        store.ready_due_slots = MagicMock(side_effect=error)
        scheduler = self._scheduler(store)
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        return store, scheduler

    def _run_ticks(self, scheduler, minutes):
        records = []
        handler_id = logger.add(lambda message: records.append(message.record))
        try:
            for minute in minutes:
                scheduler.run_once(
                    datetime(2026, 9, 7, 12, 0, tzinfo=UTC) + timedelta(minutes=minute)
                )
        finally:
            logger.remove(handler_id)
        return records

    @staticmethod
    def _messages(records, level):
        return [r["message"] for r in records if r["level"].name == level]

    def test_sustained_outage_logs_one_error_not_one_per_stage_per_tick(self):
        _, scheduler = self._outage_scheduler(
            requests.exceptions.ConnectionError("Failed to resolve 'db.example'")
        )
        records = self._run_ticks(scheduler, range(10))
        errors = self._messages(records, "ERROR")
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("connection outage started in stage generated", errors[0])
        self.assertIn("Failed to resolve", errors[0])
        warnings = self._messages(records, "WARNING")
        self.assertEqual(
            sum("failed during connection outage" in m for m in warnings), 29, warnings
        )

    def test_read_timeout_counts_as_an_outage(self):
        _, scheduler = self._outage_scheduler(
            requests.exceptions.ReadTimeout("Read timed out. (read timeout=30)")
        )
        errors = self._messages(self._run_ticks(scheduler, range(3)), "ERROR")
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("ReadTimeout", errors[0])

    def test_long_outage_repeats_the_error_every_reminder_interval(self):
        _, scheduler = self._outage_scheduler(requests.exceptions.ConnectionError("dns"))
        reminder_minutes = fs.scheduler.OUTAGE_REMINDER_SECONDS // 60
        errors = self._messages(
            self._run_ticks(scheduler, range(2 * reminder_minutes + 1)), "ERROR"
        )
        self.assertEqual(len(errors), 3, errors)
        self.assertIn("connection outage ongoing for 1800s", errors[1])
        self.assertIn("connection outage ongoing for 3600s", errors[2])

    def test_recovery_logs_the_outage_summary_and_resets(self):
        store, scheduler = self._outage_scheduler(requests.exceptions.ConnectionError("dns"))
        records = self._run_ticks(scheduler, [0, 1])
        store.pending_slots = MagicMock(return_value=[])
        store.generating_slots = MagicMock(return_value=[])
        store.ready_due_slots = MagicMock(return_value=[])
        records += self._run_ticks(scheduler, [2])
        self.assertIn(
            "fill_schedule: connection outage over after 120s and 6 failed stages",
            self._messages(records, "WARNING"),
        )
        store.pending_slots = MagicMock(side_effect=requests.exceptions.ConnectionError("dns"))
        errors = self._messages(self._run_ticks(scheduler, [3]), "ERROR")
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("connection outage started", errors[0])

    def test_non_connection_failures_still_error_on_every_tick(self):
        _, scheduler = self._outage_scheduler(RuntimeError("bad row"))
        errors = self._messages(self._run_ticks(scheduler, range(2)), "ERROR")
        self.assertEqual(len(errors), 6, errors)
        self.assertTrue(all("failed: RuntimeError" in m for m in errors), errors)

    def test_disarmed_store_still_sends_auth_headers_and_reads_rows(self):
        store = fs.ScheduleStore.__new__(fs.ScheduleStore)
        store._requests = build_retrying_session()
        store._headers = {"Authorization": "Bearer service-key"}
        session_before = store._requests
        adapter_before = store._requests.get_adapter("https://supabase.example")
        pool_before = adapter_before.poolmanager
        store.connect_retries = fs.store.CONNECT_RETRIES
        store.set_connect_retries(0)
        self.assertIs(store._requests, session_before)
        adapter_after = store._requests.get_adapter("https://supabase.example")
        self.assertEqual(adapter_after.max_retries.connect, 0)
        self.assertIs(adapter_after, adapter_before)
        self.assertIs(adapter_after.poolmanager, pool_before)
        self.assertTrue(store._requests.headers.get("User-Agent"))
        self.assertIn("Authorization", store._headers)

    def test_task_id_is_deterministic_per_slot(self):
        first = fs.new_task_id({"id": "slot-abc"})
        second = fs.new_task_id({"id": "slot-abc"})
        other = fs.new_task_id({"id": "slot-xyz"})
        self.assertEqual(first, second)
        self.assertNotEqual(first, other)

    def test_generate_uses_deterministic_task_id(self):
        slot = {
            "id": "slot-1",
            "slot_at": "2026-09-07T12:00:00+00:00",
            "title": "Batch title",
            "description": "Agent description.",
            "video_type": "faceless",
            "segments": [
                {
                    "kind": "hook",
                    "text": "Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is still waiting nearby for you today.",
                    "media": [{"url": "https://example.com/h0.jpg"}, {"url": "https://example.com/h1.jpg"}, {"url": "https://example.com/h2.jpg"}, {"url": "https://example.com/h3.jpg"}, {"url": "https://example.com/h4.jpg"}],
                },
                {
                    "kind": "content",
                    "text": "Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.",
                    "media": [
                        {"url": "https://example.com/b0.jpg"},
                        {"url": "https://example.com/b1.jpg"},
                        {"url": "https://example.com/b2.jpg"},
                        {"url": "https://example.com/b3.jpg"},
                        {"url": "https://example.com/b4.jpg"},
                        {"url": "https://example.com/b5.jpg"}, {"url": "https://example.com/b6.jpg"}, {"url": "https://example.com/b7.jpg"},
                    ],
                },
                {
                    "kind": "content",
                    "text": "Save this video before your next trip to Porto.",
                    "media": [
                        {"url": "https://example.com/c0.jpg"},
                        {"url": "https://example.com/c1.jpg"},
                    ],
                },
            ],
            "schedules": {
                "id": "sched-1",
                "user_id": "user-1",
                "providers": ["youtube"],
                "youtube_account_ids": ["yt-1"],
                "personas": {
                    "name": "Ana",
                    "niche": "travel",
                    "language": "en",
                    "voice_id": "calm",
                },
            },
        }
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot]
        scheduler = self._scheduler(
            store,
        )
        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch_generation:
            scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        task_id, _, _ = dispatch_generation.call_args.args
        self.assertEqual(task_id, fs.new_task_id({"id": "slot-1"}))

    def test_invalid_horizon_falls_back_to_default(self):
        from app.config import config as app_config

        original = app_config.app.get("fill_schedule_generation_horizon_hours")
        app_config.app["fill_schedule_generation_horizon_hours"] = "abc"
        try:
            self.assertEqual(fs.ScheduleStore.generation_horizon_hours(), 24)
        finally:
            if original is None:
                app_config.app.pop("fill_schedule_generation_horizon_hours", None)
            else:
                app_config.app["fill_schedule_generation_horizon_hours"] = original

    def test_negative_horizon_falls_back_to_default(self):
        from app.config import config as app_config

        original = app_config.app.get("fill_schedule_generation_horizon_hours")
        app_config.app["fill_schedule_generation_horizon_hours"] = -5
        try:
            self.assertEqual(fs.ScheduleStore.generation_horizon_hours(), 24)
        finally:
            if original is None:
                app_config.app.pop("fill_schedule_generation_horizon_hours", None)
            else:
                app_config.app["fill_schedule_generation_horizon_hours"] = original

    def test_run_once_isolates_stage_failures(self):
        store = _FakeStore()
        store.pending_slots = MagicMock(side_effect=RuntimeError("supabase down"))
        store.generating_slots = lambda: [{"id": "s1", "task_id": "t1", "schedules": {}}]
        store.ready_due_slots = lambda now: []
        state = MagicMock()
        state.get_task.return_value = {"state": 1}
        scheduler = self._scheduler(store, task_state=state)
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"

        results = scheduler.run_once(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(results["generated"], -1)
        self.assertEqual(results["reconciled"], 1)
        self.assertEqual(store.updates[0][1]["status"], "ready")

    def test_failed_stage_logs_at_error_level(self):
        store = _FakeStore()
        store.pending_slots = MagicMock(side_effect=RuntimeError("supabase down"))
        scheduler = self._scheduler(store)
        records = []
        handler_id = logger.add(lambda message: records.append(message.record))
        try:
            scheduler.run_once(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        finally:
            logger.remove(handler_id)
        self.assertTrue(
            any(
                record["level"].name == "ERROR" and "stage generated failed" in record["message"]
                for record in records
            ),
            f"expected an ERROR record about the failed stage, got: {[r['message'] for r in records]}",
        )

    def test_failed_stage_log_names_the_root_cause(self):
        store = _FakeStore()
        store.pending_slots = MagicMock(
            side_effect=ConnectionError(
                "Max retries exceeded with url: /rest/v1/scheduled_posts?select="
                + "x" * 600
                + " (Caused by NameResolutionError('Failed to resolve'))"
            )
        )
        scheduler = self._scheduler(store)
        records = []
        handler_id = logger.add(lambda message: records.append(message.record))
        try:
            scheduler.run_once(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        finally:
            logger.remove(handler_id)
        messages = [r["message"] for r in records if r["level"].name == "ERROR"]
        self.assertTrue(
            any("ConnectionError" in m and "NameResolutionError" in m for m in messages),
            f"expected the stage log to name the class and root cause, got: {messages}",
        )


if __name__ == "__main__":
    unittest.main()


class BatchDispatchTests(unittest.TestCase):
    """Batch schedules: parallel generation dispatch within the generation
    horizon. Slots beyond the horizon are not dispatched.
    """

    def _batch_slot(self, title="Batch title one"):
        return {
            "id": "slot-batch-1",
            "slot_at": "2026-09-08T09:00:00+00:00",
            "title": title,
            "description": "Agent description.",
            "video_type": "hook_lipsync",
            "charged_tokens": 2,
            "segments": [
                {
                    "kind": "hook",
                    "text": "Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is still waiting nearby for you today.",
                    "media": [{"url": "https://example.com/h0.jpg"}, {"url": "https://example.com/h1.jpg"}, {"url": "https://example.com/h2.jpg"}, {"url": "https://example.com/h3.jpg"}, {"url": "https://example.com/h4.jpg"}],
                },
                {
                    "kind": "content",
                    "text": "Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.",
                    "media": [
                        {"url": "https://example.com/b0.jpg"},
                        {"url": "https://example.com/b1.jpg"},
                        {"url": "https://example.com/b2.jpg"},
                        {"url": "https://example.com/b3.jpg"},
                        {"url": "https://example.com/b4.jpg"},
                        {"url": "https://example.com/b5.jpg"}, {"url": "https://example.com/b6.jpg"}, {"url": "https://example.com/b7.jpg"},
                    ],
                },
                {
                    "kind": "content",
                    "text": "Save this video before your next trip to Porto.",
                    "media": [
                        {"url": "https://example.com/c0.jpg"},
                        {"url": "https://example.com/c1.jpg"},
                    ],
                },
            ],
            "schedules": {
                "id": "sched-batch-1",
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

    def _scheduler(self, store):
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=MagicMock(), publish_video=MagicMock()
        )
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")
        return scheduler

    def test_batch_slot_beyond_horizon_is_not_dispatched(self):
        slot = self._batch_slot()
        slot["slot_at"] = "2026-09-11T09:00:00+00:00"
        store = _FakeStore()
        store.pending_slots = lambda now, limit: []
        scheduler = self._scheduler(store)
        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(enqueued, 0)
        dispatch.assert_not_called()

    def test_batch_slots_keep_parallel_dispatch(self):
        from app.controllers.manager.memory_manager import InMemoryTaskManager

        slot1 = self._batch_slot()
        slot1["id"] = "slot-b1"
        slot2 = self._batch_slot()
        slot2["id"] = "slot-b2"
        store = _FakeStore()
        store.pending_slots = lambda now, limit: [slot1, slot2]
        scheduler = self._scheduler(store)
        manager = InMemoryTaskManager(max_concurrent_tasks=2, max_queued_tasks=10)
        with (
            patch("app.controllers.v1.video.task_manager", manager),
            patch.object(scheduler.generator, "_dispatch_generation") as dispatch,
        ):
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(enqueued, 2)
        self.assertEqual(dispatch.call_count, 2)


class PostIdentityTests(unittest.TestCase):
    """post_identity — the persona is optional; the schedule snapshot is not.

    A persona-less post (migration 012) has no embed at all, so the engine has
    to read voice/aspect from the ``post_*`` columns. And when both
    exist, the snapshot wins: it is the value the web resolved and charged
    for at creation, so editing a persona must not rewrite a scheduled video.
    """

    def test_reads_the_persona_when_the_schedule_has_no_snapshot(self):
        identity = fs.post_identity(
            {
                "id": "sched-1",
                "personas": {"name": "Ana", "voice_id": "calm", "niche": "fitness"},
            }
        )
        self.assertEqual(identity["name"], "Ana")
        self.assertEqual(identity["voice_id"], "calm")
        self.assertEqual(identity["niche"], "fitness")

    def test_reads_a_persona_less_schedule_from_the_snapshot(self):
        identity = fs.post_identity(
            {
                "id": "sched-2",
                "personas": None,
                "post_voice_id": "energetic",
                "post_video_aspect": "16:9",
                "post_paragraph_number": 3,
                "post_face_quality": "ok",
            }
        )
        self.assertEqual(identity["voice_id"], "energetic")
        self.assertEqual(identity["video_aspect"], "16:9")
        self.assertEqual(identity["paragraph_number"], 3)
        self.assertEqual(identity["face_quality"], "ok")
        self.assertNotIn("script_prompt", identity)

    def test_snapshot_overrides_the_persona_embed(self):
        identity = fs.post_identity(
            {
                "id": "sched-3",
                "personas": {
                    "voice_id": "calm",
                    "video_aspect": "9:16",
                },
                "post_voice_id": "energetic",
                "post_video_aspect": "16:9",
            }
        )
        self.assertEqual(identity["voice_id"], "energetic")
        self.assertEqual(identity["video_aspect"], "16:9")

    def test_snapshot_cta_type_overrides_the_persona_embed(self):
        identity = fs.post_identity(
            {
                "id": "sched-cta",
                "personas": {"voice_id": "calm", "cta_type": "follow"},
                "post_cta_type": "comment",
            }
        )
        self.assertEqual(identity["cta_type"], "comment")

    def test_slot_select_reads_the_cta_type_columns(self):
        self.assertIn("post_cta_type", ScheduleStore.SLOT_IDENTITY_SELECT)
        self.assertIn("personas(name,niche,cta_type,", ScheduleStore.SLOT_IDENTITY_SELECT)
        self.assertNotIn("script_prompt", ScheduleStore.SLOT_IDENTITY_SELECT)

    def test_a_null_cta_snapshot_does_not_fall_back_to_the_persona(self):
        identity = fs.post_identity(
            {
                "id": "sched-cta-null",
                "personas": {"voice_id": "calm", "cta_type": "follow"},
                "post_voice_id": None,
                "post_cta_type": None,
            }
        )
        self.assertNotIn("cta_type", identity)
        self.assertEqual(identity["voice_id"], "calm")

    def test_a_null_snapshot_column_does_not_erase_the_persona_value(self):
        identity = fs.post_identity(
            {
                "id": "sched-4",
                "personas": {"voice_id": "calm", "niche": "fitness"},
                "post_voice_id": None,
                "post_niche": "",
            }
        )
        self.assertEqual(identity["voice_id"], "calm")
        self.assertEqual(identity["niche"], "fitness")

    def test_snapshot_audio_url_reaches_a_persona_less_identity(self):
        identity = fs.post_identity(
            {
                "id": "sched-7",
                "personas": None,
                "post_voice_id": None,
                "post_voice_audio_url": "https://cdn/v.mp3",
                "post_niche": "fitness",
            }
        )
        self.assertEqual(identity["voice_audio_url"], "https://cdn/v.mp3")
        self.assertNotIn("voice_id", identity)

    def test_raises_when_neither_a_persona_nor_a_snapshot_exists(self):
        with self.assertRaises(RuntimeError) as ctx:
            fs.post_identity({"id": "sched-5", "personas": None})
        self.assertIn("neither a persona nor a post snapshot", str(ctx.exception))

    def test_raises_on_a_malformed_embed_rather_than_reading_it(self):
        with self.assertRaises(RuntimeError):
            fs.post_identity({"id": "sched-6", "personas": ["not", "a", "dict"]})


class VoiceForTests(unittest.TestCase):
    """voice_for — `PersonaParams` demands exactly one voice, so a post that
    resolves none can never generate. The slot must fail here, before any
    dispatch, instead of dispatching a request the engine rejects opaquely."""

    def test_returns_the_voice_id(self):
        self.assertEqual(fs.voice_for({"voice_id": "calm"}), "calm")

    def test_raises_without_a_voice_id(self):
        with self.assertRaises(RuntimeError) as ctx:
            fs.voice_for({"name": "Ana"})
        self.assertIn("no voice", str(ctx.exception))

    def test_treats_an_empty_or_non_string_voice_as_absent(self):
        for value in (None, "", 0, False):
            with self.subTest(value=value):
                with self.assertRaises(RuntimeError):
                    fs.voice_for({"voice_id": value})

    def test_accepts_an_audio_voice_persona_without_a_voice_id(self):
        self.assertEqual(
            fs.voice_for({"name": "Ana", "voice_audio_path": "u/v.mp3"}),
            "u/v.mp3",
        )

    def test_accepts_a_snapshot_audio_url_for_a_persona_less_post(self):
        self.assertEqual(
            fs.voice_for({"voice_audio_url": "https://cdn/v.mp3"}),
            "https://cdn/v.mp3",
        )

    def test_prefers_voice_id_over_the_audio_spellings(self):
        self.assertEqual(
            fs.voice_for(
                {
                    "voice_id": "calm",
                    "voice_audio_url": "https://cdn/v.mp3",
                    "voice_audio_path": "u/v.mp3",
                }
            ),
            "calm",
        )




class FailedOutcomesTests(unittest.TestCase):
    def test_keeps_only_failed_outcomes_with_provider_account_and_reason(self):
        failures = _failed_outcomes(
            [
                {"provider": "youtube", "accountId": "UC1", "status": "published", "error": None},
                {"provider": "bluesky", "accountId": "did:plc:1", "status": "failed", "error": "unauthorized"},
                {"provider": "rumble", "accountId": "ch1", "status": "failed"},
                {"provider": "fanvue", "accountId": "fv1", "status": "retrying", "error": "boom"},
                "not-a-dict",
            ]
        )
        self.assertEqual(
            failures,
            [
                {"provider": "bluesky", "account_id": "did:plc:1", "reason": "unauthorized"},
                {"provider": "rumble", "account_id": "ch1", "reason": ""},
            ],
        )

    def test_empty_and_none_yield_no_failures(self):
        self.assertEqual(_failed_outcomes(None), [])
        self.assertEqual(_failed_outcomes([]), [])




class PartialPublishEmailTests(unittest.TestCase):
    def test_partial_publish_emails_the_owner_with_the_failed_account(self):
        slot = {
            "id": "slot-1",
            "task_id": "task-1",
            "title": "Daily Dose",
            "description": "Daily Dose description.",
            "user_id": "user-1",
            "schedules": {
                "id": "sched-1",
                "persona_id": "p-1",
                "personas": {"name": "Bicuda"},
                "providers": ["youtube", "bluesky"],
                "youtube_account_ids": ["UC1"],
                "bluesky_account_ids": ["did:plc:1"],
            },
        }
        store = MagicMock()
        store.claim_ready_slot.return_value = True
        store.persona_bound_accounts.return_value = {
            "youtube": ["UC1"],
            "bluesky": ["did:plc:1"],
        }
        task_state = MagicMock()
        task_state.get_task.return_value = {
            "videos": ["v.mp4"],
            "video_storage_path": "x/y.mp4",
        }
        result = AccountPublishResult(
            outcomes=[
                {"provider": "youtube", "accountId": "UC1", "status": "published"},
                {"provider": "bluesky", "accountId": "did:plc:1", "status": "failed", "error": "unauthorized"},
            ],
            published_providers=["youtube"],
            failed_providers=["bluesky"],
            non_user_failed_providers=["bluesky"],
            first_error="unauthorized",
            max_attempts=1,
            any_published=True,
        )
        publisher = BatchPublisher(store, task_state, notify=MagicMock())
        with (
            patch("app.services.fill_schedule.publish.publish_slot_accounts", return_value=result),
            patch("app.services.fill_schedule.publish.notify_owner_async") as notify_async,
        ):
            published = publisher._publish_one(
                slot, datetime(2026, 11, 12, 12, tzinfo=UTC), resumed=False
            )
        self.assertEqual(published, 1)
        notify_async.assert_called_once_with(
            notify_publish_partial,
            "user-1",
            slot_id="slot-1",
            title="Daily Dose",
            failures=[{"provider": "bluesky", "account_id": "did:plc:1", "reason": "unauthorized"}],
            persona="Bicuda",
        )
        self.assertTrue(
            any(call.kwargs.get("status") == "published" for call in store.update_slot.call_args_list)
        )

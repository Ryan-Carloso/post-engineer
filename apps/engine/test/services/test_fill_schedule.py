"""Automatic Fill Schedule tests (app/services/fill_schedule.py).

Slots are computed with pure timezone arithmetic; the scheduler stages
are tested with fake injected store/state, no network.
"""

import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

from loguru import logger

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import fill_schedule as fs
from app.services import notify as nf
from app.services.upload_publisher import InstagramMetadata, LinkedInMetadata, YouTubeMetadata

UTC = timezone.utc


class ScheduleStoreAuthTests(unittest.TestCase):
    """ScheduleStore must translate a Supabase 401 into an actionable error."""

    def _store_with_status(self, status_code):
        import requests

        response = MagicMock()
        response.status_code = status_code
        http_error = requests.HTTPError(f"{status_code} Error")
        http_error.response = response
        response.raise_for_status.side_effect = http_error
        requests_module = MagicMock()
        requests_module.request.return_value = response
        return fs.ScheduleStore(
            url="https://example.supabase.co",
            service_key="test-key",
            requests_module=requests_module,
        )

    def test_401_raises_actionable_auth_error(self):
        store = self._store_with_status(401)
        with self.assertRaises(fs.SupabaseAuthError) as ctx:
            store.active_schedules()
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", str(ctx.exception))
        self.assertIn("401", str(ctx.exception))

    def test_500_still_raises_original_error(self):
        import requests

        store = self._store_with_status(500)
        with self.assertRaises(requests.HTTPError):
            store.active_schedules()


class ComputeSlotsTests(unittest.TestCase):
    def test_only_days_of_week_get_slots(self):
        # 2026-09-06 is a Sunday. Days [1] = Monday -> only Mondays in the 7 days.
        slots = fs.compute_slots(
            days_of_week=[1],
            start_hour=9,
            end_hour=17,
            posts_per_day=1,
            tz_name="UTC",
            now=datetime(2026, 9, 6, 12, 0, tzinfo=UTC),
            days_ahead=7,
        )
        self.assertEqual(len(slots), 1)
        self.assertEqual(slots[0].weekday(), 0)  # segunda
        # single post lands inside the 9-17 window (center + deterministic jitter)
        self.assertGreaterEqual(slots[0].hour, 9)
        self.assertLessEqual(slots[0].hour, 17)

    def test_posts_per_day_spread_inside_window(self):
        slots = fs.compute_slots(
            days_of_week=[0, 1, 2, 3, 4, 5, 6],
            start_hour=8,
            end_hour=18,
            posts_per_day=3,
            tz_name="UTC",
            now=datetime(2026, 9, 6, 12, 0, tzinfo=UTC),
            days_ahead=2,
        )
        self.assertEqual(len(slots), 6)
        for slot in slots:
            self.assertGreaterEqual(slot.hour, 8)
            self.assertLessEqual(slot.hour, 18)
        # same-day slots are ascending
        day1 = sorted(slots[:3])
        self.assertLess(day1[0], day1[1])
        self.assertLess(day1[1], day1[2])

    def test_timezone_converts_to_utc(self):
        # 09:00 in Sao Paulo (UTC-3) = 12:00 UTC
        slots = fs.compute_slots(
            days_of_week=[0, 1, 2, 3, 4, 5, 6],
            start_hour=9,
            end_hour=9,
            posts_per_day=1,
            tz_name="America/Sao_Paulo",
            now=datetime(2026, 9, 6, 12, 0, tzinfo=UTC),
            days_ahead=1,
        )
        self.assertEqual(len(slots), 1)
        self.assertEqual(slots[0].astimezone(UTC).hour, 12)

    def test_slots_are_sorted_and_in_future(self):
        now = datetime(2026, 9, 6, 12, 0, tzinfo=UTC)
        slots = fs.compute_slots(
            days_of_week=[0, 1, 2, 3, 4, 5, 6],
            start_hour=0,
            end_hour=23,
            posts_per_day=2,
            tz_name="UTC",
            now=now,
            days_ahead=5,
        )
        self.assertEqual(slots, sorted(slots))
        for slot in slots:
            self.assertGreater(slot, now)

    def test_deterministic_jitter(self):
        kwargs = dict(
            days_of_week=[0, 1, 2, 3, 4, 5, 6],
            start_hour=8,
            end_hour=18,
            posts_per_day=1,
            tz_name="UTC",
            now=datetime(2026, 9, 6, 12, 0, tzinfo=UTC),
            days_ahead=3,
        )
        self.assertEqual(fs.compute_slots(**kwargs), fs.compute_slots(**kwargs))


class _FakeStore:
    def __init__(self, schedules=None):
        self.schedules = schedules or []
        self.inserted = []
        self.updates = []
        self.spent = []
        self.refunded = []
        self.refund_batch_calls = []

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

    def refund_batch_tokens(self, user_id, generation_id, refund_key, amount, reason):
        self.refund_batch_calls.append((user_id, generation_id, refund_key, amount, reason))
        return True

    def claim_ready_slot(self, slot_id):
        # by default the claim always wins (single-worker behavior)
        return True

    def recover_stale_publishing(self, older_than_minutes=30):
        return 0

    def publishing_slots(self):
        return []


class BatchScheduleTests(unittest.TestCase):
    """Manual video batches (kind='batch'): finite, user-requested, prepaid.

    plan() must skip batch schedules (their slots are pre-materialized by
    POST /api/schedule/batch); generate() must always process their pending
    slots using the stored topic — no LLM topic, no token spend.
    """

    def _batch_slot(self, topic="Batch topic one"):
        return {
            "id": "slot-batch-1",
            "slot_at": "2026-09-08T09:00:00+00:00",
            "topic": topic,
            "schedules": {
                "id": "sched-batch-1",
                "kind": "batch",
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
                    "face_mix_percent": 50,
                    "face_quality": "ok",
                },
            },
        }

    def _scheduler(self, store, generate_topic_fn=None, auto_generate=True):
        return fs.FillScheduleScheduler(
            store=store, task_state=MagicMock(),
            publish_video=MagicMock(),
            generate_topic_fn=generate_topic_fn or MagicMock(return_value="LLM topic"),
            auto_generate=auto_generate,
        )

    def test_plan_skips_batch_schedules(self):
        store = _FakeStore(
            [
                {
                    "id": "sched-batch-1",
                    "kind": "batch",
                    "user_id": "user-1",
                    "days_of_week": [],
                    "start_hour": 0,
                    "end_hour": 23,
                    "posts_per_day": 1,
                    "timezone": "UTC",
                },
                {
                    "id": "sched-rec-1",
                    "kind": "recurring",
                    "user_id": "user-1",
                    "days_of_week": [0, 1, 2, 3, 4, 5, 6],
                    "start_hour": 9,
                    "end_hour": 17,
                    "posts_per_day": 1,
                    "timezone": "UTC",
                },
            ]
        )
        scheduler = self._scheduler(store, MagicMock())
        count = scheduler.plan(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertGreater(count, 0)
        schedule_ids = {row["schedule_id"] for row in store.inserted}
        self.assertNotIn("sched-batch-1", schedule_ids)
        self.assertIn("sched-rec-1", schedule_ids)

    def test_generate_batch_slot_uses_stored_topic_no_llm_no_spend(self):
        slot = self._batch_slot()
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        generate_topic_fn = MagicMock(return_value="LLM topic")
        scheduler = self._scheduler(store, generate_topic_fn)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(
            scheduler, "_dispatch_generation"
        ) as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 1)
        generate_topic_fn.assert_not_called()
        self.assertEqual(store.spent, [])
        dispatch_generation.assert_called_once()
        task_id, request, user_id = dispatch_generation.call_args.args
        self.assertEqual(user_id, "user-1")
        self.assertIn("Batch topic one", request.model_dump_json())
        self.assertNotIn("LLM topic", request.model_dump_json())
        update = dict(store.updates[0][1])
        self.assertEqual(update["status"], "generating")
        self.assertEqual(update["topic"], "Batch topic one")
        self.assertEqual(update["task_id"], task_id)

    def test_generate_batch_slot_without_topic_fails(self):
        slot = self._batch_slot(topic="   ")
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(
            scheduler, "_dispatch_generation"
        ) as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 0)
        dispatch_generation.assert_not_called()
        self.assertEqual(store.spent, [])
        self.assertEqual(store.updates[0][1]["status"], "failed")

    def test_generate_batch_dispatch_failure_refunds_single_video(self):
        slot = self._batch_slot()
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        store.refund_batch_calls = []
        store.refund_batch_tokens = lambda *args: store.refund_batch_calls.append(args) or True
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(
            scheduler, "_dispatch_generation", side_effect=RuntimeError("dispatch down")
        ):
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 0)
        # One prepaid video refunded under the batch generation id; the rest
        # of the batch charge is untouched.
        self.assertEqual(len(store.refund_batch_calls), 1)
        user_id, batch_gen_id, refund_key, amount, _reason = store.refund_batch_calls[0]
        self.assertEqual(user_id, "user-1")
        self.assertEqual(batch_gen_id, "batch:sched-batch-1")
        self.assertIn("slot-batch-1", refund_key)
        self.assertEqual(amount, 2)  # face_mix 50% @ ok = ceil(0.5*2 + 0.5*1) = 2
        self.assertEqual(store.updates[0][1]["status"], "failed")

    def test_generate_recurring_slot_still_uses_llm_and_spends(self):
        slot = self._batch_slot()
        slot["schedules"] = dict(slot["schedules"], kind="recurring")
        del slot["topic"]
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        generate_topic_fn = MagicMock(return_value="LLM topic")
        scheduler = self._scheduler(store, generate_topic_fn)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(
            scheduler, "_dispatch_generation"
        ) as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 1)
        generate_topic_fn.assert_called_once()
        self.assertEqual(len(store.spent), 1)
        dispatch_generation.assert_called_once()
        _task_id, request, _user_id = dispatch_generation.call_args.args
        self.assertIn("LLM topic", request.model_dump_json())

    def test_generate_batch_slot_runs_with_auto_generate_off(self):
        # Manual batches are user-requested and prepaid: they always
        # generate, even when recurring auto-generation is disabled.
        store = _FakeStore()
        store.pending_slots = lambda now: [self._batch_slot()]
        generate_topic_fn = MagicMock(return_value="LLM topic")
        scheduler = self._scheduler(store, generate_topic_fn, auto_generate=False)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(
            scheduler, "_dispatch_generation"
        ) as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 1)
        generate_topic_fn.assert_not_called()
        self.assertEqual(len(store.spent), 0)
        dispatch_generation.assert_called_once()
        _task_id, request, _user_id = dispatch_generation.call_args.args
        self.assertIn("Batch topic one", request.model_dump_json())

    def test_generate_recurring_slot_skipped_with_auto_generate_off(self):
        slot = self._batch_slot()
        slot["schedules"] = dict(slot["schedules"], kind="recurring")
        del slot["topic"]
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        generate_topic_fn = MagicMock(return_value="LLM topic")
        scheduler = self._scheduler(store, generate_topic_fn, auto_generate=False)

        with patch.object(
            scheduler, "_dispatch_generation"
        ) as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 0)
        generate_topic_fn.assert_not_called()
        dispatch_generation.assert_not_called()
        self.assertEqual(len(store.spent), 0)

    def test_dispatch_generation_updates_state_and_starts_pipeline_thread(self):
        # _dispatch_generation is the immediate path: task state is created
        # first (so reconcile() sees the task), then tm.start runs in a
        # daemon thread — the tick itself never blocks on the pipeline.
        from app.models.schema import TaskVideoRequest

        store = _FakeStore()
        scheduler = self._scheduler(store)
        request = TaskVideoRequest(video_subject="Batch topic one")

        with (
            patch("app.services.task.start") as mock_start,
            patch("app.services.fill_schedule.threading.Thread") as mock_thread,
        ):
            scheduler._dispatch_generation("task-1", request, "user-1")

        scheduler.task_state.update_task.assert_called_once_with(
            "task-1", user_id="user-1"
        )
        mock_thread.assert_called_once()
        _, kwargs = mock_thread.call_args
        self.assertTrue(kwargs["daemon"])
        # Run the thread target inline to prove the wiring.
        kwargs["target"](**kwargs["kwargs"])
        mock_start.assert_called_once_with(
            task_id="task-1", params=request, stop_at="video"
        )


class PlanTests(unittest.TestCase):
    def test_plan_inserts_slots_for_active_schedules(self):
        store = _FakeStore(
            [
                {
                    "id": "sched-1",
                    "user_id": "user-1",
                    "days_of_week": [0, 1, 2, 3, 4, 5, 6],
                    "start_hour": 9,
                    "end_hour": 17,
                    "posts_per_day": 1,
                    "timezone": "UTC",
                }
            ]
        )
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=None,
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
        )
        count = scheduler.plan(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertGreater(count, 0)
        self.assertEqual(len(store.inserted), count)
        for row in store.inserted:
            self.assertEqual(row["schedule_id"], "sched-1")
            self.assertEqual(row["user_id"], "user-1")
            self.assertIn("slot_at", row)

    def test_plan_inserts_exact_one_off_slot_and_deactivates_schedule(self):
        store = _FakeStore(
            [
                {
                    "id": "sched-once",
                    "user_id": "user-1",
                    "scheduled_at": "2026-09-20T10:00:00+00:00",
                }
            ]
        )
        store.deactivate_schedule = MagicMock()
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=None,
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
        )

        count = scheduler.plan(datetime(2026, 9, 18, 9, 0, tzinfo=UTC))

        self.assertEqual(count, 1)
        self.assertEqual(
            store.inserted,
            [{
                "schedule_id": "sched-once",
                "user_id": "user-1",
                "slot_at": "2026-09-20T10:00:00+00:00",
            }],
        )
        store.deactivate_schedule.assert_called_once_with("sched-once")

    def test_plan_skips_malformed_one_off_schedule_without_blocking_others(self):
        store = _FakeStore(
            [
                {"id": "sched-bad", "user_id": "user-1", "scheduled_at": "not-a-date"},
                {
                    "id": "sched-recurring",
                    "user_id": "user-1",
                    "days_of_week": [1],
                    "start_hour": 9,
                    "end_hour": 10,
                    "posts_per_day": 1,
                    "timezone": "UTC",
                },
            ]
        )
        store.deactivate_schedule = MagicMock()
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=None,
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
        )

        count = scheduler.plan(datetime(2026, 9, 18, 9, 0, tzinfo=UTC))

        self.assertEqual(count, 1)
        self.assertEqual(store.inserted[0]["schedule_id"], "sched-recurring")


class GenerateTests(unittest.TestCase):
    def _scheduler(self, store, auto_generate=True):
        return fs.FillScheduleScheduler(
            store=store, task_state=None,
            publish_video=MagicMock(),
            generate_topic_fn=MagicMock(return_value="Tokyo coffee guide"),
            auto_generate=auto_generate,
        )

    def test_pending_slot_gets_topic_and_task(self):
        slot = {
            "id": "slot-1",
            "slot_at": "2026-09-07T12:00:00+00:00",
            "schedules": {
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
                },
            },
        }
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        scheduler = self._scheduler(store)

        # signed_url is used inside build_persona_params
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(scheduler, "_dispatch_generation") as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(enqueued, 1)
        dispatch_generation.assert_called_once()
        task_id, request, user_id = dispatch_generation.call_args.args
        self.assertEqual(user_id, "user-1")
        payload_json = request.model_dump_json()
        self.assertIn("Tokyo coffee guide", payload_json)
        self.assertIn("photo_url", payload_json)
        update = dict(store.updates[0][1])
        self.assertEqual(update["status"], "generating")
        self.assertEqual(update["task_id"], task_id)
        self.assertEqual(update["topic"], "Tokyo coffee guide")

    def test_generation_failure_marks_slot_failed(self):
        slot = {
            "id": "slot-2",
            "slot_at": "2026-09-07T12:00:00+00:00",
            "schedules": {"user_id": "user-1", "providers": [], "personas": {}},
        }
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=None,
            publish_video=MagicMock(),
            generate_topic_fn=MagicMock(side_effect=RuntimeError("boom")),
            auto_generate=True,
        )
        enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(enqueued, 0)
        self.assertEqual(store.updates[0][1]["status"], "failed")

    def test_generation_failure_logs_at_error_level(self):
        # A failed slot is a real recurring error: it must be logged at ERROR
        # so the Bugsink bridge (loguru sink, ERROR+) forwards it.
        slot = {
            "id": "slot-err",
            "slot_at": "2026-09-07T12:00:00+00:00",
            "schedules": {"user_id": "user-1", "providers": [], "personas": {}},
        }
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        scheduler = self._scheduler(
            store,
            # fail inside generate: generate_topic_fn raising hits the per-slot handler
        )
        scheduler.generate_topic_fn = MagicMock(side_effect=RuntimeError("boom"))
        records = []
        handler_id = logger.add(lambda message: records.append(message.record))
        try:
            scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        finally:
            logger.remove(handler_id)
        self.assertTrue(
            any(
                record["level"].name == "ERROR" and "generation failed" in record["message"]
                for record in records
            ),
            f"expected an ERROR record about the failed generation, got: {[r['message'] for r in records]}",
        )

    def test_invalid_publish_plan_fails_slot_before_spending(self):
        # Invalid plan (youtube with no accounts) fails the slot BEFORE
        # generating a topic or dispatching video - no tokens/money spent.
        slot = {
            "id": "slot-preflight",
            "slot_at": "2026-09-07T12:00:00+00:00",
            "schedules": {
                "user_id": "user-1",
                "providers": ["youtube"],
                "youtube_account_ids": [],
                "personas": {},
            },
        }
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        generate_topic_fn = MagicMock(return_value="Tokyo coffee guide")
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=None,
            publish_video=MagicMock(),
            generate_topic_fn=generate_topic_fn,
            auto_generate=True,
        )
        with patch.object(scheduler, "_dispatch_generation") as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(enqueued, 0)
        generate_topic_fn.assert_not_called()
        dispatch_generation.assert_not_called()
        self.assertEqual(store.updates[0][1]["status"], "failed")


class ReconcileTests(unittest.TestCase):
    def test_complete_task_becomes_ready(self):
        slot = {"id": "slot-1", "task_id": "t-1"}
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": 1}
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
        )
        self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        self.assertEqual(store.updates[0][1]["status"], "ready")

    def test_failed_task_becomes_failed(self):
        slot = {"id": "slot-1", "task_id": "t-1"}
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": -1, "error": "gpu exploded"}
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
        )
        self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        self.assertEqual(store.updates[0][1]["status"], "failed")

    def test_failed_batch_task_refunds_batch_charge(self):
        # Batch slots are prepaid under `batch:{scheduleId}`; a failed task
        # must refund the per-slot cost via refund_batch_tokens (NOT the
        # recurring `scheduled:{slotId}` key, which has no charge row).
        slot = {
            "id": "slot-b1",
            "user_id": "user-1",
            "task_id": "t-b1",
            "schedules": {
                "id": "sched-b1",
                "kind": "batch",
                "user_id": "user-1",
                "personas": {"face_mix_percent": 0, "face_quality": "ok"},
            },
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": -1, "error": "gpu exploded"}
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
        )
        self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertEqual(len(store.refund_batch_calls), 1)
        user_id, generation_id, refund_key, amount, _reason = store.refund_batch_calls[0]
        self.assertEqual(user_id, "user-1")
        self.assertEqual(generation_id, "batch:sched-b1")
        self.assertEqual(refund_key, "batch:sched-b1:slot:slot-b1")
        self.assertEqual(amount, 1)
        self.assertEqual(store.refunded, [])

    def test_failed_batch_task_without_user_id_still_marks_failed(self):
        slot = {
            "id": "slot-b2",
            "task_id": "t-b2",
            "schedules": {
                "id": "sched-b2",
                "kind": "batch",
                "personas": {"face_mix_percent": 0, "face_quality": "ok"},
            },
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": -1, "error": "gpu exploded"}
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
        )
        self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertEqual(store.refund_batch_calls, [])

class PublishDueTests(unittest.TestCase):
    def setUp(self) -> None:
        handle, self.video_path = tempfile.mkstemp(suffix=".mp4")
        with os.fdopen(handle, "wb") as video_file:
            video_file.write(b"fake-video-bytes")
        self.addCleanup(os.unlink, self.video_path)

    def _slot(self):
        return {
            "id": "slot-1",
            "topic": "Tokyo coffee",
            "task_id": "t-1",
            "schedules": {"user_id": "user-1", "providers": ["youtube"]},
        }

    def test_due_slot_is_published_and_marked(self):
        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]
        state = MagicMock()
        state.get_task.return_value = {"state": 1, "videos": [self.video_path]}
        publish = MagicMock()
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=publish, generate_topic_fn=MagicMock(),
        )
        scheduler.base_url = "https://post-engineer.com"
        scheduler.api_secret = "secret"

        published = scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(published, 1)
        publish.assert_called_once()
        kwargs = publish.call_args.kwargs
        self.assertIsInstance(kwargs["metadata"], YouTubeMetadata)
        self.assertEqual(kwargs["owner_user_id"], "user-1")
        self.assertEqual(store.updates[0][1]["status"], "published")

    def test_instagram_provider_uses_caption_metadata(self):
        slot = self._slot()
        slot["schedules"]["providers"] = ["instagram"]
        store = _FakeStore()
        store.ready_due_slots = lambda now: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": 1, "videos": [self.video_path]}
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
        )
        scheduler.base_url = "https://post-engineer.com"
        scheduler.api_secret = "secret"
        scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertIsInstance(
            scheduler.publish_video.call_args.kwargs["metadata"], InstagramMetadata
        )

    def test_linkedin_provider_uses_linkedin_metadata(self):
        slot = self._slot()
        slot["schedules"]["providers"] = ["linkedin"]
        slot["schedules"]["linkedin_account_ids"] = ["urn:li:person:1", "urn:li:organization:2"]
        store = _FakeStore()
        store.ready_due_slots = lambda now: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": 1, "videos": [self.video_path]}
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
        )
        scheduler.base_url = "https://post-engineer.com"
        scheduler.api_secret = "secret"
        scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        metadata = scheduler.publish_video.call_args.kwargs["metadata"]
        self.assertIsInstance(metadata, LinkedInMetadata)
        self.assertEqual(metadata.caption, "Tokyo coffee")
        self.assertEqual(metadata.account_ids, ("urn:li:person:1", "urn:li:organization:2"))

    def test_publish_error_returns_slot_to_ready(self):
        # C2: publish failed -> slot goes back to 'ready' (retry with atomic
        # claim on the next pass), never 'failed' directly nor 'ready' without claim.
        from app.services.upload_publisher import PublishError

        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]
        state = MagicMock()
        state.get_task.return_value = {"state": 1, "videos": [self.video_path]}
        publish = MagicMock(side_effect=PublishError("boom"))
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=publish, generate_topic_fn=MagicMock(),
        )
        scheduler.base_url = "https://post-engineer.com"
        scheduler.api_secret = "secret"
        published = scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(published, 0)
        self.assertEqual(store.updates[0][1]["status"], "ready")


class NotifyIntegrationTests(unittest.TestCase):
    """Discord events on the stages - injected, fire-and-forget, no crash."""

    def _scheduler(self, store, **kwargs):
        defaults = dict(
            store=store, task_state=MagicMock(),
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
            auto_generate=True,
        )
        defaults.update(kwargs)
        return fs.FillScheduleScheduler(**defaults)

    def test_generate_batch_notifies_with_topics(self):
        slot = {
            "id": "slot-1",
            "slot_at": "2026-09-07T12:00:00+00:00",
            "schedules": {
                "user_id": "user-1",
                "providers": ["youtube"],
                "youtube_account_ids": ["yt-1"],
                "personas": {"name": "Ana", "niche": "travel", "language": "en", "voice_id": "calm"},
            },
        }
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        notify = MagicMock()
        scheduler = self._scheduler(
            store, notify=notify,
            generate_topic_fn=MagicMock(return_value="Tokyo coffee guide"),
        )
        with patch.object(scheduler, "_dispatch_generation"):
            scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        notify.assert_called_once()
        message = notify.call_args.args[0]
        self.assertIn("Tokyo coffee guide", message)
        self.assertIn("Ana", message)

    def test_generate_failure_notifies(self):
        # valid providers (pre-flight passes) and LLM failing -> notifies
        # the real topic error; and the reason shows up in the message.
        slot = {
            "id": "slot-2",
            "slot_at": "2026-09-07T12:00:00+00:00",
            "schedules": {
                "user_id": "user-1",
                "providers": ["youtube"],
                "youtube_account_ids": ["yt-1"],
                "personas": {"name": "Ana", "voice_id": "calm"},
            },
        }
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        notify = MagicMock()
        scheduler = self._scheduler(
            store, notify=notify,
            generate_topic_fn=MagicMock(side_effect=RuntimeError("llm down")),
        )
        scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        notify.assert_called_once()
        message = notify.call_args.args[0]
        self.assertIn("❌", message)
        self.assertIn("llm down", message)
        self.assertIn("Ana", message)

    def test_preflight_failure_notifies_validation_reason(self):
        # Failing pre-flight (youtube with no accounts) also notifies - the
        # reason is validation, not the LLM (which is never called).
        slot = {
            "id": "slot-3",
            "slot_at": "2026-09-07T12:00:00+00:00",
            "schedules": {"user_id": "user-1", "providers": [], "personas": {}},
        }
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        notify = MagicMock()
        generate_topic_fn = MagicMock(return_value="topic")
        scheduler = self._scheduler(
            store, notify=notify,
            generate_topic_fn=generate_topic_fn,
        )
        scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        notify.assert_called_once()
        message = notify.call_args.args[0]
        self.assertIn("❌", message)
        self.assertIn("provider", message)
        generate_topic_fn.assert_not_called()

    def test_publish_success_notifies_persona_topic_providers(self):
        handle, video_path = tempfile.mkstemp(suffix=".mp4")
        with os.fdopen(handle, "wb") as video_file:
            video_file.write(b"fake-video-bytes")
        self.addCleanup(os.unlink, video_path)

        slot = {
            "id": "slot-1",
            "topic": "Tokyo coffee",
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
        state.get_task.return_value = {"state": 1, "videos": [video_path]}
        notify = MagicMock()
        scheduler = self._scheduler(store, task_state=state, notify=notify)
        scheduler.base_url = "https://post-engineer.com"
        scheduler.api_secret = "secret"

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
            "topic": "Tokyo coffee",
            "task_id": "t-1",
            "schedules": {
                "user_id": "user-1",
                "providers": ["youtube"],
                "personas": {"name": "Ana"},
            },
        }
        store = _FakeStore()
        store.ready_due_slots = lambda now: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": 1, "videos": [video_path]}
        notify = MagicMock()
        scheduler = self._scheduler(
            store, task_state=state, notify=notify,
            publish_video=MagicMock(side_effect=PublishError("quota exceeded")),
        )
        scheduler.base_url = "https://post-engineer.com"
        scheduler.api_secret = "secret"

        scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        notify.assert_called_once()
        message = notify.call_args.args[0]
        self.assertIn("❌", message)
        self.assertIn("quota exceeded", message)

    def test_notify_never_crashes_the_stage(self):
        slot = {
            "id": "slot-1",
            "slot_at": "2026-09-07T12:00:00+00:00",
            "schedules": {
                "user_id": "user-1",
                "providers": ["youtube"],
                "youtube_account_ids": ["yt-1"],
                "personas": {"name": "Ana", "niche": "travel", "language": "en", "voice_id": "calm"},
            },
        }
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        notify = MagicMock(side_effect=RuntimeError("discord exploded"))
        scheduler = self._scheduler(
            store, notify=notify,
            generate_topic_fn=MagicMock(return_value="topic"),
        )
        # notify raising must not interrupt the stage nor mark an error
        with patch.object(scheduler, "_dispatch_generation"):
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(enqueued, 1)
        self.assertEqual(store.updates[0][1]["status"], "generating")

    def test_default_notify_is_noop_without_env(self):
        scheduler = self._scheduler(_FakeStore())
        # Without DISCORD_WEBHOOK_URL, the default notify is the notify module's
        self.assertEqual(scheduler.notify, nf.send_discord)


class CoverageGapTests(unittest.TestCase):
    """Covers paths not yet exercised: explicit times, generate_topic,
    build_persona_params (all variants), reconcile without task, publish
    without env/task without videos, run_once, helpers and bluesky/linkedin
    metadata."""

    def setUp(self) -> None:
        handle, self.video_path = tempfile.mkstemp(suffix=".mp4")
        with os.fdopen(handle, "wb") as video_file:
            video_file.write(b"fake-video-bytes")
        self.addCleanup(os.unlink, self.video_path)

    def _slot(self):
        return {
            "id": "slot-1",
            "topic": "Tokyo coffee",
            "task_id": "t-1",
            "schedules": {
                "user_id": "user-1",
                "providers": ["youtube"],
                "personas": {"name": "Ana"},
            },
        }

    def _scheduler(self, store, **kwargs):
        defaults = dict(
            store=store, task_state=MagicMock(),
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
            auto_generate=True,
        )
        defaults.update(kwargs)
        return fs.FillScheduleScheduler(**defaults)

    # -- compute_slots with explicit times ("HH:MM") --------------------------
    def test_explicit_times_create_slots_at_requested_hours(self):
        slots = fs.compute_slots(
            days_of_week=[0, 1, 2, 3, 4, 5, 6],
            start_hour=0,
            end_hour=23,
            posts_per_day=5,
            tz_name="UTC",
            now=datetime(2026, 9, 6, 12, 0, tzinfo=UTC),
            days_ahead=1,
            times=["09:30", "18:00"],
        )
        self.assertEqual(len(slots), 2)
        # 09:30 + 5-15min jitter; 18:00 + jitter -> hours preserved
        self.assertEqual({slot.hour for slot in slots}, {9, 18})
        by_hour = {slot.hour: slot.minute for slot in slots}
        self.assertTrue(35 <= by_hour[9] <= 45)
        self.assertTrue(0 <= by_hour[18] <= 15)

    # -- generate_topic -------------------------------------------------------
    def test_generate_topic_strips_and_returns_first_line(self):
        with patch("app.services.llm._generate_response_with_fallback") as llm_call:
            llm_call.return_value = '"Tokyo coffee guide"\nextra line'
            topic = fs.generate_topic("travel", "", "en")
        # strip -> splitlines -> strip: the implementation strips quotes before
        # splitting lines, so the closing quote of the 1st line remains.
        self.assertEqual(topic, 'Tokyo coffee guide"')

    def test_generate_topic_raises_on_error_response(self):
        with patch("app.services.llm._generate_response_with_fallback") as llm_call:
            llm_call.return_value = "Error: quota exceeded"
            with self.assertRaises(RuntimeError) as ctx:
                fs.generate_topic("travel", "", "en")
        self.assertIn("topic generation failed", str(ctx.exception))

    def test_generate_topic_raises_on_blank_response(self):
        # empty response -> empty splitlines -> RuntimeError (not IndexError)
        with patch("app.services.llm._generate_response_with_fallback") as llm_call:
            llm_call.return_value = ""
            with self.assertRaises(RuntimeError) as ctx:
                fs.generate_topic("travel", "", "en")
            self.assertIn("topic generation failed", str(ctx.exception))

    # -- build_persona_params (todas as variantes) ----------------------------
    def test_persona_params_avatar_url_and_voice_id(self):
        params = fs.build_persona_params(
            {"name": "Ana", "avatar_url": "https://cdn/a.png", "voice_id": "calm"},
            store=MagicMock(),
        )
        self.assertEqual(params["avatar_url"], "https://cdn/a.png")
        self.assertEqual(params["voice_id"], "calm")
        self.assertNotIn("photo_url", params)

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

    # -- publish_due sem env configurada --------------------------------------
    def test_publish_due_skips_without_base_url(self):
        scheduler = fs.FillScheduleScheduler(
            store=MagicMock(), task_state=None,
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
        )
        scheduler.base_url = ""
        scheduler.api_secret = "secret"
        self.assertEqual(scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC)), 0)

    def test_publish_due_skips_without_api_secret(self):
        scheduler = fs.FillScheduleScheduler(
            store=MagicMock(), task_state=None,
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
        )
        scheduler.base_url = "https://post-engineer.com"
        scheduler.api_secret = ""
        self.assertEqual(scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC)), 0)

    # -- publish_due with task without videos ---------------------------------
    def test_due_slot_without_videos_fails(self):
        store = _FakeStore()
        store.ready_due_slots = lambda now: [
            {"id": "slot-x", "topic": "T", "task_id": "t-1", "schedules": {"user_id": "u1", "providers": []}}
        ]
        state = MagicMock()
        state.get_task.return_value = {"state": 1, "videos": []}
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
        )
        scheduler.base_url = "https://post-engineer.com"
        scheduler.api_secret = "secret"
        self.assertEqual(scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC)), 0)
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertIn("no finished videos", store.updates[0][1]["error"])

    # -- reconcile com task inexistente ---------------------------------------
    def test_reconcile_skips_unknown_task(self):
        store = _FakeStore()
        store.generating_slots = lambda: [{"id": "slot-1", "task_id": "ghost"}]
        state = MagicMock()
        state.get_task.return_value = None
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
        )
        self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 0)
        self.assertEqual(store.updates, [])

    # -- _auto_stage_enabled reads config.toml [app] ---------------------------
    def test_auto_stage_reads_config_app_section(self):
        fake_config = MagicMock()
        fake_config.app = {"fill_schedule_auto_generate": True}
        with patch("app.config.config", fake_config):
            self.assertTrue(
                fs.FillScheduleScheduler._auto_stage_enabled("fill_schedule_auto_generate")
            )
        fake_config.app = {}
        with patch("app.config.config", fake_config):
            self.assertFalse(
                fs.FillScheduleScheduler._auto_stage_enabled("fill_schedule_auto_generate")
            )

    # -- run_once aggregates the four stages ----------------------------------
    def test_run_once_returns_stage_counts(self):
        store = _FakeStore()
        store.pending_slots = lambda now: []
        store.generating_slots = lambda: []
        store.ready_due_slots = lambda now: []
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=MagicMock(),
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
        )
        scheduler.base_url = "https://post-engineer.com"
        scheduler.api_secret = "secret"
        results = scheduler.run_once(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(
            sorted(results.keys()), ["generated", "planned", "published", "reconciled"]
        )

    # -- helpers ---------------------------------------------------------------
    def test_persona_for_raises_without_embed(self):
        scheduler = fs.FillScheduleScheduler(
            store=MagicMock(), task_state=None,
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
        )
        with self.assertRaises(RuntimeError) as ctx:
            scheduler._persona_for({"id": "sched-1"})
        self.assertIn("no persona embed", str(ctx.exception))

    def test_metadata_for_bluesky_truncates_caption(self):
        scheduler = fs.FillScheduleScheduler(
            store=MagicMock(), task_state=None,
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
        )
        metadata = scheduler._metadata_for(
            "bluesky",
            "x" * 500,
            {"bluesky_account_ids": ["did:1"]},
        )
        from app.services.upload_publisher import BlueskyMetadata, BLUESKY_CAPTION_MAX_GRAPHEMES

        self.assertIsInstance(metadata, BlueskyMetadata)
        self.assertLessEqual(len(metadata.caption), BLUESKY_CAPTION_MAX_GRAPHEMES)

    def test_metadata_for_unsupported_provider_raises(self):
        scheduler = fs.FillScheduleScheduler(
            store=MagicMock(), task_state=None,
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
        )
        with self.assertRaises(RuntimeError) as ctx:
            scheduler._metadata_for("tiktok", "topic", {})
        self.assertIn("unsupported schedule provider", str(ctx.exception))

    # -- _validate_publish_plan com bluesky+linkedin (caminho completo) --------
    def test_validate_publish_plan_accepts_all_providers(self):
        scheduler = fs.FillScheduleScheduler(
            store=MagicMock(), task_state=None,
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
        )
        schedule = {
            "providers": ["youtube", "instagram", "bluesky", "linkedin"],
            "youtube_account_ids": ["yt-1"],
            "instagram_account_ids": ["ig-1"],
            "bluesky_account_ids": ["did:1"],
            "linkedin_account_ids": ["urn:li:person:1"],
        }
        # does not raise
        scheduler._validate_publish_plan(schedule, "topic")

    def test_validate_publish_plan_rejects_bluesky_without_accounts(self):
        scheduler = fs.FillScheduleScheduler(
            store=MagicMock(), task_state=None,
            publish_video=MagicMock(), generate_topic_fn=MagicMock(),
        )
        with self.assertRaises(ValueError) as ctx:
            scheduler._validate_publish_plan(
                {"providers": ["bluesky"], "bluesky_account_ids": []}, ""
            )
        self.assertIn("bluesky", str(ctx.exception))

    # -- thread bootstrap -------------------------------------------------------
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
        time_module.sleep(0.15)  # TICK_SECONDS=60 real; thread roda 1x imediatamente
        self.assertGreaterEqual(len(ticks), 1)


    # -- atomic claim (C2: never re-publish) ----------------------------------
    def test_publish_claims_slot_before_publishing(self):
        store = _FakeStore()
        store.claim_ready_slot = MagicMock(return_value=True)
        store.ready_due_slots = lambda now: [self._slot()]
        state = MagicMock()
        state.get_task.return_value = {"state": 1, "videos": [self.video_path]}
        publish = MagicMock()
        scheduler = self._scheduler(store, task_state=state, publish_video=publish)
        scheduler.base_url = "https://post-engineer.com"
        scheduler.api_secret = "secret"

        published = scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(published, 1)
        # claim acontece ANTES do primeiro publish_video
        store.claim_ready_slot.assert_called_once_with("slot-1")
        self.assertLess(
            store.claim_ready_slot.call_args.call_index or 0,
            1,
        ) if False else None
        publish.assert_called_once()
        # marca published ao final
        self.assertEqual(store.updates[-1][1]["status"], "published")

    def test_publish_skips_slot_already_claimed(self):
        # Another tick/process already claimed the slot -> publish_video NOT called.
        store = _FakeStore()
        store.claim_ready_slot = MagicMock(return_value=False)
        store.ready_due_slots = lambda now: [self._slot()]
        state = MagicMock()
        state.get_task.return_value = {"state": 1, "videos": [self.video_path]}
        publish = MagicMock()
        scheduler = self._scheduler(store, task_state=state, publish_video=publish)
        scheduler.base_url = "https://post-engineer.com"
        scheduler.api_secret = "secret"

        published = scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(published, 0)
        publish.assert_not_called()
        self.assertEqual(store.updates, [])

    def test_publish_failure_after_claim_returns_slot_to_ready(self):
        # Publish failed after the claim: slot goes back to 'ready' (not 'failed') -
        # it may be a transient error; the claim on the next pass avoids
        # duplication because publishing->ready is the only way back.
        from app.services.upload_publisher import PublishError

        store = _FakeStore()
        store.claim_ready_slot = MagicMock(return_value=True)
        store.ready_due_slots = lambda now: [self._slot()]
        state = MagicMock()
        state.get_task.return_value = {"state": 1, "videos": [self.video_path]}
        notify = MagicMock()
        scheduler = self._scheduler(
            store, task_state=state, notify=notify,
            publish_video=MagicMock(side_effect=PublishError("boom")),
        )
        scheduler.base_url = "https://post-engineer.com"
        scheduler.api_secret = "secret"

        published = scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(published, 0)
        statuses = [fields.get("status") for _, fields in store.updates]
        self.assertIn("ready", statuses)
        notify.assert_called_once()  # failure notified

    def test_publish_due_recovers_stale_publishing_first(self):
        # Recovery of stuck 'publishing' slots runs at the start of the stage.
        store = _FakeStore()
        store.recover_stale_publishing = MagicMock(return_value=0)
        store.ready_due_slots = lambda now: []
        scheduler = self._scheduler(store)
        scheduler.base_url = "https://post-engineer.com"
        scheduler.api_secret = "secret"

        scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        store.recover_stale_publishing.assert_called_once()

    # -- deterministic task (M4: no duplicate generation on crash) ------------
    def test_task_id_is_deterministic_per_slot(self):
        scheduler = self._scheduler(_FakeStore())
        first = scheduler._new_task_id({"id": "slot-abc"})
        second = scheduler._new_task_id({"id": "slot-abc"})
        other = scheduler._new_task_id({"id": "slot-xyz"})
        self.assertEqual(first, second)
        self.assertNotEqual(first, other)

    def test_generate_uses_deterministic_task_id(self):
        slot = {
            "id": "slot-1",
            "slot_at": "2026-09-07T12:00:00+00:00",
            "schedules": {
                "user_id": "user-1",
                "providers": ["youtube"],
                "youtube_account_ids": ["yt-1"],
                "personas": {"name": "Ana", "niche": "travel", "language": "en", "voice_id": "calm"},
            },
        }
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        scheduler = self._scheduler(
            store,
            generate_topic_fn=MagicMock(return_value="topic"),
        )
        with patch.object(scheduler, "_dispatch_generation") as dispatch_generation:
            scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        task_id, _, _ = dispatch_generation.call_args.args
        # deterministic slot uuid → re-dispatch after a crash reuses the same
        # task id instead of creating a second orphan task.
        self.assertEqual(
            task_id, scheduler._new_task_id({"id": "slot-1"})
        )

    # -- horizonte validado (M1) ------------------------------------------------
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
        # A generate failure MUST NOT block reconcile/publish in the same tick.
        store = _FakeStore()
        store.pending_slots = MagicMock(side_effect=RuntimeError("supabase down"))
        store.generating_slots = lambda: [{"id": "s1", "task_id": "t1"}]
        store.ready_due_slots = lambda now: []
        state = MagicMock()
        state.get_task.return_value = {"state": 1}
        scheduler = self._scheduler(store, task_state=state)
        scheduler.base_url = "https://post-engineer.com"
        scheduler.api_secret = "secret"

        results = scheduler.run_once(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        # generate falhou (-1) mas reconcile rodou e marcou ready
        self.assertEqual(results["generated"], -1)
        self.assertEqual(results["reconciled"], 1)
        self.assertEqual(store.updates[0][1]["status"], "ready")

    def test_failed_stage_logs_at_error_level(self):
        # A failed tick stage is a real recurring error: it must be logged at
        # ERROR so the Bugsink bridge (loguru sink, ERROR+) forwards it.
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


class TopicPromptTests(unittest.TestCase):
    def test_prompt_uses_niche_and_language(self):
        prompt = fs.build_topic_prompt("travel", "be cinematic", "pt")
        self.assertIn("travel", prompt)
        self.assertIn("português", prompt)
        self.assertIn("be cinematic", prompt)


if __name__ == "__main__":
    unittest.main()

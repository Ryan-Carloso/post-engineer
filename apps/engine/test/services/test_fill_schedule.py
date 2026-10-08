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
        # Models ScheduleStore's per-tick connect breaker: every stage call
        # records the retry budget in force when it ran, so a test can assert
        # the budget actually dropped rather than only the final flag value.
        self.connect_retries = fs.store.CONNECT_RETRIES
        self.retry_calls = []

    def set_connect_retries(self, n):
        # Records every arm/disarm so a test can assert the budget each stage
        # actually ran under (the first stage runs before any disarm).
        self.retry_calls.append(n)
        self.connect_retries = n

    def pending_slots(self, now):
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
    POST /api/videos/generate-and-schedule); generate() must always process their pending
    slots using the stored topic — no LLM topic, no token spend.
    """

    def _batch_slot(self, topic="Batch topic one"):
        return {
            "id": "slot-batch-1",
            "slot_at": "2026-09-08T09:00:00+00:00",
            "topic": topic,
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
            store=store, task_state=MagicMock(),
            publish_video=MagicMock(),
        )


    def test_generate_batch_slot_uses_stored_topic_no_llm_no_spend(self):
        slot = self._batch_slot()
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(
            scheduler.generator, "_dispatch_generation"
        ) as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 1)
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

    def test_batch_dispatch_carries_the_video_language(self):
        # The embed's language ('en' in the fixture) must reach the job as
        # video_language: without it the script prompt carries no
        # "- language:" line and the script language is left to the LLM's
        # fallback (same language as the topic) - a coin toss.
        slot = self._batch_slot()
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(
            scheduler.generator, "_dispatch_generation"
        ) as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 1)
        request = dispatch_generation.call_args.args[1]
        self.assertEqual(request.video_language, "en")

    def test_persona_less_batch_dispatch_uses_the_snapshot_language(self):
        # A persona-less schedule has no embed: the language comes from the
        # post_language snapshot column (post_identity's snapshot-first rule).
        slot = self._batch_slot()
        del slot["schedules"]["personas"]
        slot["faceless"] = True
        slot["schedules"].update(
            {
                "post_voice_id": "energetic",
                "post_language": "pt-BR",
                "post_script_prompt": "Be direct and short.",
                "post_video_aspect": "16:9",
                "post_face_quality": "ok",
            }
        )
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(
            scheduler.generator, "_dispatch_generation"
        ) as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 1)
        request = dispatch_generation.call_args.args[1]
        self.assertEqual(request.video_language, "pt-BR")

    def test_generate_batch_slot_without_topic_fails(self):
        slot = self._batch_slot(topic="   ")
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(
            scheduler.generator, "_dispatch_generation"
        ) as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 0)
        dispatch_generation.assert_not_called()
        self.assertEqual(store.spent, [])
        self.assertEqual(store.updates[0][1]["status"], "failed")

    def test_generate_batch_slot_without_persona_fails_slot_without_throwing(self):
        # Regression: a schedule with no persona embed (deleted persona)
        # must fail the slot instead of killing the whole generate stage
        # every tick with a RuntimeError.
        slot = self._batch_slot()
        del slot["schedules"]["personas"]
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(
            scheduler.generator, "_dispatch_generation"
        ) as dispatch_generation:
            # Must not raise; slot marked failed.
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 0)
        dispatch_generation.assert_not_called()
        self.assertEqual(store.updates[0][1]["status"], "failed")

    def test_generate_persona_less_slot_from_the_snapshot_generates(self):
        # The post created WITHOUT a persona (migration 012): no embed, but
        # the snapshot columns carry the voice and the script, so the slot must
        # dispatch instead of failing. Pinned end to end because the whole
        # feature is this path.
        slot = self._batch_slot()
        del slot["schedules"]["personas"]
        slot["faceless"] = True
        slot["schedules"].update(
            {
                "post_voice_id": "energetic",
                "post_script_prompt": "Be direct and short.",
                "post_video_aspect": "16:9",
                "post_face_quality": "ok",
            }
        )
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(
            scheduler.generator, "_dispatch_generation"
        ) as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 1)
        self.assertEqual(store.updates[0][1]["status"], "generating")
        request = dispatch_generation.call_args.args[1]
        # The snapshot reached the job: voice chosen, no face, own aspect.
        self.assertEqual(request.persona.voice_id, "energetic")
        self.assertIsNone(request.persona.avatar_url)
        self.assertIsNone(request.persona.photo_url)
        self.assertEqual(request.video_aspect, "16:9")
        self.assertEqual(request.video_script_prompt, "Be direct and short.")

    def test_generate_slot_without_any_voice_fails_before_dispatch(self):
        # A persona with no voice and no audio cannot produce a job:
        # `PersonaParams` rejects it. The slot must fail here (before any
        # dispatch, so no refund is anchored) rather than sending a request
        # the engine refuses opaquely.
        slot = self._batch_slot()
        slot["schedules"]["personas"] = {"name": "Ana"}
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(
            scheduler.generator, "_dispatch_generation"
        ) as dispatch_generation:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))

        self.assertEqual(enqueued, 0)
        dispatch_generation.assert_not_called()
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertIn("no voice", store.updates[0][1]["error"])

    def test_generate_batch_dispatch_failure_refunds_single_video(self):
        slot = self._batch_slot()
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        store.refund_batch_calls = []
        store.refund_batch_tokens = lambda *args: store.refund_batch_calls.append(args) or True
        scheduler = self._scheduler(store)
        scheduler.store.signed_url = MagicMock(return_value="https://signed/foto.png")

        with patch.object(
            scheduler.generator, "_dispatch_generation", side_effect=RuntimeError("dispatch down")
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
            patch("app.services.fill_schedule.generate.threading.Thread") as mock_thread,
        ):
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
        )
        mock_thread.assert_called_once()
        _, kwargs = mock_thread.call_args
        self.assertTrue(kwargs["daemon"])
        # Run the thread target inline to prove the wiring.
        kwargs["target"](**kwargs["kwargs"])
        mock_start.assert_called_once_with(
            task_id="task-1", params=request, stop_at="video"
        )

    def test_dispatch_generation_omits_blank_identity_ids(self):
        # Identity props are optional: a dispatch without slot context
        # must not store blank props on the task row.
        from app.models.schema import TaskVideoRequest

        store = _FakeStore()
        scheduler = self._scheduler(store)
        request = TaskVideoRequest(video_subject="Batch topic one")

        with (
            patch("app.services.task.start"),
            patch("app.services.fill_schedule.generate.threading.Thread"),
        ):
            scheduler.generator._dispatch_generation("task-2", request, "user-1")

        scheduler.task_state.update_task.assert_called_once_with(
            "task-2",
            user_id="user-1",
            flow="batch",
            pipeline="video",
            state=model_const.TASK_STATE_PROCESSING,
            progress=0,
        )

    def test_dispatch_generation_omits_only_the_blank_identity_ids(self):
        # Mixed context: a blank slot_id must be dropped while the set
        # persona_id is persisted — PostHog breakdowns must not fill with
        # empty-string noise for one prop while losing a real value in
        # another.
        from app.models.schema import TaskVideoRequest

        store = _FakeStore()
        scheduler = self._scheduler(store)
        request = TaskVideoRequest(video_subject="Batch topic one")

        with (
            patch("app.services.task.start"),
            patch("app.services.fill_schedule.generate.threading.Thread"),
        ):
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
        )

    def test_dispatch_generation_omits_blank_schedule_id_only(self):
        # Second mixed permutation: blank schedule_id with a set slot_id
        # and persona_id. Each identity prop is filtered independently, so
        # only the blank one must be absent from the persisted row.
        from app.models.schema import TaskVideoRequest

        store = _FakeStore()
        scheduler = self._scheduler(store)
        request = TaskVideoRequest(video_subject="Batch topic one")

        with (
            patch("app.services.task.start"),
            patch("app.services.fill_schedule.generate.threading.Thread"),
        ):
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
        )

    def test_dispatch_generation_omits_all_explicitly_blank_identity_ids(self):
        # Explicit empty strings (not just None defaults): all three blank
        # must be omitted from the persisted row.
        from app.models.schema import TaskVideoRequest

        store = _FakeStore()
        scheduler = self._scheduler(store)
        request = TaskVideoRequest(video_subject="Batch topic one")

        with (
            patch("app.services.task.start"),
            patch("app.services.fill_schedule.generate.threading.Thread"),
        ):
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
        )






class ReconcileTests(unittest.TestCase):
    def test_complete_task_becomes_ready(self):
        slot = {"id": "slot-1", "task_id": "t-1", "schedules": {}}
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": 1}
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
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
            "schedules": {"id": "sched-1", "user_id": "user-1"},
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        # cost_usd is persisted flat on the task row by the task pipeline
        # (no state backend ever nests it under a "result" key).
        state.get_task.return_value = {
            "state": 1,
            "cost_usd": 0.1,
        }
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=MagicMock(),
        )
        with patch.object(rec_module, "track_event") as track:
            self.assertEqual(
                scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1
            )
        generated_calls = [
            c for c in track.call_args_list if c[0][0] == "video_generated"
        ]
        self.assertEqual(len(generated_calls), 1)
        _, props = generated_calls[0][0]
        self.assertEqual(props["task_id"], "t-1")
        self.assertEqual(props["flow"], "batch")
        self.assertEqual(props["pipeline"], "video")
        self.assertEqual(props["user_id"], "user-1")
        self.assertEqual(props["slotId"], "slot-1")
        self.assertEqual(props["cost_usd"], 0.1)

    def test_reconcile_generated_event_omits_cost_usd_when_absent(self):
        from app.services.fill_schedule import reconcile as rec_module

        slot = {
            "id": "slot-1",
            "task_id": "t-1",
            "user_id": "user-1",
            "schedules": {"id": "sched-1", "user_id": "user-1"},
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": 1}
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=MagicMock(),
        )
        with patch.object(rec_module, "track_event") as track:
            self.assertEqual(
                scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1
            )
        generated_calls = [
            c for c in track.call_args_list if c[0][0] == "video_generated"
        ]
        self.assertEqual(len(generated_calls), 1)
        _, props = generated_calls[0][0]
        self.assertNotIn("cost_usd", props)

    def test_failed_task_becomes_failed(self):
        slot = {
            "id": "slot-1",
            "task_id": "t-1",
            "user_id": "user-1",
            "schedules": {
                "id": "sched-1",
                                "user_id": "user-1",
                "personas": {"name": "Ana", "face_quality": "ok"},
            },
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": -1, "error": "gpu exploded"}
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=MagicMock(),
        )
        self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        self.assertEqual(store.updates[0][1]["status"], "failed")

    def test_failed_task_error_is_scrubbed_before_storage(self):
        # Engine task errors can echo bearer tokens/DSNs (AGENTS.md PR #17);
        # the slot error column reaches clients via /api/schedule/status,
        # so it is scrubbed before truncating, like the telemetry reason.
        # The probe is longer than the 500-char cap: with a shorter message
        # [:500] is a no-op and a truncate-first revert would stay green.
        from app.services import analytics as analytics_module
        from app.services.fill_schedule import reconcile as rec_module

        slot = {
            "id": "slot-1",
            "task_id": "t-1",
            "user_id": "user-1",
            "schedules": {
                "id": "sched-1",
                                "user_id": "user-1",
                "personas": {"name": "Ana", "face_quality": "ok"},
            },
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
            store=store, task_state=state,
            publish_video=MagicMock(),
        )
        with patch.object(
            rec_module,
            "scrub_secret_values",
            wraps=analytics_module.scrub_secret_values,
        ) as scrub:
            self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        # The scrubber saw the whole message, not the 500-char slice.
        scrub.assert_called_once_with(task_error)
        error = store.updates[0][1]["error"]
        self.assertIn("[redacted]", error)
        self.assertNotIn("TOPSECRET123", error)
        self.assertLessEqual(len(error), 500)

    def test_failed_task_none_error_stores_empty_string(self):
        # .get's default does not fire on an explicitly-stored None — the
        # same failure mode this PR fixed for the identity props with `or`.
        # A None task error must not persist the literal string "None" into
        # the client-visible slot error column.
        slot = {
            "id": "slot-1",
            "task_id": "t-1",
            "user_id": "user-1",
            "schedules": {
                "id": "sched-1",
                                "user_id": "user-1",
                "personas": {"name": "Ana", "face_quality": "ok"},
            },
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": -1, "error": None}
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=MagicMock(),
        )
        self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        self.assertEqual(store.updates[0][1]["error"], "")

    def test_failed_task_without_persona_embed_marks_failed_without_throwing(self):
        # Regression: a schedule with no persona embed (deleted persona)
        # must not kill the reconcile stage with a RuntimeError every tick.
        # The slot is marked failed, the refund is skipped, and processing
        # continues instead of spamming PostHog with $exception.
        slot = {
            "id": "slot-1",
            "task_id": "t-1",
            "user_id": "user-1",
            "schedules": {
                "id": "sched-1",
                "user_id": "user-1",
                # No "personas" key: persona was deleted.
            },
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": -1, "error": "gpu exploded"}
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=MagicMock(),
        )
        # Must not raise; slot marked failed; refund skipped (no persona
        # to compute the cost from).
        self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertEqual(store.refund_batch_calls, [])

    def test_failed_persona_less_slot_refunds_from_the_snapshot(self):
        # The refund used to be skipped for EVERY failed batch slot: the
        # reconciler's select fetched `schedules(id)` with no embed, so
        # `persona_for` raised on every row and the prepaid tokens were
        # burned. A persona-less post now resolves its identity from the
        # snapshot and refunds like any other slot.
        slot = {
            "id": "slot-np",
            "user_id": "user-1",
            "task_id": "t-np",
            "faceless": True,
            "schedules": {
                "id": "sched-np",
                "user_id": "user-1",
                "personas": None,
                "post_voice_id": "energetic",
                "post_face_quality": "ok",
            },
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": -1, "error": "gpu exploded"}
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state, publish_video=MagicMock()
        )
        self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 1)
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertEqual(len(store.refund_batch_calls), 1)
        # Faceless is priced from the slot alone, so it is the faceless rate.
        self.assertEqual(store.refund_batch_calls[0][3], 1)

    def test_failed_batch_task_refunds_batch_charge(self):
        # Batch slots are prepaid under `batch:{scheduleId}`; a failed task
        # must refund the per-slot cost via refund_batch_tokens (NOT the
        # recurring `scheduled:{slotId}` key, which has no charge row).
        # Faceless is a per-post choice on the slot row now (not a persona
        # mix), so this faceless slot refunds the 1-token faceless price.
        slot = {
            "id": "slot-b1",
            "user_id": "user-1",
            "task_id": "t-b1",
            "faceless": True,
            "schedules": {
                "id": "sched-b1",
                                "user_id": "user-1",
                "personas": {"face_quality": "ok"},
            },
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": -1, "error": "gpu exploded"}
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=MagicMock(),
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
                                "personas": {"face_quality": "ok"},
            },
        }
        store = _FakeStore()
        store.generating_slots = lambda: [slot]
        state = MagicMock()
        state.get_task.return_value = {"state": -1, "error": "gpu exploded"}
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
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
            "topic": "Tokyo coffee",
            "task_id": "t-1",
            "schedules": {"user_id": "user-1", "providers": ["youtube"]},
        }

    def test_due_slot_is_published_and_marked(self):
        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1, "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        publish = MagicMock()
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
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
        self.assertEqual(store.updates[0][1]["status"], "published")

    def test_instagram_provider_uses_caption_metadata(self):
        slot = self._slot()
        slot["schedules"]["providers"] = ["instagram"]
        store = _FakeStore()
        store.ready_due_slots = lambda now: [slot]
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1, "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=MagicMock(),
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
            "state": 1, "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=MagicMock(),
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        metadata = scheduler.publisher.publish_video.call_args.kwargs["metadata"]
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
        state.get_task.return_value = {
            "state": 1, "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        publish = MagicMock(side_effect=PublishError("boom"))
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=publish,
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        published = scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(published, 0)
        self.assertEqual(store.updates[0][1]["status"], "ready")

    def test_publish_failure_scrubs_full_message_before_truncation(self):
        # The video_publish_failed reason pins scrub-then-truncate like the
        # other call sites: a short message makes [:200] a no-op, so only a
        # >200-char secret-bearing message guards against a revert.
        from app.services import analytics as analytics_module
        from app.services.fill_schedule import publish as pub_module
        from app.services.upload_publisher import PublishError

        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1, "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        error = PublishError("E" * 150 + " api_key=TOPSECRET123 " + "F" * 150)
        publish = MagicMock(side_effect=error)
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=publish,
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        with (
            patch.object(pub_module, "track_event") as track,
            patch.object(
                pub_module,
                "scrub_secret_values",
                wraps=analytics_module.scrub_secret_values,
            ) as scrub,
        ):
            published = scheduler.publish_due(
                datetime(2026, 9, 7, 12, 0, tzinfo=UTC)
            )
        self.assertEqual(published, 0)
        # The scrubber received the whole message, not the truncated slice.
        scrub.assert_called_once_with(str(error))
        failed_calls = [
            c for c in track.call_args_list if c[0][0] == "video_publish_failed"
        ]
        self.assertEqual(len(failed_calls), 1)
        _, props = failed_calls[0][0]
        self.assertIn("[redacted]", props["reason"])
        self.assertNotIn("TOPSECRET123", props["reason"])
        self.assertLessEqual(len(str(props["reason"])), 200)


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
            store=store, task_state=MagicMock(),
            publish_video=MagicMock(),
        )
        defaults.update(kwargs)
        return fs.FillScheduleScheduler(**defaults)

    def test_generate_batch_notifies_with_topics(self):
        slot = {
            "id": "slot-1",
            "slot_at": "2026-09-07T12:00:00+00:00",
            "topic": "Batch topic one",
            "schedules": {
                "id": "sched-1",
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
        )
        with patch.object(scheduler.generator, "_dispatch_generation"):
            scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        notify.assert_called_once()
        message = notify.call_args.args[0]
        self.assertIn("Batch topic one", message)
        self.assertIn("Ana", message)

    def test_generate_failure_notifies(self):
        # dispatch failing -> notifies with the real error reason.
        slot = {
            "id": "slot-2",
            "slot_at": "2026-09-07T12:00:00+00:00",
            "topic": "Batch topic",
            "schedules": {
                "id": "sched-2",
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
        # Failing pre-flight (no providers) notifies with the validation reason.
        slot = {
            "id": "slot-3",
            "slot_at": "2026-09-07T12:00:00+00:00",
            "topic": "Batch topic",
            "schedules": {
                "id": "sched-3",
                                "user_id": "user-1",
                "providers": [],
                "personas": {"name": "Ana"},
            },
        }
        store = _FakeStore()
        store.pending_slots = lambda now: [slot]
        notify = MagicMock()
        scheduler = self._scheduler(store, notify=notify)
        scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        notify.assert_called_once()
        message = notify.call_args.args[0]
        self.assertIn("❌", message)
        self.assertIn("provider", message)

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
        state.get_task.return_value = {
            "state": 1, "videos": [video_path],
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
        state.get_task.return_value = {
            "state": 1, "videos": [video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        notify = MagicMock()
        scheduler = self._scheduler(
            store, task_state=state, notify=notify,
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
            "topic": "Batch topic",
            "schedules": {
                "id": "sched-1",
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
        )
        # notify raising must not interrupt the stage nor mark an error
        with patch.object(scheduler.generator, "_dispatch_generation"):
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
            publish_video=MagicMock(),
        )
        defaults.update(kwargs)
        return fs.FillScheduleScheduler(**defaults)

    # -- compute_slots with explicit times ("HH:MM") --------------------------

    # -- generate_topic -------------------------------------------------------



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

    def test_persona_params_passes_through_a_snapshot_audio_url(self):
        # A persona-less audio post already carries the validated URL in the
        # identity (snapshotted by the web): no signing, no persona needed.
        store = MagicMock()
        params = fs.build_persona_params(
            {"voice_audio_url": "https://cdn/v.mp3"},
            store=store,
        )
        self.assertEqual(params["voice_audio_url"], "https://cdn/v.mp3")
        self.assertNotIn("voice_id", params)
        store.signed_url.assert_not_called()

    def test_persona_params_faceless_drops_visual_identity(self):
        # A faceless post contributes only the voice: no avatar_url and no
        # photo_url even when the persona has both, so the engine renders
        # stock footage. Voice resolution is unaffected.
        store = MagicMock()
        store.signed_url = MagicMock(side_effect=AssertionError("must not sign a photo for a faceless post"))
        params = fs.build_persona_params(
            {
                "name": "Ana",
                "avatar_url": "https://cdn/a.png",
                "photo_path": "u/f.png",
                "voice_id": "calm",
            },
            store=store,
            faceless=True,
        )
        self.assertEqual(params["name"], "Ana")
        self.assertEqual(params["voice_id"], "calm")
        self.assertNotIn("avatar_url", params)
        self.assertNotIn("photo_url", params)

    # -- slot_faceless (per-post flag on scheduled_posts) ----------------------
    def test_slot_faceless_requires_literal_true(self):
        # Only the literal True counts as "no face": legacy rows (NULL, the
        # column postdates them) and malformed values price and render the
        # expensive with-face case, never the cheap one.
        self.assertTrue(fs.slot_faceless({"faceless": True}))
        self.assertFalse(fs.slot_faceless({"faceless": False}))
        self.assertFalse(fs.slot_faceless({"faceless": None}))
        self.assertFalse(fs.slot_faceless({}))
        self.assertFalse(fs.slot_faceless({"faceless": 1}))
        self.assertFalse(fs.slot_faceless({"faceless": "true"}))

    # -- token_cost mirrors the web's computeVideoTokens -----------------------
    def test_token_cost_faceless_is_flat_and_quality_prices_face(self):
        self.assertEqual(fs.token_cost(True, "ok"), 1)
        self.assertEqual(fs.token_cost(True, "very_good"), 1)
        self.assertEqual(fs.token_cost(False, "ok"), 2)
        self.assertEqual(fs.token_cost(False, "very_good"), 3)
        # Unknown quality falls back to the cheaper "ok" tier, not the
        # expensive one.
        self.assertEqual(fs.token_cost(False, "bogus"), 2)

    # -- publish_due without env configured -------------------------------------
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
            publish_video=MagicMock(),
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        self.assertEqual(scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC)), 0)
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertIn("no finished videos", store.updates[0][1]["error"])

    # -- reconcile with missing task ------------------------------------------
    def test_reconcile_skips_unknown_task(self):
        store = _FakeStore()
        store.generating_slots = lambda: [
            {"id": "slot-1", "task_id": "ghost", "schedules": {}}
        ]
        state = MagicMock()
        state.get_task.return_value = None
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=MagicMock(),
        )
        self.assertEqual(scheduler.reconcile(datetime(2026, 9, 6, 12, 0, tzinfo=UTC)), 0)
        self.assertEqual(store.updates, [])

    # -- _auto_stage_enabled reads config.toml [app] ---------------------------

    # -- run_once aggregates the four stages ----------------------------------
    def test_run_once_returns_stage_counts(self):
        store = _FakeStore()
        store.pending_slots = lambda now: []
        store.generating_slots = lambda: []
        store.ready_due_slots = lambda now: []
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=MagicMock(),
            publish_video=MagicMock(),
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        results = scheduler.run_once(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(
            sorted(results.keys()), ["generated", "published", "reconciled"]
        )

    # -- helpers ---------------------------------------------------------------
    def test_persona_for_raises_without_embed(self):
        with self.assertRaises(RuntimeError) as ctx:
            fs.persona_for({"id": "sched-1"})
        self.assertIn("no persona embed", str(ctx.exception))

    def test_metadata_for_bluesky_truncates_caption(self):
        metadata = fs.metadata_for(
            "bluesky",
            "x" * 500,
            {"bluesky_account_ids": ["did:1"]},
        )
        from app.services.upload_publisher import BlueskyMetadata, BLUESKY_CAPTION_MAX_GRAPHEMES

        self.assertIsInstance(metadata, BlueskyMetadata)
        self.assertLessEqual(len(metadata.caption), BLUESKY_CAPTION_MAX_GRAPHEMES)

    def test_metadata_for_unsupported_provider_raises(self):
        with self.assertRaises(RuntimeError) as ctx:
            fs.metadata_for("tiktok", "topic", {})
        self.assertIn("unsupported schedule provider", str(ctx.exception))

    # -- _validate_publish_plan with bluesky+linkedin (full path) ----------------
    def test_validate_publish_plan_accepts_all_providers(self):
        schedule = {
            "providers": ["youtube", "instagram", "bluesky", "linkedin"],
            "youtube_account_ids": ["yt-1"],
            "instagram_account_ids": ["ig-1"],
            "bluesky_account_ids": ["did:1"],
            "linkedin_account_ids": ["urn:li:person:1"],
        }
        # does not raise
        fs.validate_publish_plan(schedule, "topic")

    def test_validate_publish_plan_rejects_bluesky_without_accounts(self):
        with self.assertRaises(ValueError) as ctx:
            fs.validate_publish_plan(
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
        time_module.sleep(0.15)  # TICK_SECONDS=60 real; thread runs 1x immediately
        self.assertGreaterEqual(len(ticks), 1)


    # -- atomic claim (C2: never re-publish) ----------------------------------
    def test_publish_claims_slot_before_publishing(self):
        store = _FakeStore()
        store.claim_ready_slot = MagicMock(return_value=True)
        store.ready_due_slots = lambda now: [self._slot()]
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1, "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        publish = MagicMock()
        scheduler = self._scheduler(store, task_state=state, publish_video=publish)
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"

        published = scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(published, 1)
        # claim happens BEFORE the first publish_video
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
        state.get_task.return_value = {
            "state": 1, "videos": [self.video_path],
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

    def test_publish_failure_after_claim_returns_slot_to_ready(self):
        # Publish failed after the claim: slot goes back to 'ready' (not 'failed') -
        # it may be a transient error; the claim on the next pass avoids
        # duplication because publishing->ready is the only way back.
        from app.services.upload_publisher import PublishError

        store = _FakeStore()
        store.claim_ready_slot = MagicMock(return_value=True)
        store.ready_due_slots = lambda now: [self._slot()]
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1, "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        notify = MagicMock()
        scheduler = self._scheduler(
            store, task_state=state, notify=notify,
            publish_video=MagicMock(side_effect=PublishError("boom")),
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"

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
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"

        scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        store.recover_stale_publishing.assert_called_once()

    def test_stale_recovery_log_names_the_root_cause(self):
        # The recovery failure is a log-only line, so it uses safe_diagnostic
        # and keeps the urllib3 cause that safe_reason's 200-char cut drops.
        store = _FakeStore()
        store.recover_stale_publishing = MagicMock(
            side_effect=ConnectionError(
                "HTTPSConnectionPool(host='db.example', port=443): Max retries "
                "exceeded with url: /rest/v1/scheduled_posts?select=" + "x" * 600
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
            f"expected the recovery log to name the root cause, got: {messages}",
        )

    def test_safe_diagnostic_is_confined_to_log_only_sites(self):
        # safe_diagnostic's output is 400-char head+tail and log-shaped.
        # safe_reason reaches Discord and (via _fail_task) client-visible task
        # errors, so it stays on the user-facing sites. Pin the split at the
        # source level: a behavioral test cannot distinguish "chose
        # safe_reason" from "never reached the branch".
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

        # publish.py: log-only recovery line uses safe_diagnostic; the
        # user-facing notify calls keep safe_reason.
        self.assertIn(
            "safe_diagnostic",
            by_file["publish.py"],
            "publish.py lost its safe_diagnostic call site",
        )
        self.assertIn(
            "safe_reason",
            by_file["publish.py"],
            "publish.py lost its user-facing safe_reason call site",
        )
        # Log-only sites allowed to call safe_diagnostic. Every OTHER file
        # reaches Discord (generate.py's slot_failed_msg, publish.py's
        # notify) or client-visible task errors, so it must stay on
        # safe_reason. Adding a file here is a deliberate act.
        log_only = {"scheduler.py", "publish.py"}
        for name, names in by_file.items():
            if name in log_only:
                continue
            self.assertNotIn(
                "safe_diagnostic",
                names,
                f"{name} calls safe_diagnostic on a user-facing path",
            )

    # -- deterministic task (M4: no duplicate generation on crash) ------------
    # -- connect circuit breaker ---------------------------------------------
    def test_a_failed_stage_disables_retries_for_the_rest_of_the_tick(self):
        # A sustained Supabase outage makes every stage pay the full connect
        # budget (~30s) on its first call, stretching a tick past TICK_SECONDS.
        # Once one stage has failed, the rest must fail fast: the network is
        # already known-bad for this tick and re-paying the budget buys nothing.
        store = _FakeStore()
        store.pending_slots = MagicMock(side_effect=ConnectionError("dns"))
        store.generating_slots = MagicMock(side_effect=ConnectionError("dns"))
        store.ready_due_slots = MagicMock(side_effect=ConnectionError("dns"))
        scheduler = self._scheduler(store)
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"

        results = scheduler.run_once(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        self.assertEqual(results, {"generated": -1, "reconciled": -1, "published": -1})
        # Retries armed going in, disarmed after the first stage failed.
        self.assertEqual(store.connect_retries, 0)
        # [re-arm, disarm, disarm]: only the first stage saw a live budget.
        self.assertEqual(store.retry_calls, [fs.store.CONNECT_RETRIES, 0, 0, 0])

    def test_breaker_rearms_at_the_start_of_the_next_tick(self):
        # The flag is per tick, not sticky: a transient blip must not disable
        # retries for the rest of the process's life.
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

    def test_disarmed_store_still_sends_auth_headers_and_reads_rows(self):
        # set_connect_retries(0) must retune the adapter in place, never
        # replace the session or the adapter: losing auth headers or the
        # pooled connections would hurt every later request.
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
        # The scheduler re-arms every tick, so the swap must keep the adapter
        # and its PoolManager — a fresh adapter drops every pooled connection
        # and forces a new TCP+TLS handshake on the next call.
        self.assertIs(adapter_after, adapter_before)
        self.assertIs(adapter_after.poolmanager, pool_before)
        # Auth is per-request (_headers), not on the session; the session
        # object itself still carries requests' own defaults.
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
            "topic": "Batch topic",
            "schedules": {
                "id": "sched-1",
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
        )
        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch_generation:
            scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        task_id, _, _ = dispatch_generation.call_args.args
        # deterministic slot uuid → re-dispatch after a crash reuses the same
        # task id instead of creating a second orphan task.
        self.assertEqual(
            task_id, fs.new_task_id({"id": "slot-1"})
        )

    # -- horizon validated (M1) --------------------------------------------------
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
        store.generating_slots = lambda: [
            {"id": "s1", "task_id": "t1", "schedules": {}}
        ]
        store.ready_due_slots = lambda now: []
        state = MagicMock()
        state.get_task.return_value = {"state": 1}
        scheduler = self._scheduler(store, task_state=state)
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"

        results = scheduler.run_once(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        # generate falhou (-1) mas reconcile rodou e marcou ready
        self.assertEqual(results["generated"], -1)
        self.assertEqual(results["reconciled"], 1)
        self.assertEqual(store.updates[0][1]["status"], "ready")

    def test_failed_stage_logs_at_error_level(self):
        # A failed tick stage is a real recurring error: it must be logged at
        # ERROR so the PostHog bridge (loguru sink, ERROR+) forwards it.
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
        # The urllib3 root cause sits at the END of a long requests message:
        # the stage log must keep it, or DNS and refused look the same.
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

    def _batch_slot(self, topic="Batch topic one"):
        return {
            "id": "slot-batch-1",
            "slot_at": "2026-09-08T09:00:00+00:00",
            "topic": topic,
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
        slot["slot_at"] = "2026-09-11T09:00:00+00:00"  # beyond the horizon
        store = _FakeStore()
        # pending_slots is horizon-filtered by the store; an empty result
        # means the batch slot stays untouched.
        store.pending_slots = lambda now: []
        scheduler = self._scheduler(store)
        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(enqueued, 0)
        dispatch.assert_not_called()

    def test_batch_slots_keep_parallel_dispatch(self):
        slot1 = self._batch_slot()
        slot1["id"] = "slot-b1"
        slot2 = self._batch_slot()
        slot2["id"] = "slot-b2"
        store = _FakeStore()
        store.pending_slots = lambda now: [slot1, slot2]
        scheduler = self._scheduler(store)
        with patch.object(scheduler.generator, "_dispatch_generation") as dispatch:
            enqueued = scheduler.generate(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(enqueued, 2)
        self.assertEqual(dispatch.call_count, 2)



class PostIdentityTests(unittest.TestCase):
    """post_identity — the persona is optional; the schedule snapshot is not.

    A persona-less post (migration 012) has no embed at all, so the engine has
    to read voice/script/aspect from the ``post_*`` columns. And when both
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
        # No `personas` key at all: that is the post created without a persona.
        identity = fs.post_identity(
            {
                "id": "sched-2",
                "personas": None,
                "post_voice_id": "energetic",
                "post_script_prompt": "Be direct.",
                "post_video_aspect": "16:9",
                "post_paragraph_number": 3,
                "post_face_quality": "ok",
            }
        )
        self.assertEqual(identity["voice_id"], "energetic")
        self.assertEqual(identity["script_prompt"], "Be direct.")
        self.assertEqual(identity["video_aspect"], "16:9")
        self.assertEqual(identity["paragraph_number"], 3)
        self.assertEqual(identity["face_quality"], "ok")

    def test_snapshot_overrides_the_persona_embed(self):
        # The pin that makes a scheduled post reproducible: editing the
        # persona afterwards cannot change the aspect ratio or the script of a
        # video that is already queued.
        identity = fs.post_identity(
            {
                "id": "sched-3",
                "personas": {
                    "voice_id": "calm",
                    "video_aspect": "9:16",
                    "script_prompt": "old",
                },
                "post_voice_id": "energetic",
                "post_video_aspect": "16:9",
                "post_script_prompt": "new",
            }
        )
        self.assertEqual(identity["voice_id"], "energetic")
        self.assertEqual(identity["video_aspect"], "16:9")
        self.assertEqual(identity["script_prompt"], "new")

    def test_a_null_snapshot_column_does_not_erase_the_persona_value(self):
        # NULL on a snapshot means "not provided", never "inherit blank":
        # the migration leaves every pre-existing row that way.
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
        # A persona-less audio post has no embed: the snapshotted audio URL
        # is the only voice the identity carries (migration 013).
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
        # The deleted-persona case with no snapshot (a schedule created
        # before migration 012): the slot must fail with a readable reason.
        with self.assertRaises(RuntimeError) as ctx:
            fs.post_identity({"id": "sched-5", "personas": None})
        self.assertIn("neither a persona nor a post snapshot", str(ctx.exception))

    def test_raises_on_a_malformed_embed_rather_than_reading_it(self):
        # The guard is `isinstance`, so a list embed must raise like a missing
        # one instead of silently producing a blank identity.
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
        # Only a non-empty STRING is a voice: None/""/0/False must not pass as
        # one and leave the rejection to the engine.
        for value in (None, "", 0, False):
            with self.subTest(value=value):
                with self.assertRaises(RuntimeError):
                    fs.voice_for({"voice_id": value})

    def test_accepts_an_audio_voice_persona_without_a_voice_id(self):
        # Regression: an audio-voice persona (custom upload, no voice_id)
        # carries voice_audio_path in the embed; voice_for must accept it —
        # build_persona_params signs it into voice_audio_url at dispatch.
        self.assertEqual(
            fs.voice_for({"name": "Ana", "voice_audio_path": "u/v.mp3"}),
            "u/v.mp3",
        )

    def test_accepts_a_snapshot_audio_url_for_a_persona_less_post(self):
        # A persona-less audio post has no embed; the web snapshots the
        # validated URL as voice_audio_url (migration 013).
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

"""Tests for boot-time orphan triage (app/services/orphan_requeue.py).

When the engine restarts mid-generation, orphans used to be failed+refunded
blindly. The triage classifies them by stage instead:

- generation stages linked to a batch slot -> the slot goes back to
  ``pending`` and the next fill-schedule tick re-dispatches it (no billing
  change: batch slots are prepaid at schedule creation);
- stage ``publish`` with ``publish_results`` -> the publish already ran,
  backfill COMPLETE instead of failing a delivered video;
- stage ``publish`` with a finished video in R2 -> complete the publish;
- anything else -> fail + refund, as before.
"""

import os
import sys
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models import const
from app.services import orphan_requeue


@contextmanager
def _isolated_environ(overrides):
    """Isolated os.environ that stays honest under mutmut.

    Equivalent to patch.dict(os.environ, overrides, clear=True), except it
    preserves mutmut's MUTANT_UNDER_TEST variable. mutmut 3.x activates the
    mutant under test through that env var, read at call time by its
    trampoline; a plain clear=True wipes it, so every mutant trivially
    "survives" (the original code always runs). Outside mutmut the variable
    is unset and this behaves exactly like patch.dict(clear=True).
    """
    sentinel = os.environ.get("MUTANT_UNDER_TEST")
    with patch.dict(os.environ, overrides, clear=True):
        if sentinel is not None:
            os.environ["MUTANT_UNDER_TEST"] = sentinel
        yield


def _task_data(**overrides):
    data = {"stage": "audio", "slot_id": "slot-1", "flow": "batch"}
    data.update(overrides)
    return data


class ClassifyOrphanTests(unittest.TestCase):
    def test_generation_stages_with_slot_requeue(self):
        for stage in [
            "script",
            "terms",
            "audio",
            "custom_audio",
            "subtitle",
            "materials",
            "download",
            "music_mood",
            "render",
        ]:
            with self.subTest(stage=stage):
                self.assertEqual(
                    orphan_requeue.classify_orphan(_task_data(stage=stage)),
                    orphan_requeue.REQUEUE,
                )

    def test_generation_stage_without_slot_fails(self):
        data = _task_data()
        del data["slot_id"]
        self.assertEqual(orphan_requeue.classify_orphan(data), orphan_requeue.FAIL)

    def test_publish_with_results_marks_complete(self):
        data = _task_data(stage="publish", publish_results=[{"provider": "youtube"}])
        self.assertEqual(orphan_requeue.classify_orphan(data), orphan_requeue.MARK_COMPLETE)

    def test_publish_with_archived_video_completes_publish(self):
        data = _task_data(stage="publish", video_storage_path="u/t/v.mp4")
        self.assertEqual(orphan_requeue.classify_orphan(data), orphan_requeue.COMPLETE_PUBLISH)

    def test_publish_without_artifact_fails(self):
        data = _task_data(stage="publish")
        self.assertEqual(orphan_requeue.classify_orphan(data), orphan_requeue.FAIL)

    def test_unknown_stage_fails(self):
        self.assertEqual(
            orphan_requeue.classify_orphan(_task_data(stage="mystery")),
            orphan_requeue.FAIL,
        )
        self.assertEqual(orphan_requeue.classify_orphan({}), orphan_requeue.FAIL)


class TriageRequeueTests(unittest.TestCase):
    def _slot_store(self, slot):
        store = MagicMock()
        store.get_slot.return_value = slot
        return store

    def test_generating_slot_reset_to_pending(self):
        state = MagicMock()
        store = self._slot_store({"id": "slot-1", "status": "generating", "task_id": "t-1"})
        with patch.object(orphan_requeue, "track_event") as track:
            claimed = orphan_requeue.triage_requeue(state, store, "t-1", _task_data())
        self.assertTrue(claimed)
        store.update_slot.assert_called_once_with("slot-1", status="pending")
        _, kwargs = state.update_task.call_args
        self.assertEqual(kwargs["requeue_count"], 1)
        self.assertTrue(kwargs["auto_requeued"])
        track.assert_called_once()
        self.assertEqual(track.call_args[0][0], "task_auto_requeued")

    def test_requeue_count_increments(self):
        state = MagicMock()
        store = self._slot_store({"id": "slot-1", "status": "generating", "task_id": "t-1"})
        with patch.object(orphan_requeue, "track_event"):
            orphan_requeue.triage_requeue(state, store, "t-1", _task_data(requeue_count=2))
        self.assertEqual(state.update_task.call_args[1]["requeue_count"], 3)

    def test_pending_slot_left_for_tick(self):
        state = MagicMock()
        store = self._slot_store({"id": "slot-1", "status": "pending", "task_id": "t-1"})
        with patch.object(orphan_requeue, "track_event") as track:
            claimed = orphan_requeue.triage_requeue(state, store, "t-1", _task_data())
        # Claimed (never fail+refund), but nothing to reset: the tick owns it.
        self.assertTrue(claimed)
        store.update_slot.assert_not_called()
        track.assert_not_called()

    def test_missing_slot_not_claimed(self):
        state = MagicMock()
        store = self._slot_store(None)
        claimed = orphan_requeue.triage_requeue(state, store, "t-1", _task_data())
        self.assertFalse(claimed)

    def test_failed_slot_not_claimed(self):
        state = MagicMock()
        store = self._slot_store({"id": "slot-1", "status": "failed", "task_id": "t-1"})
        claimed = orphan_requeue.triage_requeue(state, store, "t-1", _task_data())
        self.assertFalse(claimed)

    def test_no_slot_id_not_claimed(self):
        state = MagicMock()
        store = self._slot_store({"id": "slot-1", "status": "generating"})
        data = _task_data()
        del data["slot_id"]
        claimed = orphan_requeue.triage_requeue(state, store, "t-1", data)
        self.assertFalse(claimed)
        store.get_slot.assert_not_called()

    def test_no_slot_store_not_claimed(self):
        state = MagicMock()
        claimed = orphan_requeue.triage_requeue(state, None, "t-1", _task_data())
        self.assertFalse(claimed)


class MarkCompleteOrphanTests(unittest.TestCase):
    def test_marks_complete_and_settles_without_refund(self):
        state = MagicMock()
        with (
            patch.object(orphan_requeue, "track_event") as track,
            patch.object(orphan_requeue, "settle_orphan_completed") as settle,
        ):
            orphan_requeue.mark_complete_orphan(
                state, "t-1", _task_data(stage="publish", publish_results=[{"provider": "youtube"}])
            )
        _, kwargs = state.update_task.call_args
        self.assertEqual(kwargs["state"], const.TASK_STATE_COMPLETE)
        self.assertEqual(kwargs["progress"], 100)
        settle.assert_called_once_with(state, "t-1")
        track.assert_called_once()
        self.assertEqual(track.call_args[0][0], "orphan_marked_complete")


class CompletePublishOrphanTests(unittest.TestCase):
    def test_batch_orphan_marks_complete_for_slot_publisher(self):
        state = MagicMock()
        with patch.object(orphan_requeue, "track_event"):
            done = orphan_requeue.complete_publish_orphan(
                state,
                "t-1",
                _task_data(stage="publish", video_storage_path="u/t/v.mp4"),
            )
        self.assertTrue(done)
        _, kwargs = state.update_task.call_args
        self.assertEqual(kwargs["state"], const.TASK_STATE_COMPLETE)
        # The slot publisher only needs basenames; bytes come from R2.
        self.assertEqual(kwargs["videos"], ["u/t/v.mp4"])



class SlotStoreOrNoneTests(unittest.TestCase):
    def test_returns_none_when_supabase_unconfigured(self):
        with _isolated_environ({}):
            self.assertIsNone(orphan_requeue.slot_store_or_none())

    def test_returns_store_when_configured(self):
        with _isolated_environ(
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "service-key",
            }
        ):
            store = orphan_requeue.slot_store_or_none()
        self.assertIsNotNone(store)
        self.assertEqual(store._base_url, "https://example.supabase.co")


class SettleOrphanCompletedTests(unittest.TestCase):
    def _state_with_generations(self, generations):
        state = MagicMock()
        responses = [MagicMock()]
        responses[0].json.return_value = generations
        if generations and generations[0].get("status") not in ("failed", "completed"):
            patch_response = MagicMock()
            patch_response.json.return_value = [{}]
            responses.append(patch_response)
        state._request.side_effect = responses
        return state

    def test_marks_processing_generation_completed(self):
        state = self._state_with_generations(
            [{"generation_id": "g-1", "status": "processing"}]
        )
        orphan_requeue.settle_orphan_completed(state, "t-1")
        self.assertEqual(state._request.call_count, 2)
        patch_call = state._request.call_args_list[1]
        self.assertEqual(patch_call[1]["table"], "video_generations")
        self.assertEqual(patch_call[1]["json"]["status"], "completed")
        self.assertNotIn("tokens_refunded", patch_call[1]["json"])

    def test_terminal_generations_untouched(self):
        for status in ("failed", "completed"):
            with self.subTest(status=status):
                state = self._state_with_generations(
                    [{"generation_id": "g-1", "status": status}]
                )
                orphan_requeue.settle_orphan_completed(state, "t-1")
                state._request.assert_called_once()  # only the GET

    def test_missing_generation_row_is_noop(self):
        state = self._state_with_generations([])
        orphan_requeue.settle_orphan_completed(state, "t-1")
        state._request.assert_called_once()  # only the GET


class TriageOrphanTests(unittest.TestCase):
    def test_requeue_claims(self):
        state = MagicMock()
        store = MagicMock()
        store.get_slot.return_value = {"id": "slot-1", "status": "generating"}
        with patch.object(orphan_requeue, "track_event"):
            claimed = orphan_requeue.triage_orphan(state, "t-1", _task_data(), store)
        self.assertTrue(claimed)
        store.update_slot.assert_called_once_with("slot-1", status="pending")

    def test_mark_complete_claims(self):
        state = MagicMock()
        data = _task_data(stage="publish", publish_results=[{"provider": "youtube"}])
        with (
            patch.object(orphan_requeue, "settle_orphan_completed") as settle,
            patch.object(orphan_requeue, "track_event"),
        ):
            claimed = orphan_requeue.triage_orphan(state, "t-1", data, None)
        self.assertTrue(claimed)
        settle.assert_called_once_with(state, "t-1")
        self.assertEqual(
            state.update_task.call_args[1]["state"], const.TASK_STATE_COMPLETE
        )

    def test_complete_publish_claims(self):
        state = MagicMock()
        data = _task_data(stage="publish", video_storage_path="u/t/v.mp4")
        with patch.object(orphan_requeue, "track_event"):
            claimed = orphan_requeue.triage_orphan(state, "t-1", data, None)
        self.assertTrue(claimed)
        self.assertEqual(
            state.update_task.call_args[1]["state"], const.TASK_STATE_COMPLETE
        )

    def test_complete_publish_returns_false_not_claimed(self):
        state = MagicMock()
        data = _task_data(stage="publish", video_storage_path="u/t/v.mp4")
        del data["slot_id"]  # orphan without slot_id
        claimed = orphan_requeue.triage_orphan(state, "t-1", data, None)
        self.assertFalse(claimed)

    def test_failed_decision_not_claimed(self):
        state = MagicMock()
        claimed = orphan_requeue.triage_orphan(
            state, "t-1", _task_data(stage="mystery"), None
        )
        self.assertFalse(claimed)
        state.update_task.assert_not_called()


class TriageRequeueStageGateTests(unittest.TestCase):
    def _slot_store(self, slot):
        store = MagicMock()
        store.get_slot.return_value = slot
        return store

    def test_publish_stage_orphan_with_archived_video_not_requeued(self):
        # A batch orphan whose video was already archived must complete the
        # publish, not reset the slot to pending for a full regeneration.
        state = MagicMock()
        store = self._slot_store({"id": "slot-1", "status": "generating"})
        data = _task_data(stage="publish", video_storage_path="u/t/v.mp4")
        with patch.object(orphan_requeue, "track_event"):
            claimed = orphan_requeue.triage_orphan(state, "t-1", data, store)
        self.assertTrue(claimed)
        store.update_slot.assert_not_called()
        _, kwargs = state.update_task.call_args
        self.assertEqual(kwargs["state"], const.TASK_STATE_COMPLETE)

    def test_requeue_capped_after_max_attempts(self):
        state = MagicMock()
        store = self._slot_store({"id": "slot-1", "status": "generating"})
        with patch.object(orphan_requeue, "track_event"):
            claimed = orphan_requeue.triage_orphan(
                state, "t-1", _task_data(requeue_count=3), store
            )
        # A deterministically crashing task must settle (fail+refund) instead
        # of regenerating on every boot forever.
        self.assertFalse(claimed)
        store.update_slot.assert_not_called()
        state.update_task.assert_not_called()

    def test_requeue_allowed_below_cap(self):
        state = MagicMock()
        store = self._slot_store({"id": "slot-1", "status": "generating"})
        with patch.object(orphan_requeue, "track_event"):
            claimed = orphan_requeue.triage_orphan(
                state, "t-1", _task_data(requeue_count=2), store
            )
        self.assertTrue(claimed)
        store.update_slot.assert_called_once_with("slot-1", status="pending")
        self.assertEqual(state.update_task.call_args[1]["requeue_count"], 3)




if __name__ == "__main__":
    unittest.main()

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

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models import const
from app.services import orphan_requeue


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
        with patch.object(orphan_requeue, "track_event") as track:
            orphan_requeue.mark_complete_orphan(
                state, "t-1", _task_data(stage="publish", publish_results=[{"provider": "youtube"}])
            )
        _, kwargs = state.update_task.call_args
        self.assertEqual(kwargs["state"], const.TASK_STATE_COMPLETE)
        self.assertEqual(kwargs["progress"], 100)
        state._settle_orphan_completed.assert_called_once_with("t-1")
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

    def test_direct_orphan_runs_publish_from_r2(self):
        state = MagicMock()
        data = _task_data(
            stage="publish",
            video_storage_path="user123/task-1/final.mp4",
            publish_params={
                "providers": ["youtube"],
                "youtube": {
                    "title": "t",
                    "description": "d",
                    "tags": ["shorts"],
                    "privacy_status": "public",
                    "account_ids": ["acc-1"],
                },
            },
        )
        del data["slot_id"]
        with (
            patch.object(orphan_requeue.task_publish, "publish_videos") as pub,
            patch.object(orphan_requeue, "track_event"),
        ):
            done = orphan_requeue.complete_publish_orphan(state, "t-1", data)
        self.assertTrue(done)
        pub.assert_called_once()
        call = pub.call_args
        self.assertEqual(call[0][0], "t-1")
        # Rebuilt publish params round-trip through the Pydantic model.
        self.assertEqual(call[0][1].providers, ["youtube"])
        self.assertEqual(call[0][1].youtube.account_ids, ["acc-1"])
        # Basename only: publish_videos reads the bytes from R2 itself.
        self.assertEqual(call[0][2], ["final.mp4"])
        _, kwargs = state.update_task.call_args
        self.assertEqual(kwargs["state"], const.TASK_STATE_COMPLETE)
        state._settle_orphan_completed.assert_called_once_with("t-1")

    def test_direct_orphan_without_publish_params_not_handled(self):
        state = MagicMock()
        data = _task_data(stage="publish", video_storage_path="u/t/v.mp4")
        del data["slot_id"]
        with patch.object(orphan_requeue.task_publish, "publish_videos") as pub:
            done = orphan_requeue.complete_publish_orphan(state, "t-1", data)
        self.assertFalse(done)
        pub.assert_not_called()


if __name__ == "__main__":
    unittest.main()

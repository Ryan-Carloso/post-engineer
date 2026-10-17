"""Tests for boot-time re-dispatch of orphaned direct generations.

Issue #205 persists the full engine job payload on the video_generations
row at request time. The boot triage uses it to rebuild direct orphans
(tasks with no slot_id on the row) instead of failing+refunding them:

- generation-stage orphan + non-terminal row carrying params -> the
  pipeline restarts in place with the stored payload (no billing change:
  the generation was prepaid at request time);
- no row / terminal row / snapshot-only row / unvalidatable payload ->
  fail+refund, as before (the honest remainder).
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models import const
from app.services import orphan_requeue


def _direct_data(**overrides):
    data = {"stage": "audio", "flow": "direct", "pipeline": "video"}
    data.update(overrides)
    return data


def _row(**overrides):
    row = {
        "params": {"video_subject": "myth busting", "generation_id": "g1"},
        "publish_mode": "asap",
        "status": "running",
    }
    row.update(overrides)
    return row


def _state_with_rows(rows):
    state = MagicMock()
    response = MagicMock()
    response.json.return_value = rows
    state._request.return_value = response
    state._eq.side_effect = lambda value: value
    return state


class DirectGenerationRowTests(unittest.TestCase):
    def test_returns_row_for_non_terminal_row_with_params(self):
        state = _state_with_rows([_row()])
        row = orphan_requeue._direct_generation_row(state, "t-1")
        self.assertEqual(row, _row())
        # The lookup keys the orphan's engine task id.
        query = state._request.call_args[0][1]
        self.assertIn("engine_task_id=eq.t-1", query)

    def test_returns_none_when_no_row(self):
        state = _state_with_rows([])
        self.assertIsNone(orphan_requeue._direct_generation_row(state, "t-1"))

    def test_returns_none_for_terminal_rows(self):
        for status in ("failed", "completed"):
            with self.subTest(status=status):
                state = _state_with_rows([_row(status=status)])
                self.assertIsNone(orphan_requeue._direct_generation_row(state, "t-1"))

    def test_returns_none_without_usable_params(self):
        for params in (None, "not-a-dict", [1, 2]):
            with self.subTest(params=params):
                state = _state_with_rows([_row(params=params)])
                self.assertIsNone(orphan_requeue._direct_generation_row(state, "t-1"))

    def test_returns_none_when_lookup_raises(self):
        state = MagicMock()
        state._request.side_effect = RuntimeError("supabase down")
        state._eq.side_effect = lambda value: value
        self.assertIsNone(orphan_requeue._direct_generation_row(state, "t-1"))


class TriageRedispatchDirectTests(unittest.TestCase):
    def _claimed(self, state, task_id, data):
        with (
            patch("threading.Thread"),
            patch("app.services.task.start"),
            patch.object(orphan_requeue, "track_event"),
        ):
            return orphan_requeue.triage_redispatch_direct(state, task_id, data)

    def test_batch_owned_task_not_claimed(self):
        state = _state_with_rows([_row()])
        claimed = self._claimed(state, "t-1", _direct_data(slot_id="slot-1"))
        self.assertFalse(claimed)
        state._request.assert_not_called()

    def test_non_generation_stage_not_claimed(self):
        state = _state_with_rows([_row()])
        claimed = self._claimed(state, "t-1", _direct_data(stage="publish"))
        self.assertFalse(claimed)
        state._request.assert_not_called()

    def test_non_video_pipeline_not_claimed(self):
        state = _state_with_rows([_row()])
        claimed = self._claimed(state, "t-1", _direct_data(pipeline="subtitle"))
        self.assertFalse(claimed)
        state._request.assert_not_called()

    def test_no_usable_row_not_claimed(self):
        state = _state_with_rows([])
        claimed = self._claimed(state, "t-1", _direct_data())
        self.assertFalse(claimed)
        state.update_task.assert_not_called()

    def test_invalid_params_not_claimed(self):
        state = _state_with_rows([_row(params={"video_subject": 12345})])
        with patch.object(orphan_requeue.logger, "error"):
            claimed = self._claimed(state, "t-1", _direct_data())
        self.assertFalse(claimed)
        state.update_task.assert_not_called()

    def test_cap_reached_not_claimed(self):
        state = _state_with_rows([_row()])
        with patch.object(orphan_requeue.logger, "warning"):
            claimed = self._claimed(
                state, "t-1", _direct_data(requeue_count=orphan_requeue.MAX_AUTO_REQUEUES)
            )
        self.assertFalse(claimed)
        state.update_task.assert_not_called()

    def test_claims_and_restarts_pipeline_in_place(self):
        state = _state_with_rows([_row()])
        with (
            patch("threading.Thread") as mock_thread,
            patch("app.services.task.start") as mock_start,
            patch.object(orphan_requeue, "track_event") as track,
        ):
            claimed = orphan_requeue.triage_redispatch_direct(state, "t-1", _direct_data())
        self.assertTrue(claimed)
        # The task row goes back to a fresh PROCESSING state; the slot
        # binding (scheduled_posts.task_id) and the video_generations row
        # are untouched, so the tick reconciler picks the task up when it
        # finishes. No billing change: the generation was prepaid.
        _, kwargs = state.update_task.call_args
        self.assertEqual(kwargs["state"], const.TASK_STATE_PROCESSING)
        self.assertEqual(kwargs["progress"], 0)
        self.assertIsNone(kwargs["stage"])
        self.assertTrue(kwargs["auto_requeued"])
        self.assertEqual(kwargs["requeue_count"], 1)
        # The pipeline restarts in a daemon thread with the validated
        # stored payload — the same immediate path the tick uses.
        mock_thread.assert_called_once()
        thread_kwargs = mock_thread.call_args.kwargs
        self.assertTrue(thread_kwargs.get("daemon"))
        start_kwargs = thread_kwargs["kwargs"]
        self.assertEqual(start_kwargs["task_id"], "t-1")
        self.assertEqual(start_kwargs["stop_at"], "video")
        self.assertEqual(start_kwargs["params"].video_subject, "myth busting")
        self.assertEqual(start_kwargs["params"].generation_id, "g1")
        # The captured target really is the pipeline entrypoint, wired
        # with these kwargs.
        thread_kwargs["target"](**start_kwargs)
        mock_start.assert_called_once_with(
            task_id="t-1", params=start_kwargs["params"], stop_at="video"
        )
        track.assert_called_once()
        self.assertEqual(track.call_args[0][0], "task_auto_requeued")
        self.assertEqual(track.call_args[0][1]["flow"], "direct")

    def test_requeue_count_increments(self):
        state = _state_with_rows([_row()])
        self._claimed(state, "t-1", _direct_data(requeue_count=2))
        self.assertEqual(state.update_task.call_args[1]["requeue_count"], 3)


class TriageOrphanDirectWiringTests(unittest.TestCase):
    def test_triage_orphan_claims_direct_via_redispatch(self):
        state = _state_with_rows([_row()])
        with (
            patch("threading.Thread"),
            patch("app.services.task.start"),
            patch.object(orphan_requeue, "track_event"),
        ):
            claimed = orphan_requeue.triage_orphan(state, "t-1", _direct_data(), None)
        self.assertTrue(claimed)
        self.assertEqual(state.update_task.call_args[1]["state"], const.TASK_STATE_PROCESSING)


if __name__ == "__main__":
    unittest.main()

"""Tests for boot-time re-dispatch of orphaned direct generations.

Issue #205 persists the full engine job payload on the video_generations
row at request time. The boot triage uses it to rebuild direct orphans
(tasks with no slot_id on the row) instead of failing+refunding them:

- generation-stage orphan + non-terminal row carrying params -> the task
  is marked during review and the pipeline starts later, from the ASGI
  startup hook, through the shared task manager (no billing change: the
  generation was prepaid at request time);
- no row / terminal row / snapshot-only row / unvalidatable payload ->
  fail+refund, as before (the honest remainder).

The review runs inside SupabaseTaskState.__init__, before
app.services.state.state is assigned. These tests drive that order with
a real worker thread, not a mocked threading.Thread.
"""

import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.controllers.manager.memory_manager import InMemoryTaskManager
from app.models import const
from app.services import direct_redispatch, orphan_requeue


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
        row = direct_redispatch._direct_generation_row(state, "t-1")
        self.assertEqual(row, _row())
        # The lookup keys the orphan's engine task id.
        query = state._request.call_args[0][1]
        self.assertIn("engine_task_id=eq.t-1", query)

    def test_returns_none_when_no_row(self):
        state = _state_with_rows([])
        self.assertIsNone(direct_redispatch._direct_generation_row(state, "t-1"))

    def test_returns_none_for_terminal_rows(self):
        for status in ("failed", "completed"):
            with self.subTest(status=status):
                state = _state_with_rows([_row(status=status)])
                self.assertIsNone(direct_redispatch._direct_generation_row(state, "t-1"))

    def test_returns_none_without_usable_params(self):
        for params in (None, "not-a-dict", [1, 2]):
            with self.subTest(params=params):
                state = _state_with_rows([_row(params=params)])
                self.assertIsNone(direct_redispatch._direct_generation_row(state, "t-1"))

    def test_returns_none_when_lookup_raises(self):
        state = MagicMock()
        state._request.side_effect = RuntimeError("supabase down")
        state._eq.side_effect = lambda value: value
        self.assertIsNone(direct_redispatch._direct_generation_row(state, "t-1"))


class TriageRedispatchDirectTests(unittest.TestCase):
    def setUp(self):
        direct_redispatch._pending_direct_redispatches.clear()

    def tearDown(self):
        direct_redispatch._pending_direct_redispatches.clear()

    def _claimed(self, state, task_id, data):
        with patch.object(direct_redispatch, "track_event"):
            return direct_redispatch.triage_redispatch_direct(state, task_id, data)

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

    def test_stage_none_is_not_redispatched(self):
        # stage=None is what a previous redispatch wrote. A crash before
        # the pipeline re-marks a generation stage is failed+refunded, not
        # started again. See the stage=None comment in triage_redispatch_direct.
        state = _state_with_rows([_row()])
        claimed = self._claimed(state, "t-1", _direct_data(stage=None))
        self.assertFalse(claimed)
        state.update_task.assert_not_called()
        state._request.assert_not_called()

    def test_review_does_not_start_a_thread_or_import_the_pipeline(self):
        state = _state_with_rows([_row()])
        before = {thread.name for thread in threading.enumerate()}
        with (
            patch("threading.Thread") as mock_thread,
            patch.object(direct_redispatch, "_load_pipeline_start") as load,
            patch.object(direct_redispatch, "track_event"),
        ):
            claimed = direct_redispatch.triage_redispatch_direct(state, "t-1", _direct_data())
        self.assertTrue(claimed)
        mock_thread.assert_not_called()
        load.assert_not_called()
        spawned = {thread.name for thread in threading.enumerate()} - before
        self.assertEqual(spawned, set())

    def test_claims_and_records_redispatch_for_startup(self):
        state = _state_with_rows([_row()])
        with patch.object(direct_redispatch, "track_event") as track:
            claimed = direct_redispatch.triage_redispatch_direct(state, "t-1", _direct_data())
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
        # The counter write happens during review. Startup is what starts
        # the pipeline; this test stops before that.
        self.assertEqual(len(direct_redispatch._pending_direct_redispatches), 1)
        job = direct_redispatch._pending_direct_redispatches[0]
        self.assertEqual(job.task_id, "t-1")
        self.assertEqual(job.requeue_count, 1)
        self.assertEqual(job.request.video_subject, "myth busting")
        self.assertEqual(job.request.generation_id, "g1")
        # The persisted engine payload (buildJobPayload) carries no publish
        # plan. In-pipeline publish stays a no-op; the slot publisher posts
        # at slot time. A publish key here would post on completion.
        self.assertIsNone(job.request.publish)
        track.assert_called_once()
        self.assertEqual(track.call_args[0][0], "task_auto_requeued")
        self.assertEqual(track.call_args[0][1]["flow"], "direct")

    def test_requeue_count_increments(self):
        state = _state_with_rows([_row()])
        self._claimed(state, "t-1", _direct_data(requeue_count=2))
        self.assertEqual(state.update_task.call_args[1]["requeue_count"], 3)


class TriageOrphanDirectWiringTests(unittest.TestCase):
    def setUp(self):
        direct_redispatch._pending_direct_redispatches.clear()

    def tearDown(self):
        direct_redispatch._pending_direct_redispatches.clear()

    def test_triage_orphan_claims_direct_via_redispatch(self):
        state = _state_with_rows([_row()])
        with patch.object(direct_redispatch, "track_event"):
            claimed = orphan_requeue.triage_orphan(state, "t-1", _direct_data(), None)
        self.assertTrue(claimed)
        self.assertEqual(state.update_task.call_args[1]["state"], const.TASK_STATE_PROCESSING)
        self.assertEqual(len(direct_redispatch._pending_direct_redispatches), 1)


def _wait_until(predicate, timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("timed out waiting for redispatch workers")


class RedispatchStartupTests(unittest.TestCase):
    def setUp(self):
        direct_redispatch._pending_direct_redispatches.clear()

    def tearDown(self):
        direct_redispatch._pending_direct_redispatches.clear()

    def test_pipeline_import_failure_keeps_the_persisted_counter(self):
        # The counter is written during review, before the pipeline import.
        # An import error used to skip that write and retry on every boot.
        state = _state_with_rows([_row()])
        with patch.object(direct_redispatch, "track_event"):
            claimed = direct_redispatch.triage_redispatch_direct(state, "t-1", _direct_data())
        self.assertTrue(claimed)
        self.assertEqual(state.update_task.call_args[1]["requeue_count"], 1)
        manager = InMemoryTaskManager(max_concurrent_tasks=1)
        with (
            patch.object(
                direct_redispatch,
                "_load_pipeline_start",
                side_effect=ImportError("pipeline unavailable"),
            ),
            patch.object(orphan_requeue.logger, "error"),
        ):
            accepted = direct_redispatch.start_pending_direct_redispatches(manager)
        self.assertEqual(accepted, 0)
        self.assertEqual(state.update_task.call_count, 1)
        self.assertEqual(manager.current_tasks, 0)
        self.assertEqual(manager.queue_size(), 0)

    def test_queue_full_keeps_the_persisted_counter(self):
        state = _state_with_rows([_row()])
        with patch.object(direct_redispatch, "track_event"):
            claimed = direct_redispatch.triage_redispatch_direct(state, "t-1", _direct_data())
        self.assertTrue(claimed)
        manager = InMemoryTaskManager(max_concurrent_tasks=0, max_queued_tasks=0)
        with (
            patch("app.services.task.start"),
            patch.object(orphan_requeue.logger, "error"),
        ):
            accepted = direct_redispatch.start_pending_direct_redispatches(manager)
        self.assertEqual(accepted, 0)
        self.assertEqual(state.update_task.call_args[1]["requeue_count"], 1)

    def test_burst_queues_behind_max_concurrent_tasks(self):
        release = threading.Event()
        entered: list[str] = []
        entered_lock = threading.Lock()

        def worker(task_id, params, stop_at="video"):
            with entered_lock:
                entered.append(task_id)
            release.wait(2)

        for index in range(3):
            state = _state_with_rows([_row()])
            with patch.object(direct_redispatch, "track_event"):
                claimed = direct_redispatch.triage_redispatch_direct(
                    state, f"t-{index}", _direct_data()
                )
            self.assertTrue(claimed)
        manager = InMemoryTaskManager(max_concurrent_tasks=1, max_queued_tasks=10)
        try:
            with patch("app.services.task.start", worker):
                accepted = direct_redispatch.start_pending_direct_redispatches(manager)
            self.assertEqual(accepted, 3)
            # Reserved under the lock: one running, two queued, before any
            # worker has to have entered. A bare thread per job would show
            # queue_size 0.
            self.assertEqual(manager.current_tasks, 1)
            self.assertEqual(manager.queue_size(), 2)
            release.set()
            _wait_until(lambda: manager.current_tasks == 0 and manager.queue_size() == 0)
            with entered_lock:
                self.assertEqual(sorted(entered), ["t-0", "t-1", "t-2"])
        finally:
            release.set()

    def test_startup_event_runs_the_worker_only_after_state_is_bound(self):
        """Mirror production order: review inside the state constructor, then startup.

        ``state = DeathDiagnosticTaskState()`` runs the review before the
        module attribute exists. startup_event runs later and is what
        starts the worker. The worker is a real task-manager thread.
        """
        import app.services.state as state_mod
        from app import asgi
        from app.controllers.v1 import video as video_controller

        saved_state = state_mod.state
        saved_manager = video_controller.task_manager
        manager = InMemoryTaskManager(max_concurrent_tasks=2, max_queued_tasks=10)
        started = threading.Event()
        seen: dict[str, object] = {}

        def worker(task_id, params, stop_at="video"):
            # Set the event first so a start during the unbound window is
            # visible even if reading state then raises.
            seen["has_state"] = hasattr(state_mod, "state")
            if hasattr(state_mod, "state"):
                seen["state_is_saved"] = state_mod.state is saved_state
            seen["task_id"] = task_id
            seen["publish"] = params.publish
            seen["stop_at"] = stop_at
            started.set()

        video_controller.task_manager = manager
        try:
            with (
                patch("app.services.task.start", worker),
                patch.object(direct_redispatch, "track_event"),
                patch("app.asgi.warm_client"),
                patch("app.asgi.start_fill_schedule_scheduler"),
                patch("app.services.engine_heartbeat.start_heartbeat_thread"),
                patch("app.services.engine_heartbeat.report_boot_event"),
            ):
                # Constructor window: the name is not published yet.
                del state_mod.state
                try:
                    before = {thread.name for thread in threading.enumerate()}
                    mock_state = _state_with_rows([_row()])
                    claimed = direct_redispatch.triage_redispatch_direct(
                        mock_state, "t-1", _direct_data()
                    )
                    self.assertTrue(claimed)
                    self.assertFalse(started.is_set())
                    spawned = {thread.name for thread in threading.enumerate()} - before
                    self.assertEqual(spawned, set())
                    self.assertEqual(mock_state.update_task.call_args[1]["requeue_count"], 1)
                finally:
                    state_mod.state = saved_state
                asgi.startup_event()
            self.assertTrue(started.wait(2), "startup did not run the redispatch worker")
            self.assertTrue(seen["has_state"])
            self.assertTrue(seen["state_is_saved"])
            self.assertEqual(seen["task_id"], "t-1")
            self.assertIsNone(seen["publish"])
            self.assertEqual(seen["stop_at"], "video")
            _wait_until(lambda: manager.current_tasks == 0)
        finally:
            state_mod.state = saved_state
            video_controller.task_manager = saved_manager
            direct_redispatch._pending_direct_redispatches.clear()


if __name__ == "__main__":
    unittest.main()

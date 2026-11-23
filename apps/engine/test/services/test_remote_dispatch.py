"""Unit tests for app.services.remote_dispatch (one Modal container per video)."""

from __future__ import annotations

import threading
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import modal.exception

from app.config import config
from app.models import const
from app.models.schema import PersonaParams, TaskVideoRequest
from app.services import remote_dispatch
from test.controllers.test_task_segments_request import valid_segments


def _fake_modal(call: MagicMock | None = None, function: MagicMock | None = None) -> SimpleNamespace:
    call = call if call is not None else MagicMock()
    function = function if function is not None else MagicMock()
    return SimpleNamespace(
        exception=modal.exception,
        FunctionCall=SimpleNamespace(from_id=MagicMock(return_value=call)),
        Function=SimpleNamespace(from_name=MagicMock(return_value=function)),
    )


def _faceless_request() -> TaskVideoRequest:
    return TaskVideoRequest(
        video_title="Porto",
        video_description="Test description.",
        video_type="faceless",
        segments=valid_segments(),
    )


class WorkerFunctionTests(unittest.TestCase):
    def test_faceless_house_voice_goes_to_render_faceless(self):
        params = SimpleNamespace(video_type="faceless")
        self.assertEqual(
            remote_dispatch.worker_function_for(params, "en-US-AriaNeural-Female"),
            remote_dispatch.FACELESS_FUNCTION,
        )

    def test_faceless_clone_goes_to_the_10_gib_function(self):
        params = SimpleNamespace(video_type="faceless")
        self.assertEqual(
            remote_dispatch.worker_function_for(params, "chatterbox_nano:uabc_def"),
            remote_dispatch.FACELESS_CLONE_FUNCTION,
        )

    def test_every_lipsync_type_goes_to_render_lipsync(self):
        for video_type in ("hook_lipsync", "full_lipsync"):
            for voice in ("en-US-AriaNeural-Female", "chatterbox_nano:uabc_def"):
                with self.subTest(video_type=video_type, voice=voice):
                    self.assertEqual(
                        remote_dispatch.worker_function_for(SimpleNamespace(video_type=video_type), voice),
                        remote_dispatch.LIPSYNC_FUNCTION,
                    )

    def test_spawn_routes_by_the_persona_voice_not_the_payload_default(self):
        params = TaskVideoRequest(
            video_title="Porto",
            video_description="Test description.",
            video_type="faceless",
            segments=valid_segments(),
            persona=PersonaParams(name="Ana", voice_id="chatterbox_nano:uabc_def"),
        )
        fake = _fake_modal()
        fake.Function.from_name.return_value.spawn.return_value = SimpleNamespace(object_id="fc-1")
        with patch.dict(config.modal_worker, {"app_name": "worker-app"}):
            spawned = remote_dispatch.spawn("t-1", params, "video", modal_module=fake)
        self.assertEqual(spawned, ("fc-1", remote_dispatch.FACELESS_CLONE_FUNCTION))
        fake.Function.from_name.assert_called_once_with("worker-app", remote_dispatch.FACELESS_CLONE_FUNCTION)


class WorkerPayloadTests(unittest.TestCase):
    def test_payload_validates_back_into_the_same_request(self):
        request = _faceless_request()
        payload = remote_dispatch.worker_payload(request)
        self.assertEqual(TaskVideoRequest.model_validate(payload), request)


class PipelineEntryTests(unittest.TestCase):
    def test_off_hands_out_task_start_itself(self):
        sentinel = MagicMock()
        with patch.dict(config.modal_worker, {"app_name": ""}), patch("app.services.task.start", sentinel):
            self.assertIs(remote_dispatch.pipeline_entry(), sentinel)

    def test_on_hands_out_the_dispatcher(self):
        with patch.dict(config.modal_worker, {"app_name": "worker-app"}):
            self.assertIs(remote_dispatch.pipeline_entry(), remote_dispatch.start)


class StartTests(unittest.TestCase):
    def setUp(self):
        remote_dispatch._local_slots = None
        self.addCleanup(setattr, remote_dispatch, "_local_slots", None)

    def test_spawned_task_records_the_call_and_waits_for_it(self):
        state = MagicMock()
        local = MagicMock()
        with patch.dict(config.modal_worker, {"app_name": "worker-app"}), \
                patch.object(remote_dispatch, "spawn", return_value=("fc-1", "render_faceless")), \
                patch.object(remote_dispatch, "wait_for_call") as wait, \
                patch("app.services.state.state", state), \
                patch("app.services.task.start", local):
            remote_dispatch.start("t-1", "params", "video")
        state.update_task.assert_called_once_with(
            "t-1", modal_call_id="fc-1", modal_function="render_faceless"
        )
        wait.assert_called_once_with("t-1", "fc-1", "params")
        local.assert_not_called()

    def test_failed_spawn_runs_the_pipeline_here(self):
        local = MagicMock(return_value="done")
        with patch.dict(config.modal_worker, {"app_name": "worker-app"}), \
                patch.object(remote_dispatch, "spawn", return_value=None), \
                patch.object(remote_dispatch, "wait_for_call") as wait, \
                patch("app.services.task.start", local):
            result = remote_dispatch.start("t-1", "params", "video")
        self.assertEqual(result, "done")
        local.assert_called_once_with("t-1", "params", "video")
        wait.assert_not_called()

    def test_a_non_video_pipeline_is_not_spawned(self):
        local = MagicMock()
        with patch.dict(config.modal_worker, {"app_name": "worker-app"}), \
                patch.object(remote_dispatch, "spawn") as spawn, \
                patch("app.services.task.start", local):
            remote_dispatch.start("t-1", "params", "audio")
        spawn.assert_not_called()
        local.assert_called_once_with("t-1", "params", "audio")

    def test_off_runs_task_start_without_the_local_cap(self):
        local = MagicMock()
        with patch.dict(config.modal_worker, {"app_name": ""}), \
                patch.object(remote_dispatch, "spawn") as spawn, \
                patch.object(remote_dispatch, "_local_semaphore") as semaphore, \
                patch("app.services.task.start", local):
            remote_dispatch.start("t-1", "params", "video")
        spawn.assert_not_called()
        semaphore.assert_not_called()
        local.assert_called_once_with("t-1", "params", "video")

    def test_spawn_failure_is_logged_and_returns_none(self):
        fake = _fake_modal()
        fake.Function.from_name.side_effect = modal.exception.NotFoundError("no app")
        with patch.dict(config.modal_worker, {"app_name": "worker-app"}), \
                patch.object(remote_dispatch, "_effective_voice", return_value=""), \
                patch.object(remote_dispatch.logger, "error") as log:
            spawned = remote_dispatch.spawn("t-1", SimpleNamespace(video_type="faceless"), "video", modal_module=fake)
        self.assertIsNone(spawned)
        self.assertIn("running it locally", log.call_args.args[0])

    def test_local_fallbacks_are_capped(self):
        entered = threading.Event()
        release = threading.Event()
        running: list[str] = []

        def slow(task_id, params, stop_at):
            running.append(task_id)
            entered.set()
            release.wait(5)

        with patch.dict(config.modal_worker, {"local_max_concurrent_tasks": 1}), \
                patch("app.services.task.start", slow):
            first = threading.Thread(target=remote_dispatch.run_local, args=("t-1", None, "video"))
            second = threading.Thread(target=remote_dispatch.run_local, args=("t-2", None, "video"))
            first.start()
            self.assertTrue(entered.wait(5))
            second.start()
            second.join(0.2)
            self.assertEqual(running, ["t-1"])
            release.set()
            first.join(5)
            second.join(5)
        self.assertEqual(running, ["t-1", "t-2"])


class WaitForCallTests(unittest.TestCase):
    def _wait(self, call: MagicMock, row: dict, **extra) -> MagicMock:
        state = MagicMock()
        state.get_task.return_value = row
        with patch("app.services.state.state", state), \
                patch("app.services.task_outcome.fail_or_stop") as fail, \
                patch.dict(config.modal_worker, {"poll_seconds": 0}):
            remote_dispatch.wait_for_call(
                "t-1", "fc-1", "params", modal_module=_fake_modal(call), sleep=lambda _s: None, **extra
            )
        self.state = state
        return fail

    def test_a_finished_call_with_a_terminal_row_settles_nothing(self):
        call = MagicMock()
        call.get.side_effect = [TimeoutError(), None]
        fail = self._wait(call, {"state": const.TASK_STATE_COMPLETE})
        self.assertEqual(call.get.call_count, 2)
        fail.assert_not_called()

    def test_a_finished_call_with_an_open_row_fails_the_task(self):
        call = MagicMock()
        call.get.return_value = None
        fail = self._wait(call, {"state": const.TASK_STATE_PROCESSING, "stage": "render"})
        fail.assert_called_once_with("t-1", remote_dispatch.WORKER_STOPPED_ERROR, "params", stage="render")

    def test_a_timed_out_container_fails_the_task(self):
        call = MagicMock()
        call.get.side_effect = modal.exception.FunctionTimeoutError("timeout")
        fail = self._wait(call, {"state": const.TASK_STATE_PROCESSING})
        self.assertEqual(call.get.call_count, 1)
        fail.assert_called_once_with("t-1", remote_dispatch.WORKER_STOPPED_ERROR, "params", stage="worker")

    def test_an_unreachable_modal_is_polled_again(self):
        call = MagicMock()
        call.get.side_effect = [modal.exception.ConnectionError("down"), None]
        fail = self._wait(call, {"state": const.TASK_STATE_FAILED})
        self.assertEqual(call.get.call_count, 2)
        fail.assert_not_called()

    def test_a_cancelled_task_cancels_the_call_and_drops_the_row(self):
        call = MagicMock()
        with patch("app.services.task_cancellation.is_cancelled", return_value=True):
            fail = self._wait(call, {"state": const.TASK_STATE_PROCESSING})
        call.cancel.assert_called_once_with(terminate_containers=True)
        self.state.delete_task.assert_called_once_with("t-1")
        call.get.assert_not_called()
        fail.assert_not_called()


class CallIsLiveTests(unittest.TestCase):
    def _live(self, outcome: object) -> bool:
        call = MagicMock()
        if isinstance(outcome, BaseException):
            call.get.side_effect = outcome
        else:
            call.get.return_value = outcome
        return remote_dispatch.call_is_live("fc-1", modal_module=_fake_modal(call))

    def test_running_call_is_live(self):
        self.assertTrue(self._live(TimeoutError()))

    def test_finished_call_is_not_live(self):
        self.assertFalse(self._live(None))

    def test_timed_out_or_expired_call_is_not_live(self):
        self.assertFalse(self._live(modal.exception.FunctionTimeoutError("t")))
        self.assertFalse(self._live(modal.exception.OutputExpiredError("e")))

    def test_cancelled_call_is_not_live(self):
        self.assertFalse(self._live(modal.exception.InputCancellation("c")))

    def test_unreachable_modal_counts_as_live(self):
        with patch.object(remote_dispatch.logger, "error") as log:
            self.assertTrue(self._live(modal.exception.ConnectionError("down")))
        self.assertIn("treating it as live", log.call_args.args[0])


class AdoptLiveCallTests(unittest.TestCase):
    def test_row_without_a_call_is_not_adopted(self):
        is_live = MagicMock()
        self.assertFalse(remote_dispatch.adopt_live_call("t-1", {}, is_live=is_live))
        is_live.assert_not_called()

    def test_ended_call_falls_through_to_the_triage(self):
        thread = MagicMock()
        claimed = remote_dispatch.adopt_live_call(
            "t-1", {"modal_call_id": "fc-1"}, is_live=lambda _c: False, spawn_thread=thread
        )
        self.assertFalse(claimed)
        thread.assert_not_called()

    def test_live_call_is_claimed_and_watched(self):
        thread = MagicMock()
        claimed = remote_dispatch.adopt_live_call(
            "t-1", {"modal_call_id": "fc-1"}, is_live=lambda _c: True, spawn_thread=thread
        )
        self.assertTrue(claimed)
        thread.assert_called_once_with(
            target=remote_dispatch.wait_for_call, args=("t-1", "fc-1", None), daemon=True
        )
        thread.return_value.start.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()

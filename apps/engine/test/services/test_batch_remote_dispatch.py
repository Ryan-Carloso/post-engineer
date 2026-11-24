"""Batch dispatch through the Modal CPU worker.

A voiceover slot that spawns returns before touching the local task
manager; an acceptance reported without a spawn still runs the local
path, but the acceptance callback is not run a second time.
"""

from __future__ import annotations

import os
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.models.schema import TaskVideoRequest
from app.services.fill_schedule.scheduler import FillScheduleScheduler


class _FakeStore:
    pass


class BatchRemoteDispatchTests(unittest.TestCase):
    def _scheduler(self):
        return FillScheduleScheduler(
            store=_FakeStore(),
            task_state=MagicMock(),
            publish_video=MagicMock(),
        )

    def _request(self):
        return TaskVideoRequest(
            video_type="voiceover",
            video_title="Batch topic one",
            video_description="Batch description.",
        )

    def test_remote_spawn_returns_before_touching_the_local_manager(self):
        scheduler = self._scheduler()
        call = SimpleNamespace(object_id="fc-1")
        function = SimpleNamespace(spawn=lambda *args: call)
        with (
            patch.dict(
                os.environ,
                {"MODAL_TOKEN_ID": "token-id", "MODAL_TOKEN_SECRET": "secret"},
            ),
            patch("modal.Function.from_name", return_value=function),
            patch("app.controllers.v1.video.task_manager") as manager,
        ):
            scheduler.generator._dispatch_generation(
                "task-remote",
                self._request(),
                "user-1",
                slot_id="slot-1",
                schedule_id="sched-1",
                persona_id="persona-1",
            )
        calls = scheduler.task_state.update_task.call_args_list
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0].kwargs.get("remote_worker"), "modal_cpu")
        self.assertEqual(calls[0].kwargs.get("remote_call_id"), "")
        self.assertEqual(calls[1].kwargs.get("remote_call_id"), "fc-1")
        manager.try_reserve_running.assert_not_called()

    def test_accepted_without_a_spawn_does_not_run_on_accepted_twice(self):
        scheduler = self._scheduler()
        accepted: list[None] = []
        with (
            patch(
                "app.services.cpu_worker_dispatch.try_remote_batch",
                return_value=(False, True),
            ),
            patch("app.controllers.v1.video.task_manager") as manager,
        ):
            scheduler.generator._dispatch_generation(
                "task-local",
                self._request(),
                "user-1",
                slot_id="slot-1",
                on_accepted=lambda: accepted.append(None),
            )
        self.assertEqual(accepted, [])
        reservation = manager.try_reserve_running.return_value
        reservation.start.assert_called_once()
        self.assertEqual(
            scheduler.task_state.update_task.call_count,
            1,
        )


if __name__ == "__main__":
    unittest.main()

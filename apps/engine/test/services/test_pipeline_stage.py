"""Regression tests for issue #198: a crash inside a pipeline phase must be
attributed to the phase that was running, not the previous one.

Before the fix, ``start()`` only recorded the last *completed* phase
(``_last_phase``), so a crash inside a phase was reported with the
previous phase's name (e.g. a persona-image download rejection during
render surfaced as ``stage="music_mood"``).
"""

import unittest
from contextlib import ExitStack
from unittest.mock import patch

from app.models.schema import VideoParams
from app.services import task as tm
from app.services.pipeline_stage import PhaseTracker


class PhaseTrackerTests(unittest.TestCase):
    """Unit tests for the current/completed phase separation."""

    def _tracker(self, persisted=None):
        writes = [] if persisted is None else persisted
        return PhaseTracker("t-1", persist=writes.append), writes

    def test_initial_phase_is_start(self):
        tracker, _ = self._tracker()
        self.assertEqual(tracker.current, "start")
        self.assertEqual(tracker.last_completed, "start")

    def test_begin_advances_current_only(self):
        tracker, writes = self._tracker()
        tracker.begin("render")
        self.assertEqual(tracker.current, "render")
        self.assertEqual(tracker.last_completed, "start")
        self.assertEqual(writes, [])  # begin() never touches task state

    def test_complete_advances_last_completed_and_persists(self):
        tracker, writes = self._tracker()
        tracker.begin("script")
        tracker.complete("script")
        self.assertEqual(tracker.current, "script")
        self.assertEqual(tracker.last_completed, "script")
        self.assertEqual(writes, ["script"])

    def test_crash_mid_phase_reports_current_not_last_completed(self):
        # The exact issue #198 scenario: music_mood completed, render
        # started but crashed — attribution must say "render".
        tracker, _ = self._tracker()
        tracker.begin("music_mood")
        tracker.complete("music_mood")
        tracker.begin("render")
        self.assertEqual(tracker.current, "render")
        self.assertEqual(tracker.last_completed, "music_mood")

    def test_persist_failure_does_not_raise(self):
        def boom(phase):
            raise RuntimeError("db down")

        tracker = PhaseTracker("t-1", persist=boom)
        tracker.complete("audio")  # must not raise
        self.assertEqual(tracker.last_completed, "audio")


class StartPhaseAttributionTests(unittest.TestCase):
    """Crash attribution through ``tm.start()`` uses the running phase."""

    def _track_failed_stages(self, task_id, params, **patches):
        tm._failed_event_emitted_tasks.clear()
        try:
            with ExitStack() as stack:
                stack.enter_context(patch.object(tm.sm.state, "update_task"))
                stack.enter_context(patch.object(tm, "send_discord"))
                stack.enter_context(
                    patch.object(tm.video_storage, "require_r2_configuration")
                )
                stack.enter_context(patch.object(tm, "cleanup_task_intermediates"))
                track = stack.enter_context(patch.object(tm, "track_event"))
                for name, kwargs in patches.items():
                    stack.enter_context(patch.object(tm, name, **kwargs))
                tm.start(task_id=task_id, params=params)
        finally:
            tm._failed_event_emitted_tasks.clear()
        return [
            c[0][1]["stage"]
            for c in track.call_args_list
            if c[0][0] == "video_generation_failed"
        ]

    def test_crash_during_terms_phase_reports_terms_stage(self):
        # generate_script succeeds, generate_terms raises: the terms phase
        # was running, so the failure must say "terms", not "script".
        params = VideoParams(video_subject="Lisbon trams")
        stages = self._track_failed_stages(
            "task-terms-stage",
            params,
            generate_script= {"return_value": "script"},
            save_script_data={},
            generate_terms={"side_effect": RuntimeError("terms exploded")},
        )
        self.assertEqual(len(stages), 1)
        self.assertEqual(stages[0], "terms")

    def test_crash_during_script_phase_reports_script_stage(self):
        # The script phase had started when generate_script raised, so the
        # failure must say "script", not "start".
        params = VideoParams(video_subject="Lisbon trams")
        stages = self._track_failed_stages(
            "task-script-stage",
            params,
            generate_script={"side_effect": RuntimeError("script exploded")},
        )
        self.assertEqual(len(stages), 1)
        self.assertEqual(stages[0], "script")

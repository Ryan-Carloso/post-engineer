"""Tests for app.services.death_diagnostics (DeathDiagnosticTaskState).

The instrumented Supabase backend samples process RSS on every stage mark
and records reconcile stats for the boot autopsy (the PostHog
``engine_boot`` event). The instrumentation lives in its own module because
``app.services.state`` is grandfathered over the file-size cap and may not
grow by a single line.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import engine_heartbeat
from app.services import state as state_module
from app.services.death_diagnostics import DeathDiagnosticTaskState
from test.services.test_supabase_task_state import ENV, _response
from test.services.test_video_storage import _isolated_environ


def _make_diag_state(requests_mock, **kwargs):
    """Build a DeathDiagnosticTaskState whose table-verify SELECT succeeds."""
    requests_mock.request.return_value = _response(json_data=[])
    with _isolated_environ(ENV):
        backend = DeathDiagnosticTaskState(
            requests_module=requests_mock, reconcile_on_boot=False, **kwargs
        )
    # Drop the init verify call so tests index only their own requests.
    requests_mock.request.reset_mock()
    return backend


class DeathDiagnosticStateTests(unittest.TestCase):
    def setUp(self):
        self.requests = MagicMock()

    def test_is_supabase_task_state(self):
        backend = _make_diag_state(self.requests)
        self.assertIsInstance(backend, state_module.SupabaseTaskState)

    def test_last_reconcile_stats_defaults_empty(self):
        # The attribute must exist even when reconcile_on_boot=False: the
        # boot autopsy reads it via getattr with a default, but an absent
        # attribute would silently report zero orphans.
        backend = _make_diag_state(self.requests)
        self.assertEqual(backend.last_reconcile_stats, {})

    def test_reconcile_records_stats(self):
        backend = _make_diag_state(self.requests)
        orphans = [
            {"task_id": "t-1", "data": {"stage": "audio"}},
            {"task_id": "t-2", "data": {"stage": "render"}},
            {"task_id": "t-3", "data": {}},
        ]
        self.requests.request.side_effect = [
            _response(json_data=orphans),  # subclass orphan snapshot SELECT
            _response(json_data=orphans),  # base reconcile SELECT
            *[
                response
                for _ in orphans
                for response in (
                    _response(json_data=[]),  # GET video_generations (redispatch lookup)
                    _response(json_data=[]),  # GET video_generations (billing settle)
                    _response(json_data=[{}]),  # PATCH task failed
                )
            ],
        ]
        with patch.object(state_module.logger, "warning"):
            failed = backend.reconcile_orphaned_tasks()
        self.assertEqual(failed, 3)
        # The snapshot is the orphan-listing filter, not some other GET.
        snapshot_url = self.requests.request.call_args_list[0][0][1]
        self.assertIn("state=not.in.", snapshot_url)
        stats = backend.last_reconcile_stats
        self.assertEqual(stats["orphans"], 3)
        self.assertEqual(stats["by_stage"], {"audio": 1, "render": 1, "unknown": 1})
        self.assertEqual(stats["failed"], 3)

    def test_reconcile_without_orphans_records_zero_stats(self):
        backend = _make_diag_state(self.requests)
        self.requests.request.side_effect = [
            _response(json_data=[]),  # subclass orphan snapshot SELECT
            _response(json_data=[]),  # base reconcile SELECT
        ]
        with patch.object(state_module.logger, "warning"):
            failed = backend.reconcile_orphaned_tasks()
        self.assertEqual(failed, 0)
        stats = backend.last_reconcile_stats
        self.assertEqual(stats["orphans"], 0)
        self.assertEqual(stats["by_stage"], {})
        self.assertEqual(stats["failed"], 0)

    def test_update_task_samples_rss_on_stage(self):
        backend = _make_diag_state(self.requests)
        self.requests.request.side_effect = [
            _response(json_data=[]),  # _select_row: no existing row
            _response(json_data=[{}]),  # POST upsert
        ]
        backend.update_task("t-1", stage="audio")
        post = self.requests.request.call_args_list[1]
        data = post[1]["json"]["data"]
        self.assertEqual(data["stage"], "audio")
        self.assertIn("stage_rss_mb", data)
        self.assertGreater(data["stage_rss_mb"], 0)

    def test_update_task_skips_rss_without_stage(self):
        backend = _make_diag_state(self.requests)
        self.requests.request.side_effect = [
            _response(json_data=[]),
            _response(json_data=[{}]),
        ]
        backend.update_task("t-1", progress=10)
        post = self.requests.request.call_args_list[1]
        self.assertNotIn("stage_rss_mb", post[1]["json"]["data"])

    def test_update_task_skips_rss_when_unreadable(self):
        backend = _make_diag_state(self.requests)
        self.requests.request.side_effect = [
            _response(json_data=[]),
            _response(json_data=[{}]),
        ]
        with patch.object(engine_heartbeat, "current_rss_mb", return_value=None):
            backend.update_task("t-1", stage="audio")
        post = self.requests.request.call_args_list[1]
        data = post[1]["json"]["data"]
        self.assertEqual(data["stage"], "audio")
        self.assertNotIn("stage_rss_mb", data)


if __name__ == "__main__":
    unittest.main()

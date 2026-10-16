"""Tests for engine liveness heartbeat + boot death-diagnosis.

A dead process cannot report its own death: the heartbeat row is telemetry
from *before* death, and the engine_boot PostHog event is the autopsy at
the next boot (gap since last heartbeat, clean/unclean shutdown, last RSS).
"""

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import engine_heartbeat


def _response(json_data=None):
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = json_data if json_data is not None else {}
    response.raise_for_status.return_value = None
    return response


class ResourceSnapshotTests(unittest.TestCase):
    def test_rss_is_positive(self):
        rss = engine_heartbeat.current_rss_mb()
        self.assertIsNotNone(rss)
        self.assertGreater(rss, 0)

    def test_vram_returns_none_or_number(self):
        vram = engine_heartbeat.current_vram_mb()
        self.assertTrue(vram is None or vram >= 0)


class HeartbeatIoTests(unittest.TestCase):
    def test_write_beat_upserts_row_one(self):
        requests_mock = MagicMock()
        requests_mock.request.return_value = _response(json_data={})
        with patch.dict(
            "os.environ",
            {
                "SUPABASE_URL": "https://supabase.example",
                "SUPABASE_SERVICE_ROLE_KEY": "service-key",
            },
            clear=True,
        ):
            ok = engine_heartbeat.write_beat(requests_module=requests_mock)
        self.assertTrue(ok)
        (method, url), kwargs = requests_mock.request.call_args
        self.assertEqual(method, "POST")
        self.assertIn("/rest/v1/engine_heartbeat", url)
        self.assertEqual(kwargs["json"]["id"], 1)
        self.assertIn("rss_mb", kwargs["json"])
        self.assertIn("uptime_s", kwargs["json"])
        self.assertIn("Prefer", kwargs["headers"])

    def test_write_beat_requires_env(self):
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(RuntimeError):
                engine_heartbeat.write_beat(requests_module=MagicMock())

    def test_read_beat_returns_row(self):
        row = {"id": 1, "rss_mb": 512.0}
        requests_mock = MagicMock()
        requests_mock.request.return_value = _response(json_data=[row])
        with patch.dict(
            "os.environ",
            {
                "SUPABASE_URL": "https://supabase.example",
                "SUPABASE_SERVICE_ROLE_KEY": "service-key",
            },
            clear=True,
        ):
            self.assertEqual(engine_heartbeat.read_beat(requests_module=requests_mock), row)

    def test_read_beat_none_when_empty(self):
        requests_mock = MagicMock()
        requests_mock.request.return_value = _response(json_data=[])
        with patch.dict(
            "os.environ",
            {
                "SUPABASE_URL": "https://supabase.example",
                "SUPABASE_SERVICE_ROLE_KEY": "service-key",
            },
            clear=True,
        ):
            self.assertIsNone(engine_heartbeat.read_beat(requests_module=requests_mock))

    def test_mark_clean_shutdown_patches_row(self):
        requests_mock = MagicMock()
        requests_mock.request.return_value = _response(json_data={})
        with patch.dict(
            "os.environ",
            {
                "SUPABASE_URL": "https://supabase.example",
                "SUPABASE_SERVICE_ROLE_KEY": "service-key",
            },
            clear=True,
        ):
            ok = engine_heartbeat.mark_clean_shutdown(requests_module=requests_mock)
        self.assertTrue(ok)
        (method, url), kwargs = requests_mock.request.call_args
        self.assertEqual(method, "PATCH")
        self.assertIn("id=eq.1", url)
        self.assertIn("clean_shutdown_at", kwargs["json"])

    def test_start_heartbeat_thread_is_daemon(self):
        with patch.object(engine_heartbeat, "write_beat") as write:
            thread = engine_heartbeat.start_heartbeat_thread(interval_s=3600)
        self.assertTrue(thread.daemon)
        self.assertTrue(thread.is_alive())
        write.assert_called_once()


class CleanShutdownTests(unittest.TestCase):
    def _beat(self, **overrides):
        now = datetime.now(timezone.utc)
        beat = {
            "updated_at": now.isoformat(),
            "clean_shutdown_at": now.isoformat(),
        }
        beat.update(overrides)
        return beat

    def test_fresh_stamp_is_clean(self):
        self.assertTrue(engine_heartbeat.is_clean_shutdown(self._beat()))

    def test_missing_stamp_is_unclean(self):
        beat = self._beat()
        del beat["clean_shutdown_at"]
        self.assertFalse(engine_heartbeat.is_clean_shutdown(beat))

    def test_stale_stamp_is_unclean(self):
        now = datetime.now(timezone.utc)
        beat = self._beat(
            updated_at=now.isoformat(),
            clean_shutdown_at=(now - timedelta(hours=2)).isoformat(),
        )
        self.assertFalse(engine_heartbeat.is_clean_shutdown(beat))


class BootEventTests(unittest.TestCase):
    def _state(self):
        state = MagicMock()
        state.last_reconcile_stats = {
            "orphans": 2,
            "by_stage": {"audio": 1, "publish": 1},
            "requeued": 1,
            "completed": 0,
            "failed": 1,
        }
        return state

    def test_boot_event_carries_autopsy(self):
        now = datetime.now(timezone.utc)
        beat = {
            "updated_at": (now - timedelta(minutes=40)).isoformat(),
            "clean_shutdown_at": None,
            "uptime_s": 3600.0,
            "rss_mb": 6100.5,
            "vram_mb": None,
        }
        with (
            patch.object(engine_heartbeat, "read_beat", return_value=beat),
            patch.object(engine_heartbeat, "track_event") as track,
        ):
            engine_heartbeat.report_boot_event(self._state())
        track.assert_called_once()
        name, props = track.call_args[0]
        self.assertEqual(name, "engine_boot")
        self.assertEqual(props["orphan_count"], 2)
        self.assertEqual(props["orphans_by_stage"], {"audio": 1, "publish": 1})
        self.assertEqual(props["orphans_requeued"], 1)
        self.assertEqual(props["orphans_failed"], 1)
        self.assertFalse(props["clean_shutdown"])
        self.assertAlmostEqual(props["gap_since_last_heartbeat_s"], 2400, delta=120)
        self.assertEqual(props["prev_uptime_s"], 3600.0)
        self.assertEqual(props["rss_last_heartbeat_mb"], 6100.5)

    def test_boot_event_without_beat(self):
        with (
            patch.object(engine_heartbeat, "read_beat", return_value=None),
            patch.object(engine_heartbeat, "track_event") as track,
        ):
            engine_heartbeat.report_boot_event(self._state())
        _, props = track.call_args[0]
        self.assertEqual(props["orphan_count"], 2)
        self.assertNotIn("clean_shutdown", props)
        self.assertNotIn("gap_since_last_heartbeat_s", props)

    def test_boot_event_never_raises(self):
        with patch.object(engine_heartbeat, "read_beat", side_effect=RuntimeError("down")):
            # Must not raise: boot diagnostics never break boot.
            engine_heartbeat.report_boot_event(MagicMock())


class MigrationSyncTests(unittest.TestCase):
    def test_heartbeat_migration_pins_table(self):
        path = (
            Path(__file__).parent.parent.parent.parent.parent
            / "supabase"
            / "migrations"
            / "020_engine-heartbeat.sql"
        )
        self.assertTrue(path.exists(), f"missing {path}")
        sql = path.read_text()
        self.assertIn("create table if not exists public.engine_heartbeat", sql)
        self.assertIn("clean_shutdown_at", sql)


if __name__ == "__main__":
    unittest.main()


class StateWiringTests(unittest.TestCase):
    """reconcile stats + per-stage RSS sampling on the Supabase backend."""

    def setUp(self):
        from test.services.test_supabase_task_state import (
            _make_state as make_state,
        )

        self.requests = MagicMock()
        self._make_state = make_state

    def _state(self):
        from test.services.test_supabase_task_state import _response

        backend = self._make_state(self.requests)
        self._response = _response
        return backend

    def test_reconcile_records_stats(self):
        from unittest.mock import patch

        from app.services import state as state_module

        backend = self._state()
        orphans = [
            {"task_id": "t-1", "data": {"stage": "audio"}},
            {"task_id": "t-2", "data": {"stage": "render"}},
            {"task_id": "t-3", "data": {}},
        ]
        self.requests.request.side_effect = [
            self._response(json_data=orphans),  # SELECT non-terminal rows
            *[
                response
                for _ in orphans
                for response in (
                    self._response(json_data=[]),  # GET video_generations
                    self._response(json_data=[{}]),  # PATCH task failed
                )
            ],
        ]
        with patch.object(state_module.logger, "warning"):
            failed = backend.reconcile_orphaned_tasks()
        self.assertEqual(failed, 3)
        stats = backend.last_reconcile_stats
        self.assertEqual(stats["orphans"], 3)
        self.assertEqual(stats["by_stage"], {"audio": 1, "render": 1, "unknown": 1})
        self.assertEqual(stats["failed"], 3)

    def test_update_task_samples_rss_on_stage(self):
        backend = self._state()
        self.requests.request.side_effect = [
            self._response(json_data=[]),  # _select_row: no existing row
            self._response(json_data=[{}]),  # POST upsert
        ]
        backend.update_task("t-1", stage="audio")
        post = self.requests.request.call_args_list[1]
        data = post[1]["json"]["data"]
        self.assertEqual(data["stage"], "audio")
        self.assertIn("stage_rss_mb", data)
        self.assertGreater(data["stage_rss_mb"], 0)

    def test_update_task_skips_rss_without_stage(self):
        backend = self._state()
        self.requests.request.side_effect = [
            self._response(json_data=[]),
            self._response(json_data=[{}]),
        ]
        backend.update_task("t-1", progress=10)
        post = self.requests.request.call_args_list[1]
        self.assertNotIn("stage_rss_mb", post[1]["json"]["data"])

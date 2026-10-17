"""Tests for engine liveness heartbeat + boot death-diagnosis.

A dead process cannot report its own death: the heartbeat row is telemetry
from *before* death, and the engine_boot PostHog event is the autopsy at
the next boot (gap since last heartbeat, clean/unclean shutdown, last RSS).
"""

import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import engine_heartbeat


def _migration_path(name: str, start: Path | None = None) -> Path | None:
    """Locate ``supabase/migrations/<name>`` by walking up from ``start``.

    The suite also runs from a relocated ``mutants/`` tree under mutmut, so
    a fixed number of ``.parent`` hops lands in the wrong place; walk up
    until a directory containing ``supabase/migrations`` is found instead.
    """
    here = (start if start is not None else Path(__file__)).resolve()
    dirs = [here] if here.is_dir() else []
    for candidate in (*dirs, *here.parents):
        found = candidate / "supabase" / "migrations" / name
        if found.is_file():
            return found
    return None


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


class MigrationPathTests(unittest.TestCase):
    def test_finds_migration_from_repo_layout(self):
        path = _migration_path("020_engine-heartbeat.sql")
        self.assertIsNotNone(path)
        self.assertEqual(path.name, "020_engine-heartbeat.sql")

    def test_walks_up_past_mutants_tree(self):
        # Simulate mutmut's relocated tree: the test file lives under
        # <root>/apps/engine/mutants/test/services/ while the migration
        # stays at <root>/supabase/migrations/.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "supabase" / "migrations").mkdir(parents=True)
            want = root / "supabase" / "migrations" / "020_engine-heartbeat.sql"
            want.write_text("-- heartbeat")
            fake_test = (
                root / "apps" / "engine" / "mutants" / "test" / "services"
                / "test_engine_heartbeat.py"
            )
            fake_test.parent.mkdir(parents=True)
            self.assertEqual(
                _migration_path("020_engine-heartbeat.sql", start=fake_test), want
            )

    def test_returns_none_when_migration_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake_test = Path(tmp) / "apps" / "engine" / "mutants" / "test_x.py"
            self.assertIsNone(
                _migration_path("020_engine-heartbeat.sql", start=fake_test)
            )


class MigrationSyncTests(unittest.TestCase):
    def test_heartbeat_migration_pins_table(self):
        path = _migration_path("020_engine-heartbeat.sql")
        self.assertIsNotNone(path, "missing supabase/migrations/020_engine-heartbeat.sql")
        sql = path.read_text()
        self.assertIn("create table if not exists public.engine_heartbeat", sql)
        self.assertIn("clean_shutdown_at", sql)


if __name__ == "__main__":
    unittest.main()

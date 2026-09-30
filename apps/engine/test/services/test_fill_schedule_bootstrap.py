"""Tests for the fill schedule bootstrap in asgi (app/asgi.py).

The scheduler starts on its own at app boot — no env flag — when the
Supabase envs are present. Without the envs → skip with a log, never a
boot crash.
"""

import os
import subprocess
import sys
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

ENGINE_ROOT = Path(__file__).parent.parent.parent

SUPABASE_ENV = {
    "SUPABASE_URL": "https://supabase.example",
    "SUPABASE_SERVICE_ROLE_KEY": "service-key",
}


class StartFillScheduleSchedulerTests(unittest.TestCase):
    def _import_asgi(self):
        from app import asgi

        return asgi

    def test_missing_supabase_env_skips_without_crash(self):
        asgi = self._import_asgi()
        env = {"SUPABASE_URL": "", "SUPABASE_SERVICE_ROLE_KEY": ""}
        with patch.dict(os.environ, env, clear=False):
            with patch.object(asgi, "start_fill_schedule_thread") as thread:
                # Must not raise — app boot continues.
                asgi.start_fill_schedule_scheduler()
        thread.assert_not_called()

    def test_starts_thread_and_notifies_discord(self):
        asgi = self._import_asgi()
        notifications = []
        with patch.dict(os.environ, SUPABASE_ENV, clear=False):
            with patch.object(asgi, "ScheduleStore") as store_cls, \
                 patch.object(asgi, "FillScheduleScheduler") as scheduler_cls, \
                 patch.object(asgi, "start_fill_schedule_thread") as thread, \
                 patch("app.services.notify.send_discord", side_effect=lambda m: notifications.append(m) or True):
                asgi.start_fill_schedule_scheduler()
        store_cls.assert_called_once()
        scheduler_cls.assert_called_once()
        thread.assert_called_once()
        self.assertTrue(any("started" in message for message in notifications))

    def test_scheduler_starts_without_a_queue_dependency(self):
        # The daily persona batch (and its queue) is gone: the scheduler
        # boots with only the store, no queue wiring required.
        asgi = self._import_asgi()
        self.assertFalse(hasattr(asgi, "fill_schedule_queue"))
        notifications = []
        with patch.dict(os.environ, SUPABASE_ENV, clear=False):
            with patch.object(asgi, "ScheduleStore") as store_cls, \
                 patch.object(asgi, "FillScheduleScheduler") as scheduler_cls, \
                 patch.object(asgi, "start_fill_schedule_thread") as thread, \
                 patch("app.services.notify.send_discord", side_effect=lambda m: notifications.append(m) or True):
                asgi.start_fill_schedule_scheduler()
        store_cls.assert_called_once()
        scheduler_cls.assert_called_once()
        thread.assert_called_once()
        self.assertTrue(any("started" in message for message in notifications))


@contextmanager
def _without_pytest_modules():
    """Temporarily hide pytest from sys.modules (restored on exit).

    Lets a test exercise the real pytest-detection logic as if it ran
    outside a pytest session. Only the pytest entries are removed — the
    rest of the module registry stays intact.
    """
    hidden = {
        name: sys.modules.pop(name)
        for name in list(sys.modules)
        if name == "pytest" or name.startswith("pytest.")
    }
    try:
        yield
    finally:
        sys.modules.update(hidden)


def _env_without_pytest(extra=None):
    # Simulate "outside any test run": strip both the pytest fingerprint and
    # the suite bootstrap marker (test/__init__.py sets ENGINE_UNDER_TEST=1
    # for the whole session).
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in ("PYTEST_CURRENT_TEST", "ENGINE_UNDER_TEST")
    }
    env.update(extra or {})
    return env


class ErrorTrackingInitTests(unittest.TestCase):
    def _import_asgi(self):
        from app import asgi

        return asgi

    def test_error_tracking_disabled_under_pytest(self):
        # Regression: importing app.asgi during pytest collection runs
        # load_dotenv(), which loads the tracked .env with the real
        # BUGSINK_DSN. The test process must never attach production
        # error tracking.
        asgi = self._import_asgi()
        self.assertFalse(asgi.should_init_error_tracking())

    def test_error_tracking_enabled_with_dsn_outside_pytest(self):
        asgi = self._import_asgi()
        with patch.dict(os.environ, _env_without_pytest({"BUGSINK_DSN": "https://x@y/1"}), clear=True), \
             _without_pytest_modules():
            self.assertNotIn("PYTEST_CURRENT_TEST", os.environ)
            self.assertNotIn("pytest", sys.modules)
            self.assertTrue(asgi.should_init_error_tracking())

    def test_error_tracking_disabled_without_dsn(self):
        asgi = self._import_asgi()
        with patch.dict(os.environ, {}, clear=True), _without_pytest_modules():
            self.assertNotIn("BUGSINK_DSN", os.environ)
            self.assertFalse(asgi.should_init_error_tracking())

    def test_asgi_import_warns_when_guard_fires_without_runner(self):
        # Review MINOR: a production-like process where the guard fires but
        # no test runner is behind it (leaked ENGINE_UNDER_TEST, no pytest /
        # unittest importable) must warn loudly about the skipped error
        # tracking — not stay silent at debug. Runs in a subprocess so the
        # real import-time branch executes in isolation.
        env = {
            k: v
            for k, v in os.environ.items()
            if k not in ("PYTEST_CURRENT_TEST",)
        }
        env["ENGINE_UNDER_TEST"] = "1"
        env["BUGSINK_DSN"] = "https://x@y/1"
        proc = subprocess.run(
            [sys.executable, "-c", "import app.asgi"],
            capture_output=True,
            text=True,
            cwd=ENGINE_ROOT,
            env=env,
            timeout=120,
        )
        output = proc.stdout + proc.stderr
        self.assertEqual(proc.returncode, 0, output[-2000:])
        self.assertIn("no test runner detected", output)

    def test_asgi_import_enables_tracking_with_dsn_outside_tests(self):
        # Sanity: without any guard trigger and a PostHog key set, tracking
        # initializes (info log) — the warning above is specific to the
        # guard firing without a runner.
        env = {
            k: v
            for k, v in os.environ.items()
            if k not in ("PYTEST_CURRENT_TEST", "ENGINE_UNDER_TEST")
        }
        env["POSTHOG_API_KEY"] = "phc_test_key"
        proc = subprocess.run(
            [sys.executable, "-c", "import app.asgi"],
            capture_output=True,
            text=True,
            cwd=ENGINE_ROOT,
            env=env,
            timeout=120,
        )
        output = proc.stdout + proc.stderr
        self.assertEqual(proc.returncode, 0, output[-2000:])
        self.assertIn("PostHog error tracking enabled", output)
        self.assertNotIn("no test runner detected", output)


if __name__ == "__main__":
    unittest.main()

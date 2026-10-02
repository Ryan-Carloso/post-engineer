"""Tests for the Discord notifier (app/services/notify.py).

The notifier is fire-and-forget: it never raises, never logs the webhook
URL, and becomes a no-op when DISCORD_WEBHOOK_URL is not set.
"""

import sys
import unittest
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import notify as nf


class SendDiscordTests(unittest.TestCase):
    def test_noop_when_env_missing(self):
        with patch.dict(os_environ(), {}, clear=True):
            post = MagicMock()
            self.assertFalse(nf.send_discord("hello", post=post))
            post.assert_not_called()

    def test_posts_content_json_to_env_url(self):
        post = MagicMock()
        with patch.dict(os_environ(), {"DISCORD_WEBHOOK_URL": "https://discord/hook"}, clear=True):
            sent = nf.send_discord("batch done", post=post)
        self.assertTrue(sent)
        post.assert_called_once_with("https://discord/hook", {"content": "batch done"})

    def test_never_raises_when_post_fails(self):
        post = MagicMock(side_effect=RuntimeError("network down"))
        with patch.dict(os_environ(), {"DISCORD_WEBHOOK_URL": "https://discord/hook"}, clear=True):
            sent = nf.send_discord("hello", post=post)
        self.assertFalse(sent)

    def test_non_2xx_response_counts_as_failure(self):
        response = MagicMock()
        response.raise_for_status.side_effect = Exception("500 Server Error")
        post = MagicMock(return_value=response)
        with patch.dict(os_environ(), {"DISCORD_WEBHOOK_URL": "https://discord/hook"}, clear=True):
            sent = nf.send_discord("hello", post=post)
        self.assertFalse(sent)
        post.assert_called_once()

    def test_real_network_path_skipped_under_pytest(self):
        # Regression: the engine test suite must never ping the production
        # Discord channel. Importing app.asgi during collection runs
        # load_dotenv(), which loads the tracked .env with the REAL
        # DISCORD_WEBHOOK_URL — without this guard, every full-suite run
        # fires a real alert (e.g. task "test-custom-audio-missing").
        # ENGINE_UNDER_TEST is kept: the suite bootstrap marker is what the
        # guard relies on under `python -m unittest`.
        env = {"DISCORD_WEBHOOK_URL": "https://discord/hook", "ENGINE_UNDER_TEST": "1"}
        with patch.dict(os_environ(), env, clear=True), \
             patch.object(nf, "_default_post") as default_post:
            sent = nf.send_discord("hello")  # no injected post: the production path
        self.assertFalse(sent)
        default_post.assert_not_called()

    def test_bare_pytest_import_is_not_treated_as_test_run(self):
        # Review MINOR: a bare pytest import in a production process
        # (debugger, profiler, plugin) must NOT disable alerts — the
        # "pytest in sys.modules" heuristic is dropped. Genuine runs are
        # covered by ENGINE_UNDER_TEST / PYTEST_CURRENT_TEST instead.
        # Import pytest explicitly to simulate the leak; its presence
        # must not matter either way.
        import pytest  # noqa: F401
        env = {
            k: v
            for k, v in os_environ().items()
            if k not in ("PYTEST_CURRENT_TEST", "ENGINE_UNDER_TEST")
        }
        with patch.dict(os_environ(), env, clear=True):
            self.assertIn("pytest", sys.modules)
            self.assertFalse(nf.running_under_test())
            self.assertFalse(nf.test_skip_is_suspicious())

    def test_skip_warns_when_marker_leaks_without_runner(self):
        # Review MINOR: ENGINE_UNDER_TEST=1 with no test runner behind it
        # (leaked production env) must warn, not stay silent at debug.
        # The entry point is faked as a plain process: without it, the
        # real `python -m unittest` CLI entry would count as a runner.
        plain_main = SimpleNamespace(__spec__=None)
        env = {"DISCORD_WEBHOOK_URL": "https://discord/hook", "ENGINE_UNDER_TEST": "1"}
        with _without_pytest_modules(), \
             patch.dict(os_environ(), env, clear=True), \
             patch.dict(sys.modules, {"__main__": plain_main}), \
             patch.object(nf.logger, "warning") as warn, \
             patch.object(nf.logger, "debug") as debug:
            sent = nf.send_discord("hello")
        self.assertFalse(sent)
        warn.assert_called_once()
        debug.assert_not_called()
        # Review MINOR round 2: the warning must describe the leaked-marker
        # case (ENGINE_UNDER_TEST=1 with no runner behind it), not the old
        # pytest-leak-into-sys.modules scenario.
        (warning_text,), _ = warn.call_args
        self.assertIn("ENGINE_UNDER_TEST", warning_text)
        self.assertIn("no test runner", warning_text)

    def test_skip_stays_quiet_under_ide_unittest_driver(self):
        # Review MINOR: PyCharm/VSCode run unittest modules without the
        # `python -m unittest` entry point — their driver scripts count as
        # unittest runners (best-effort, matched on the entry script path),
        # so the bootstrap marker is corroborated and the skip stays at
        # debug level.
        ide_main = SimpleNamespace(__spec__=None)
        env = {"DISCORD_WEBHOOK_URL": "https://discord/hook", "ENGINE_UNDER_TEST": "1"}
        for argv0 in (
            "/opt/pycharm/helpers/utrunner.py",
            "/home/u/.vscode/extensions/ms-python/pythonFiles/unittestadapter/execution.py",
        ):
            with self.subTest(argv0=argv0), \
                 _without_pytest_modules(), \
                 patch.dict(os_environ(), env, clear=True), \
                 patch.dict(sys.modules, {"__main__": ide_main}), \
                 patch.object(sys, "argv", [argv0]), \
                 patch.object(nf.logger, "warning") as warn, \
                 patch.object(nf.logger, "debug") as debug:
                sent = nf.send_discord("hello")
            self.assertFalse(sent)
            warn.assert_not_called()
            debug.assert_called_once()

    def test_skip_stays_quiet_during_real_test_run(self):
        # A genuine test run (PYTEST_CURRENT_TEST set) keeps the skip at
        # debug — no warning noise in the test suite.
        env = {"DISCORD_WEBHOOK_URL": "https://discord/hook", "PYTEST_CURRENT_TEST": "test_x (call)"}
        with patch.dict(os_environ(), env, clear=True), \
             patch.object(nf.logger, "warning") as warn, \
             patch.object(nf.logger, "debug") as debug:
            sent = nf.send_discord("hello")
        self.assertFalse(sent)
        warn.assert_not_called()
        debug.assert_called_once()

    def test_skip_under_unittest_cli_runner(self):
        # Review MINOR: the guard must also hold under `python -m unittest`,
        # where neither PYTEST_CURRENT_TEST nor pytest is present. Simulate
        # the CLI runner precisely: runpy executes unittest.__main__ as
        # __main__, so the entry module's spec name is "unittest.__main__"
        # (verified). The suite bootstrap marker is the authoritative
        # signal there — the skip stays quiet (debug).
        cli_main = SimpleNamespace(__spec__=SimpleNamespace(name="unittest.__main__"))
        env = {"DISCORD_WEBHOOK_URL": "https://discord/hook", "ENGINE_UNDER_TEST": "1"}
        with _without_pytest_modules(), \
             patch.dict(os_environ(), env, clear=True), \
             patch.dict(sys.modules, {"__main__": cli_main}), \
             patch.object(nf.logger, "warning") as warn, \
             patch.object(nf.logger, "debug") as debug, \
             patch.object(nf, "_default_post") as default_post:
            sent = nf.send_discord("hello")
        self.assertFalse(sent)
        default_post.assert_not_called()
        warn.assert_not_called()
        debug.assert_called_once()

    def test_skip_warns_when_marker_leaks_with_plain_unittest_import(self):
        # Review MINOR: ENGINE_UNDER_TEST=1 plus a mere `import unittest`
        # (no CLI runner behind it — e.g. a library importing unittest in
        # production) must warn, not silently disable alerts at debug.
        plain_main = SimpleNamespace(__spec__=None)
        env = {"DISCORD_WEBHOOK_URL": "https://discord/hook", "ENGINE_UNDER_TEST": "1"}
        with _without_pytest_modules(), \
             patch.dict(os_environ(), env, clear=True), \
             patch.dict(sys.modules, {"__main__": plain_main}), \
             patch.object(nf.logger, "warning") as warn, \
             patch.object(nf.logger, "debug") as debug:
            # unittest stays importable — only the CLI entry point is absent.
            self.assertIn("unittest", sys.modules)
            sent = nf.send_discord("hello")
        self.assertFalse(sent)
        warn.assert_called_once()
        debug.assert_not_called()

    def test_injected_post_still_works_under_pytest(self):
        # The guard only blocks the real network path; tests that inject a
        # fake post keep exercising the send logic.
        post = MagicMock()
        with patch.dict(os_environ(), {"DISCORD_WEBHOOK_URL": "https://discord/hook"}, clear=True):
            sent = nf.send_discord("hello", post=post)
        self.assertTrue(sent)
        post.assert_called_once()

    def test_reason_never_contains_webhook_url(self):
        # M5: detection uses the REAL configured env URL (not the "http"
        # substring), so exceptions with a generic "http" keep the detail.
        with patch.dict(os_environ(), {"DISCORD_WEBHOOK_URL": "https://discord/hook"}, clear=True):
            exc = Exception("https://discord/hook connection refused")
            self.assertNotIn("discord/hook", nf.safe_reason(exc))
            self.assertEqual(nf.safe_reason(exc), "Exception")
            # common error with another URL: detail preserved
            other = Exception("connection to https://api.example.com refused")
            self.assertIn("api.example.com", nf.safe_reason(other))

    def test_reason_keeps_publish_error_detail(self):
        # M5: a real PublishError carries "HTTP 500" in the text — the detail
        # is useful and does NOT contain the webhook URL, so it must be kept.
        from app.services.upload_publisher import PublishError

        exc = PublishError("upload API returned HTTP 500: internal error")
        reason = nf.safe_reason(exc)
        self.assertIn("HTTP 500", reason)

    def test_reason_strips_webhook_url_from_custom_message(self):
        # The webhook URL comes from the env — if it shows up in the message
        # (any exception), the reason becomes just the type.
        with patch.dict(os_environ(), {"DISCORD_WEBHOOK_URL": "https://discord/hook"}, clear=True):
            exc = RuntimeError("failed calling https://discord/hook: timeout")
            self.assertEqual(nf.safe_reason(exc), "RuntimeError")

    def test_reason_scrubs_secrets_before_truncation(self):
        # safe_reason feeds Discord AND (via _fail_task) client-visible task
        # errors: the full message must be scrubbed before the 200-cut, like
        # the telemetry reason. The probe is longer than the cap — with a
        # shorter message [:200] is a no-op and a truncate-first revert
        # would stay green.
        from app.services import analytics as analytics_module

        exc = RuntimeError("E" * 150 + " api_key=TOPSECRET123 " + "F" * 150)
        with patch.object(
            nf, "scrub_secret_values", wraps=analytics_module.scrub_secret_values
        ) as scrub:
            reason = nf.safe_reason(exc)
        scrub.assert_called_once_with(str(exc))
        self.assertIn("[redacted]", reason)
        self.assertNotIn("TOPSECRET123", reason)
        self.assertLessEqual(len(reason), 200)

    def test_long_messages_are_truncated_to_discord_limit(self):
        # m2: Discord rejects messages > 2000 chars — the builder truncates.
        message = nf.generation_batch_msg(3, ["t" * 900] * 3)
        self.assertLessEqual(len(message), 2000)
        message = nf.slot_published_msg("p" * 1500, "t" * 1500, ["youtube"])
        self.assertLessEqual(len(message), 2000)
        message = nf.task_failed_msg("task-1", "e" * 1500, "s" * 1500)
        self.assertLessEqual(len(message), 2000)


def os_environ():
    import os

    return os.environ


@contextmanager
def _without_pytest_modules():
    """Temporarily hide pytest from sys.modules (restored on exit).

    Lets a test exercise the real pytest-detection logic as if it ran
    outside a pytest session.
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


class RunningUnderTestTests(unittest.TestCase):
    def test_true_inside_pytest(self):
        self.assertTrue(nf.running_under_test())

    def test_false_outside_pytest(self):
        with patch.dict(os_environ(), {}, clear=True), _without_pytest_modules():
            self.assertNotIn("PYTEST_CURRENT_TEST", os_environ())
            self.assertNotIn("pytest", sys.modules)
            self.assertFalse(nf.running_under_test())

    def test_true_via_engine_under_test_marker(self):
        # The suite bootstrap marker (test/__init__.py) is the authoritative
        # signal — it works under `python -m unittest`, where neither
        # PYTEST_CURRENT_TEST nor pytest is present.
        with patch.dict(os_environ(), {"ENGINE_UNDER_TEST": "1"}, clear=True), \
             _without_pytest_modules():
            self.assertNotIn("PYTEST_CURRENT_TEST", os_environ())
            self.assertNotIn("pytest", sys.modules)
            self.assertTrue(nf.running_under_test())


class MessageBuilderTests(unittest.TestCase):
    def test_scheduler_started_message(self):
        message = nf.scheduler_started_msg()
        self.assertIn("scheduler started", message)

    def test_generation_batch_lists_topics(self):
        message = nf.generation_batch_msg(2, ["Tokyo coffee", "Lisbon trams"])
        self.assertIn("2", message)
        self.assertIn("Tokyo coffee", message)
        self.assertIn("Lisbon trams", message)

    def test_slot_published_includes_persona_topic_providers(self):
        message = nf.slot_published_msg("Ana", "Tokyo coffee", ["youtube", "instagram"])
        self.assertIn("Ana", message)
        self.assertIn("Tokyo coffee", message)
        self.assertIn("youtube", message)
        self.assertIn("instagram", message)

    def test_slot_failed_includes_reason(self):
        message = nf.slot_failed_msg("Ana", "Tokyo coffee", "task has no finished videos")
        self.assertIn("Ana", message)
        self.assertIn("Tokyo coffee", message)
        self.assertIn("task has no finished videos", message)

    def test_slot_failed_handles_empty_topic(self):
        message = nf.slot_failed_msg("Ana", "", "boom")
        self.assertIn("Ana", message)
        self.assertIn("boom", message)

    def test_task_failed_includes_task_id_subject_and_error(self):
        """Failure alert carries the task id, subject and error for triage."""
        message = nf.task_failed_msg("task-42", "ffmpeg crashed", "Lisbon trams")
        self.assertIn("task-42", message)
        self.assertIn("Lisbon trams", message)
        self.assertIn("ffmpeg crashed", message)

    def test_task_failed_handles_empty_subject(self):
        message = nf.task_failed_msg("task-42", "boom")
        self.assertIn("task-42", message)
        self.assertIn("boom", message)
        self.assertNotIn("subject:", message)


if __name__ == "__main__":
    unittest.main()

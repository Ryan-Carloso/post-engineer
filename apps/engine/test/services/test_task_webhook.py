"""Terminal webhook for video tasks.

When a task reaches completed/failed, the engine POSTs a small JSON
payload to the caller's webhook_url (if supplied). Delivery is
fire-and-forget: a failing webhook never changes the task outcome, and
each task notifies at most once.
"""

import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from loguru import logger
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models.schema import TaskVideoRequest
from app.services import task_webhook


class WebhookUrlValidationTests(unittest.TestCase):
    def test_rejects_non_http_url(self):
        with self.assertRaises(ValidationError):
            TaskVideoRequest(video_subject="x", webhook_url="ftp://example.com/hook")

    def test_rejects_bare_string(self):
        with self.assertRaises(ValidationError):
            TaskVideoRequest(video_subject="x", webhook_url="not-a-url")

    def test_accepts_http_and_https(self):
        for url in ("http://example.com/hook", "https://example.com/hook"):
            request = TaskVideoRequest(video_subject="x", webhook_url=url)
            self.assertEqual(request.webhook_url, url)

    def test_webhook_url_defaults_to_none(self):
        self.assertIsNone(TaskVideoRequest(video_subject="x").webhook_url)


class NotifyTerminalTaskTests(unittest.TestCase):
    def setUp(self):
        task_webhook._notified_task_ids.clear()

    def _post_calls(self, mock_post):
        return [call.args[0] for call in mock_post.call_args_list]

    def test_completed_task_posts_payload(self):
        with patch("app.services.task_webhook.requests.post") as mock_post:
            thread = task_webhook.notify_terminal_task(
                "t-1",
                status="completed",
                webhook_url="https://example.com/hook",
                video_url="https://cdn.example.com/v.mp4",
            )
            thread.join(timeout=10)
        mock_post.assert_called_once()
        url, kwargs = mock_post.call_args.args[0], mock_post.call_args.kwargs
        self.assertEqual(url, "https://example.com/hook")
        payload = kwargs["json"]
        self.assertEqual(payload["task_id"], "t-1")
        self.assertEqual(payload["status"], "completed")
        self.assertEqual(payload["progress"], 100)
        self.assertEqual(payload["video_url"], "https://cdn.example.com/v.mp4")
        self.assertNotIn("error", payload)

    def test_failed_task_posts_error(self):
        with patch("app.services.task_webhook.requests.post") as mock_post:
            thread = task_webhook.notify_terminal_task(
                "t-2",
                status="failed",
                webhook_url="https://example.com/hook",
                error="boom",
            )
            thread.join(timeout=10)
        mock_post.assert_called_once()
        payload = mock_post.call_args.kwargs["json"]
        self.assertEqual(payload["status"], "failed")
        self.assertEqual(payload["error"], "boom")
        self.assertIsNone(payload["video_url"])

    def test_no_webhook_url_sends_nothing(self):
        with patch("app.services.task_webhook.requests.post") as mock_post:
            task_webhook.notify_terminal_task("t-3", status="completed", webhook_url=None)
        mock_post.assert_not_called()

    def test_terminal_notification_sent_once_per_task(self):
        with patch("app.services.task_webhook.requests.post") as mock_post:
            thread = task_webhook.notify_terminal_task(
                "t-4", status="failed", webhook_url="https://example.com/hook", error="x"
            )
            thread.join(timeout=10)
            duplicate = task_webhook.notify_terminal_task(
                "t-4", status="failed", webhook_url="https://example.com/hook", error="y"
            )
            self.assertIsNone(duplicate)
        mock_post.assert_called_once()

    def test_webhook_failure_only_logs(self):
        records = []
        handler_id = logger.add(lambda message: records.append(message.record))
        try:
            with patch(
                "app.services.task_webhook.requests.post",
                side_effect=RuntimeError("network down"),
            ):
                # Must not raise: webhook delivery never affects the task.
                thread = task_webhook.notify_terminal_task(
                    "t-5", status="completed", webhook_url="https://example.com/hook"
                )
                thread.join(timeout=10)
        finally:
            logger.remove(handler_id)
        self.assertTrue(
            any(r["level"].name == "ERROR" for r in records),
            "webhook delivery failure must log at ERROR (Bugsink)",
        )


class FailTaskWebhookTests(unittest.TestCase):
    def setUp(self):
        task_webhook._notified_task_ids.clear()

    def test_fail_task_triggers_failed_webhook(self):
        from app.services import task as task_service

        params = TaskVideoRequest(
            video_subject="x", webhook_url="https://example.com/hook"
        )
        with (
            patch("app.services.task_webhook.requests.post") as mock_post,
            patch.object(task_service, "send_discord", return_value=True),
        ):
            task_service._fail_task("wt-1", "boom", params, stage="audio")
            # The webhook POST runs on a worker thread: wait for it.
            deadline = time.time() + 10
            while mock_post.call_count == 0 and time.time() < deadline:
                time.sleep(0.05)
        mock_post.assert_called_once()
        payload = mock_post.call_args.kwargs["json"]
        self.assertEqual(payload["task_id"], "wt-1")
        self.assertEqual(payload["status"], "failed")
        self.assertEqual(payload["error"], "boom")

    def test_fail_task_without_webhook_url_posts_nothing(self):
        from app.services import task as task_service

        params = TaskVideoRequest(video_subject="x")
        with (
            patch("app.services.task_webhook.requests.post") as mock_post,
            patch.object(task_service, "send_discord", return_value=True),
        ):
            task_service._fail_task("wt-2", "boom", params, stage="audio")
        mock_post.assert_not_called()

    def test_start_completion_triggers_completed_webhook(self):
        from app.services import task as task_service

        params = TaskVideoRequest(
            video_subject="x", webhook_url="https://example.com/hook"
        )
        task_id = "wc-1"
        task_service.sm.state.update_task(task_id, user_id="u-1")
        with (
            patch("app.services.task_webhook.requests.post") as mock_post,
            patch.object(task_service, "generate_script", return_value="ok script"),
            patch.object(task_service, "send_discord", return_value=True),
            patch.object(task_service, "cleanup_task_intermediates"),
            patch.object(task_service, "save_script_data"),
        ):
            task_service.start(task_id, params, stop_at="script")
            deadline = time.time() + 10
            while mock_post.call_count == 0 and time.time() < deadline:
                time.sleep(0.05)
        mock_post.assert_called_once()
        payload = mock_post.call_args.kwargs["json"]
        self.assertEqual(payload["task_id"], "wc-1")
        self.assertEqual(payload["status"], "completed")

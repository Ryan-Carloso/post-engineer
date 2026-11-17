"""Terminal webhook for video tasks.

When a task reaches completed/failed, the engine POSTs a small JSON
payload to the caller's webhook_url (if supplied). Delivery is
fire-and-forget: a failing webhook never changes the task outcome, and
each task notifies at most once.
"""

import ipaddress
import socket
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.parse import quote, urlparse

import requests
from requests.utils import requote_uri
from loguru import logger
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models.schema import TaskVideoRequest
from app.services import task_webhook


class WebhookUrlValidationTests(unittest.TestCase):
    def test_rejects_non_http_url(self):
        with self.assertRaises(ValidationError):
            TaskVideoRequest(
                video_title="x",
                video_description="Test description.",
                video_type="faceless",
                webhook_url="ftp://example.com/hook",
            )

    def test_rejects_bare_string(self):
        with self.assertRaises(ValidationError):
            TaskVideoRequest(
                video_title="x",
                video_description="Test description.",
                video_type="faceless",
                webhook_url="not-a-url",
            )

    def test_rejects_http_and_accepts_https_without_dns(self):
        # Schema validation is shape-only: it never resolves the host, so a
        # DNS outage at request time cannot reject a valid webhook. The
        # resolver is armed to explode; validation must not reach it.
        with patch(
            "app.utils.ssrf.socket.getaddrinfo",
            side_effect=OSError("dns down"),
        ):
            with self.assertRaises(ValidationError) as caught:
                TaskVideoRequest(
                    video_title="x",
                    video_description="Test description.",
                    video_type="faceless",
                    webhook_url="http://example.com/hook",
                )
            self.assertIn("https", str(caught.exception))
            request = TaskVideoRequest(
                video_title="x",
                video_description="Test description.",
                video_type="faceless",
                webhook_url="https://example.com/hook",
            )
            self.assertEqual(request.webhook_url, "https://example.com/hook")

    def test_unresolvable_host_still_validates(self):
        # A webhook whose host does not resolve still validates: resolution
        # happens on the delivery path, where a failed delivery must not
        # fail the task.
        with patch(
            "app.utils.ssrf.socket.getaddrinfo",
            side_effect=OSError("dns down"),
        ):
            request = TaskVideoRequest(
                video_title="x",
                video_description="Test description.",
                video_type="faceless",
                webhook_url="https://nonexistent.invalid/hook",
            )
            self.assertEqual(request.webhook_url, "https://nonexistent.invalid/hook")

    def test_rejects_localhost_and_private_literals_without_dns(self):
        with patch(
            "app.utils.ssrf.socket.getaddrinfo",
            side_effect=OSError("dns down"),
        ):
            for webhook_url in (
                "https://localhost/hook",
                "https://127.0.0.1/hook",
                "https://10.0.0.5/hook",
                "https://[::1]/hook",
            ):
                with self.subTest(webhook_url=webhook_url):
                    with self.assertRaises(ValidationError):
                        TaskVideoRequest(
                            video_title="x",
                            video_description="Test description.",
                            video_type="faceless",
                            webhook_url=webhook_url,
                        )

    def test_webhook_url_defaults_to_none(self):
        self.assertIsNone(
            TaskVideoRequest(
                video_title="x", video_description="Test description.", video_type="faceless"
            ).webhook_url
        )


class NotifyTerminalTaskTests(unittest.TestCase):
    def setUp(self):
        task_webhook._notified_task_ids.clear()

    def _post_calls(self, mock_post):
        return [call.args[0] for call in mock_post.call_args_list]

    def test_completed_task_posts_payload(self):
        with patch("app.services.task_webhook.ssrf.post_public_url") as mock_post:
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
        with patch("app.services.task_webhook.ssrf.post_public_url") as mock_post:
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
        with patch("app.services.task_webhook.ssrf.post_public_url") as mock_post:
            task_webhook.notify_terminal_task("t-3", status="completed", webhook_url=None)
        mock_post.assert_not_called()

    def test_terminal_notification_sent_once_per_task(self):
        with patch("app.services.task_webhook.ssrf.post_public_url") as mock_post:
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
                "app.services.task_webhook.ssrf.post_public_url",
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
            "webhook delivery failure must log at ERROR (PostHog)",
        )

    def test_webhook_failure_log_redacts_path_token(self):
        # requests embeds the target URL in str(exc); Discord/Slack-style
        # path-embedded tokens do not match the key-anchored scrubber, so
        # the known webhook URL is redacted before scrub-then-truncate.
        webhook_url = "https://discord.com/api/webhooks/123456789/abcdefGHIJKL-token-secret"
        response = MagicMock()
        response.raise_for_status.side_effect = requests.exceptions.HTTPError(
            f"500 Server Error: Internal Server Error for url: {webhook_url}"
        )
        with (
            patch("app.services.task_webhook.ssrf.post_public_url", return_value=response),
            patch("app.services.task_webhook.logger") as mock_logger,
        ):
            task_webhook._post(webhook_url, {"task_id": "t-1"}, "t-1")
        # logger.bind(task_id=...) returns a child mock; the error call
        # lands on it, not on the module logger mock itself.
        error_mock = mock_logger.bind.return_value.error
        self.assertTrue(error_mock.call_args_list)
        logged = " ".join(str(c) for c in error_mock.call_args_list)
        self.assertNotIn("abcdefGHIJKL-token-secret", logged)
        self.assertNotIn(webhook_url, logged)

    def test_webhook_failure_log_redacts_encoded_url_variant(self):
        # requests requotes the target URL when preparing it (response.url),
        # so the exception may carry the percent-encoded form instead of
        # the configured string — both variants must be redacted.
        webhook_url = "https://example.com/hooks/path with space/secret-token"
        encoded = quote(webhook_url, safe=":/?&=%")
        response = MagicMock()
        response.raise_for_status.side_effect = requests.exceptions.HTTPError(
            f"500 Server Error: Internal Server Error for url: {encoded}"
        )
        with (
            patch("app.services.task_webhook.ssrf.post_public_url", return_value=response),
            patch("app.services.task_webhook.logger") as mock_logger,
        ):
            task_webhook._post(webhook_url, {"task_id": "t-1"}, "t-1")
        error_mock = mock_logger.bind.return_value.error
        self.assertTrue(error_mock.call_args_list)
        logged = " ".join(str(c) for c in error_mock.call_args_list)
        self.assertNotIn("secret-token", logged)
        self.assertNotIn(encoded, logged)

    def test_webhook_failure_log_redacts_path_only_connection_error(self):
        # Connection-phase errors (DNS/refused/TLS/timeout) embed only the
        # path fragment — as requoted by requests — not the full URL. The
        # path-embedded token must still be redacted before the log reaches
        # PostHog.
        webhook_url = "https://example.com/hooks/path with space/secret-token"
        raw_path = urlparse(webhook_url).path
        encoded_path = requote_uri(raw_path)
        with (
            patch(
                "app.services.task_webhook.ssrf.post_public_url",
                side_effect=requests.exceptions.ConnectionError(
                    "HTTPConnectionPool(host='example.com', port=443): "
                    f"Max retries exceeded with url: {encoded_path} "
                    "(Caused by NewConnectionError('refused'))"
                ),
            ),
            patch("app.services.task_webhook.logger") as mock_logger,
        ):
            task_webhook._post(webhook_url, {"task_id": "t-1"}, "t-1")
        error_mock = mock_logger.bind.return_value.error
        self.assertTrue(error_mock.call_args_list)
        logged = " ".join(str(c) for c in error_mock.call_args_list)
        self.assertNotIn("secret-token", logged)
        self.assertNotIn(raw_path, logged)
        self.assertNotIn(encoded_path, logged)

    def test_webhook_failure_log_redacts_query_string_variant(self):
        # urllib3 connection-phase errors embed the full request target
        # (/path?query=...) — a credential in the query string must be
        # redacted even though the path-only variant does not cover it.
        # The param name/value are chosen so the key-anchored scrubber
        # cannot catch them: only the variant redaction can.
        webhook_url = "https://example.com/hooks/path?sig=abc123xyz"
        target = "/hooks/path?sig=abc123xyz"
        with (
            patch(
                "app.services.task_webhook.ssrf.post_public_url",
                side_effect=requests.exceptions.ConnectionError(
                    "HTTPConnectionPool(host='example.com', port=443): "
                    f"Max retries exceeded with url: {target} "
                    "(Caused by NewConnectionError('refused'))"
                ),
            ),
            patch("app.services.task_webhook.logger") as mock_logger,
        ):
            task_webhook._post(webhook_url, {"task_id": "t-1"}, "t-1")
        error_mock = mock_logger.bind.return_value.error
        self.assertTrue(error_mock.call_args_list)
        logged = " ".join(str(c) for c in error_mock.call_args_list)
        self.assertNotIn("abc123xyz", logged)
        self.assertNotIn(target, logged)

    def test_webhook_failure_empty_url_does_not_interleave_redacted(self):
        # str.replace("", "[redacted]") interleaves the marker between
        # every character — the emptiness guard keeps the log readable.
        with (
            patch(
                "app.services.task_webhook.ssrf.post_public_url",
                side_effect=requests.exceptions.HTTPError("boom"),
            ),
            patch("app.services.task_webhook.logger") as mock_logger,
        ):
            task_webhook._post("", {"task_id": "t-1"}, "t-1")
        error_mock = mock_logger.bind.return_value.error
        kwargs = error_mock.call_args_list[0].kwargs
        self.assertEqual(kwargs["error"], "boom")


class FailTaskWebhookTests(unittest.TestCase):
    def setUp(self):
        task_webhook._notified_task_ids.clear()

    def test_fail_task_triggers_failed_webhook(self):
        from app.services import task as task_service

        with (
            patch(
                "app.utils.ssrf._resolve_global_ips",
                return_value=[ipaddress.ip_address("93.184.215.14")],
            ),
            patch("app.services.task_webhook.ssrf.post_public_url") as mock_post,
            patch.object(task_service, "send_discord", return_value=True),
        ):
            params = TaskVideoRequest(
                video_title="x",
                video_description="Test description.",
                video_type="faceless",
                webhook_url="https://example.com/hook",
            )
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

        params = TaskVideoRequest(
            video_title="x", video_description="Test description.", video_type="faceless"
        )
        with (
            patch("app.services.task_webhook.ssrf.post_public_url") as mock_post,
            patch.object(task_service, "send_discord", return_value=True),
        ):
            task_service._fail_task("wt-2", "boom", params, stage="audio")
        mock_post.assert_not_called()

    def test_start_completion_triggers_completed_webhook(self):
        from app.services import task as task_service

        task_id = "wc-1"
        task_service.sm.state.update_task(task_id, user_id="u-1")
        with (
            patch(
                "app.utils.ssrf._resolve_global_ips",
                return_value=[ipaddress.ip_address("93.184.215.14")],
            ),
            patch("app.services.task_webhook.ssrf.post_public_url") as mock_post,
            patch.object(task_service, "generate_script", return_value="ok script"),
            patch.object(task_service, "send_discord", return_value=True),
            patch.object(task_service, "cleanup_task_intermediates"),
            patch.object(task_service, "save_script_data"),
        ):
            params = TaskVideoRequest(
                video_title="x",
                video_description="Test description.",
                video_type="faceless",
                webhook_url="https://example.com/hook",
            )
            task_service.start(task_id, params, stop_at="script")
            deadline = time.time() + 10
            while mock_post.call_count == 0 and time.time() < deadline:
                time.sleep(0.05)
        mock_post.assert_called_once()
        payload = mock_post.call_args.kwargs["json"]
        self.assertEqual(payload["task_id"], "wc-1")
        self.assertEqual(payload["status"], "completed")


def _read_http_request(sock):
    sock.settimeout(2)
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = sock.recv(4096)
        if not chunk:
            return data
        data += chunk
    head, sep, rest = data.partition(b"\r\n\r\n")
    if not sep:
        return data
    length = 0
    for line in head.split(b"\r\n")[1:]:
        if line.lower().startswith(b"content-length:"):
            length = int(line.split(b":", 1)[1].strip() or b"0")
    while len(rest) < length:
        chunk = sock.recv(4096)
        if not chunk:
            break
        rest += chunk
    return head + sep + rest[:length]


def _scripted_socket(response, seen):
    client, server = socket.socketpair()

    def run():
        try:
            server.settimeout(2)
            while True:
                request = _read_http_request(server)
                if not request:
                    break
                seen.append(request)
                server.sendall(response)
        except OSError:
            pass
        finally:
            server.close()

    threading.Thread(target=run, daemon=True).start()
    return client


class PinnedWebhookTests(unittest.TestCase):
    """Create-time and delivery-time guards. A private target is never dialed."""

    def _request(self, webhook_url):
        return TaskVideoRequest(
            video_title="x",
            video_description="Test description.",
            video_type="faceless",
            webhook_url=webhook_url,
        )

    def test_request_rejects_private_literals(self):
        for url in (
            "http://127.0.0.1/hook",
            "https://127.0.0.1/hook",
            "http://10.0.0.5/hook",
            "http://169.254.169.254/latest/meta-data/",
            "https://[::1]/hook",
        ):
            with self.assertRaises(ValidationError):
                self._request(url)

    def test_request_accepts_a_name_that_would_resolve_private(self):
        # Shape-only validation: the request accepts any hostname and never
        # resolves it. Whether the name resolves private is judged on the
        # delivery path instead (see test_post_never_dials_a_private_target),
        # where the failed delivery must not fail the task.
        with patch(
            "app.utils.ssrf.socket.getaddrinfo",
            side_effect=OSError("dns down"),
        ):
            request = self._request("https://rebind.test/hook")
            self.assertEqual(request.webhook_url, "https://rebind.test/hook")

    def test_post_never_dials_a_private_target(self):
        dials = []

        def create_connection(address, timeout=None, *args, **kwargs):
            dials.append(address)
            raise OSError("should not dial")

        def connect(self, address):
            dials.append(address)
            raise OSError("should not dial")

        literals = (
            "https://127.0.0.1/hook",
            "https://10.0.0.5/hook",
            "https://169.254.169.254/latest/meta-data/",
        )
        public = [ipaddress.ip_address("93.184.215.14")]
        private = [ipaddress.ip_address("10.0.0.5")]
        with (
            patch("app.utils.ssrf.socket.create_connection", side_effect=create_connection),
            patch("socket.socket.connect", connect),
        ):
            for url in literals:
                task_webhook._post(url, {"task_id": "t-priv"}, "t-priv")
            # A public answer must still not be dialed: the scheme is http.
            with patch("app.utils.ssrf._resolve_global_ips", return_value=public):
                task_webhook._post(
                    "http://example.com/hook", {"task_id": "t-http"}, "t-http"
                )
            with patch("app.utils.ssrf._resolve_global_ips", return_value=private):
                task_webhook._post(
                    "https://rebind.test/hook", {"task_id": "t-dns"}, "t-dns"
                )
        self.assertEqual(dials, [])

    def test_a_redirect_to_loopback_is_not_followed(self):
        lookups = []
        dials = []
        seen = []

        def resolve(_host):
            lookups.append(_host)
            if len(lookups) == 1:
                return [ipaddress.ip_address("93.184.215.14")]
            return [ipaddress.ip_address("127.0.0.1")]

        def create_connection(address, timeout=None, *args, **kwargs):
            dials.append(address)
            response = (
                b"HTTP/1.1 307 Temporary Redirect\r\n"
                b"Location: http://127.0.0.1/secret\r\n"
                b"Content-Length: 0\r\n"
                b"Connection: close\r\n"
                b"\r\n"
            )
            return _scripted_socket(response, seen)

        def wrap(sock, *args, **kwargs):
            # Speak HTTP on the pinned socket. The production path still
            # asks for TLS, and SNI is covered by the ssrf unit test.
            wrapped = type("Wrapped", (), {})()
            wrapped.socket = sock
            wrapped.is_verified = True
            return wrapped

        with (
            patch("app.utils.ssrf._resolve_global_ips", side_effect=resolve),
            patch("app.utils.ssrf.socket.create_connection", side_effect=create_connection),
            patch("urllib3.connection._ssl_wrap_socket_and_match_hostname", side_effect=wrap),
            patch("app.services.task_webhook.logger") as mock_logger,
        ):
            task_webhook._post(
                "https://rebind.test/hook", {"task_id": "t-307"}, "t-307"
            )
        self.assertEqual(dials, [("93.184.215.14", 443)])
        self.assertEqual(len(seen), 1)
        self.assertIn(b"Host: rebind.test", seen[0])
        self.assertNotIn(b"127.0.0.1", seen[0])
        logged = " ".join(str(call) for call in mock_logger.bind.return_value.error.call_args_list)
        self.assertIn("307", logged)

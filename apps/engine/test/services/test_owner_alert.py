"""Owner failure email: dedup, no network under the test suite, Discord unchanged."""

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.owner_alert import (
    alert_failed_task,
    direct_task_email_user,
    notify_generation_failed,
    send_owner_email,
)


class _Response:
    def __init__(self, status, payload):
        self.status_code = status
        self._payload = payload

    def json(self):
        return self._payload


class _Session:
    def __init__(self, claim=True, resend_status=200, email="owner@example.com", user_status=200):
        self.calls = []
        self.claim = claim
        self.resend_status = resend_status
        self.email = email
        self.user_status = user_status

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        if url.endswith("/claim_owner_alert"):
            return _Response(200, self.claim)
        if "/auth/v1/admin/users/" in url:
            if self.user_status >= 400:
                return _Response(self.user_status, {})
            return _Response(200, {"email": self.email})
        if url == "https://api.resend.com/emails":
            return _Response(self.resend_status, {"id": "email_1"})
        if url.endswith("/release_owner_alert"):
            return _Response(204, None)
        raise AssertionError(url)


ENV = {
    "RESEND_API_KEY": "re_test_key",
    "ACCOUNT_BREAK_FROM": '"Post Engineer <alerts@notifications.post-engineer.com>"',
    "SUPABASE_URL": "https://example.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "service-role-test",
    "MPT_UPLOAD_API_BASE_URL": "https://post-engineer.com",
}


class DirectTaskEmailUserTests(unittest.TestCase):
    def test_skips_a_slot_and_the_unknown_sentinel(self):
        self.assertIsNone(direct_task_email_user({"slot_id": "slot-1", "user_id": "user-1"}))
        self.assertIsNone(direct_task_email_user({"user_id": "unknown"}))
        self.assertIsNone(direct_task_email_user({"user_id": "  "}))
        self.assertIsNone(direct_task_email_user(None))
        self.assertEqual(direct_task_email_user({"user_id": "user-1"}), "user-1")


class SendOwnerEmailTests(unittest.TestCase):
    def test_under_test_without_a_session_does_not_open_a_client(self):
        with patch("requests.Session", side_effect=AssertionError("opened")):
            send_owner_email(
                user_id="user-1",
                dedup_key="generate:slot-1",
                subject="A post could not be generated",
                html_body="<p>x</p>",
                text="x",
            )

    def test_missing_key_does_not_call_http(self):
        session = _Session()
        with patch.dict(os.environ, {"RESEND_API_KEY": "", "ACCOUNT_BREAK_FROM": ""}, clear=False):
            send_owner_email(
                user_id="user-1",
                dedup_key="generate:slot-1",
                subject="A post could not be generated",
                html_body="<p>x</p>",
                text="x",
                session=session,
            )
        self.assertEqual(session.calls, [])

    def test_claim_false_does_not_post_resend(self):
        session = _Session(claim=False)
        with patch.dict(os.environ, ENV, clear=False):
            send_owner_email(
                user_id="user-1",
                dedup_key="generate:slot-1",
                subject="A post could not be generated",
                html_body="<p>x</p>",
                text="x",
                session=session,
            )
        self.assertEqual(len(session.calls), 1)
        self.assertTrue(session.calls[0][1].endswith("/claim_owner_alert"))

    def test_claim_true_sends_and_does_not_release(self):
        session = _Session()
        with patch.dict(os.environ, ENV, clear=False):
            notify_generation_failed(
                "user-1",
                slot_id="slot-1",
                title="Hello <title>",
                reason="boom",
                session=session,
            )
        urls = [url for _method, url, _kwargs in session.calls]
        self.assertTrue(any(url.endswith("/claim_owner_alert") for url in urls))
        self.assertTrue(any(url == "https://api.resend.com/emails" for url in urls))
        self.assertFalse(any(url.endswith("/release_owner_alert") for url in urls))
        resend = next(kwargs for _method, url, kwargs in session.calls if url == "https://api.resend.com/emails")
        body = resend["json"]
        self.assertEqual(body["from"], "Post Engineer <alerts@notifications.post-engineer.com>")
        self.assertEqual(body["subject"], "A post could not be generated")
        self.assertIn("Hello &lt;title&gt;", body["html"])
        self.assertIn("https://post-engineer.com/posts/slot-1", body["html"])
        self.assertNotIn("boom token", body["html"])
        headers = resend["headers"]
        self.assertEqual(headers["User-Agent"], "post-engineer/owner-alert")
        self.assertTrue(headers["Authorization"].startswith("Bearer "))

    def test_resend_error_releases_the_claim(self):
        session = _Session(resend_status=500)
        with patch.dict(os.environ, ENV, clear=False):
            send_owner_email(
                user_id="user-1",
                dedup_key="publish:slot-1",
                subject="A post could not be published",
                html_body="<p>x</p>",
                text="x",
                session=session,
            )
        urls = [url for _method, url, _kwargs in session.calls]
        self.assertTrue(any(url == "https://api.resend.com/emails" for url in urls))
        self.assertTrue(any(url.endswith("/release_owner_alert") for url in urls))

    def test_sender_swallows_a_raising_session(self):
        class Boom:
            def request(self, *args, **kwargs):
                raise RuntimeError("boom")

        with patch.dict(os.environ, ENV, clear=False):
            send_owner_email(
                user_id="user-1",
                dedup_key="generate:slot-1",
                subject="A post could not be generated",
                html_body="<p>x</p>",
                text="x",
                session=Boom(),
            )


class AlertFailedTaskTests(unittest.TestCase):
    def test_releases_the_discord_reservation_when_send_fails(self):
        should = MagicMock(return_value=True)
        release = MagicMock()
        send = MagicMock(return_value=False)
        message = MagicMock(return_value="msg")
        alert_failed_task("task-1", "boom", None, should, release, send, message)
        send.assert_called_once()
        release.assert_called_once_with("task-1")

    def test_keeps_the_reservation_when_discord_sends(self):
        should = MagicMock(return_value=True)
        release = MagicMock()
        send = MagicMock(return_value=True)
        message = MagicMock(return_value="msg")
        params = MagicMock()
        params.video_title = "Title"
        alert_failed_task("task-1", "boom", params, should, release, send, message)
        message.assert_called_once_with("task-1", "boom", "Title")
        release.assert_not_called()

    def test_skips_discord_when_the_alert_was_already_sent(self):
        should = MagicMock(return_value=False)
        send = MagicMock()
        alert_failed_task("task-1", "boom", None, should, MagicMock(), send, MagicMock())
        send.assert_not_called()


if __name__ == "__main__":
    unittest.main()

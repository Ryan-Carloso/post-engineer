"""Owner failure email: dedup, no network under the test suite, Discord unchanged."""

import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.owner_alert import (
    _claim,
    _failure_lines,
    _owner_email,
    _post_link,
    _release,
    _render,
    alert_failed_task,
    direct_task_email_user,
    notify_generation_failed,
    notify_publish_failed,
    notify_publish_partial,
    send_owner_email,
)


class _Response:
    def __init__(self, status, payload):
        self.status_code = status
        self._payload = payload

    def json(self):
        return self._payload


class _Session:
    def __init__(
        self, claim=True, resend_status=200, email="owner@example.com", user_status=200,
        accounts=None, schedules=None, claim_status=200, release_status=204,
        user_payload=None, resend_raises=False, release_raises=False,
    ):
        self.calls = []
        self.claim = claim
        self.resend_status = resend_status
        self.email = email
        self.user_status = user_status
        self.accounts = accounts if accounts is not None else []
        self.schedules = schedules if schedules is not None else []
        self.claim_status = claim_status
        self.release_status = release_status
        self.user_payload = user_payload
        self.resend_raises = resend_raises
        self.release_raises = release_raises

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        if url.endswith("/claim_owner_alert"):
            return _Response(self.claim_status, self.claim)
        if "/auth/v1/admin/users/" in url:
            if self.user_status >= 400:
                return _Response(self.user_status, {})
            if self.user_payload is not None:
                return _Response(200, self.user_payload)
            return _Response(200, {"email": self.email})
        if url == "https://api.resend.com/emails":
            if self.resend_raises:
                raise RuntimeError("resend boom")
            return _Response(self.resend_status, {"id": "email_1"})
        if url.endswith("/release_owner_alert"):
            if self.release_raises:
                raise RuntimeError("release boom")
            return _Response(self.release_status, None)
        if "/rest/v1/social_accounts" in url:
            return _Response(200, self.accounts)
        if "/rest/v1/schedules" in url:
            return _Response(200, self.schedules)
        raise AssertionError(url)

    def close(self):
        self.calls.append(("close", "", {}))


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
        self.assertIsNone(direct_task_email_user({"user_id": 123}))
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


class PublishFailureEmailTests(unittest.TestCase):
    def _resend_body(self, session):
        resend = next(
            kwargs
            for _method, url, kwargs in session.calls
            if url == "https://api.resend.com/emails"
        )
        return resend["json"]

    def test_publish_failed_names_the_persona_and_each_failed_account(self):
        session = _Session(
            accounts=[
                {"provider": "youtube", "provider_account_id": "UC1", "account_name": "Canal X"},
            ]
        )
        with patch.dict(os.environ, ENV, clear=False):
            notify_publish_failed(
                "user-1",
                slot_id="slot-1",
                title="Hello",
                reason="boom",
                persona="Bicuda",
                failures=[
                    {"provider": "youtube", "account_id": "UC1", "reason": "unauthorized"},
                    {"provider": "bluesky", "account_id": "did:plc:9", "reason": ""},
                ],
                session=session,
            )
        body = self._resend_body(session)
        self.assertIn("Persona: Bicuda", body["html"])
        self.assertIn("YouTube — Canal X — unauthorized", body["html"])
        self.assertIn("Bluesky — did:plc:9", body["html"])
        self.assertIn("YouTube — Canal X — unauthorized", body["text"])
        self.assertNotIn("did:plc:9 — ", body["html"])

    def test_publish_failed_without_failures_sends_no_account_lines(self):
        session = _Session()
        with patch.dict(os.environ, ENV, clear=False):
            notify_publish_failed(
                "user-1",
                slot_id="slot-1",
                title="Hello",
                reason="boom",
                session=session,
            )
        body = self._resend_body(session)
        self.assertNotIn("Persona:", body["html"])
        self.assertIn("What happened: boom", body["html"])

    def test_partial_lists_each_failed_account(self):
        session = _Session(
            accounts=[
                {"provider": "rumble", "provider_account_id": "ch1", "account_name": "Rumble 1"},
            ]
        )
        with patch.dict(os.environ, ENV, clear=False):
            notify_publish_partial(
                "user-1",
                slot_id="slot-1",
                title="Hello",
                failures=[
                    {"provider": "rumble", "account_id": "ch1", "reason": "invalid_token"},
                    {"provider": "fanvue", "account_id": "fv1", "reason": "gone"},
                ],
                persona="Bicuda",
                session=session,
            )
        body = self._resend_body(session)
        self.assertEqual(body["subject"], "A post did not reach every account")
        self.assertIn("Persona: Bicuda", body["html"])
        self.assertIn("Rumble — Rumble 1 — invalid_token", body["html"])
        self.assertIn("Fanvue — fv1 — gone", body["html"])

    def test_partial_with_no_failures_sends_nothing(self):
        session = _Session()
        with patch.dict(os.environ, ENV, clear=False):
            notify_publish_partial(
                "user-1", slot_id="slot-1", title="Hello", failures=[], session=session
            )
        self.assertEqual(session.calls, [])

    def test_generation_failed_resolves_the_persona_from_the_schedule(self):
        session = _Session(schedules=[{"personas": {"name": "Bicuda"}}])
        with patch.dict(os.environ, ENV, clear=False):
            notify_generation_failed(
                "user-1",
                slot_id="slot-1",
                title="Hello",
                reason="boom",
                schedule_id="schedule-1",
                session=session,
            )
        body = self._resend_body(session)
        self.assertIn("Persona: Bicuda", body["html"])

    def test_generation_failed_prefers_the_given_persona_over_the_lookup(self):
        session = _Session(schedules=[{"personas": {"name": "Other"}}])
        with patch.dict(os.environ, ENV, clear=False):
            notify_generation_failed(
                "user-1",
                slot_id="slot-1",
                title="Hello",
                reason="boom",
                persona="Direct",
                schedule_id="schedule-1",
                session=session,
            )
        body = self._resend_body(session)
        self.assertIn("Persona: Direct", body["html"])
        self.assertFalse(
            any("/rest/v1/schedules" in url for _m, url, _k in session.calls)
        )

    def test_failure_lines_skip_junk_and_fall_back_to_the_label(self):
        lines = _failure_lines(
            [
                "not-a-dict",
                {"provider": 42, "account_id": 7, "reason": 99},
                {"provider": "tiktok", "account_id": "", "reason": "nope"},
            ],
            {},
        )
        self.assertEqual(lines, ["Unknown — Unknown", "tiktok — tiktok — nope"])


class DeliverHelpersTests(unittest.TestCase):
    def test_render_skips_an_empty_bit(self):
        html, text = _render("Subject", ["", "Hello"], [])
        self.assertIn("Hello", html)
        self.assertNotIn("<p></p>", html)
        self.assertEqual(text.splitlines()[2], "Hello")

    def test_post_link_without_a_slot_id_points_at_posts(self):
        self.assertEqual(_post_link(None), "https://post-engineer.com/posts")

    def test_claim_false_on_a_non_200_status(self):
        session = _Session(claim_status=500)
        self.assertFalse(
            _claim(session, "https://example.supabase.co", {"apikey": "x"}, "user-1", "k")
        )

    def test_release_warns_on_a_non_204_status(self):
        session = _Session(release_status=500)
        _release(session, "https://example.supabase.co", {"apikey": "x"}, "user-1", "k")
        self.assertEqual(len(session.calls), 1)

    def test_owner_email_empty_when_the_owner_lookup_fails(self):
        session = _Session(user_status=500)
        self.assertEqual(
            _owner_email(session, "https://example.supabase.co", {"apikey": "x"}, "user-1"),
            "",
        )

    def test_owner_email_empty_for_a_payload_without_a_user(self):
        for payload in ({"user": None}, {"user": {"email": None}}, "nope"):
            session = _Session(user_payload=payload)
            self.assertEqual(
                _owner_email(session, "https://example.supabase.co", {"apikey": "x"}, "user-1"),
                "",
            )

    def test_owner_email_reads_the_nested_user(self):
        session = _Session(user_payload={"user": {"email": " nested@example.com "}})
        self.assertEqual(
            _owner_email(session, "https://example.supabase.co", {"apikey": "x"}, "user-1"),
            "nested@example.com",
        )

    def test_deliver_opens_its_own_session_outside_the_test_suite(self):
        session = _Session()
        with (
            patch("app.services.owner_alert.running_under_test", return_value=False),
            patch("requests.Session", return_value=session),
            patch.dict(os.environ, ENV, clear=False),
        ):
            send_owner_email(
                user_id="user-1",
                dedup_key="generate:slot-1",
                subject="A post could not be generated",
                html_body="<p>x</p>",
                text="x",
            )
        urls = [url for _method, url, _kwargs in session.calls]
        self.assertIn("https://api.resend.com/emails", urls)
        self.assertIn(("close", "", {}), session.calls)

    def test_deliver_releases_the_claim_when_the_send_throws(self):
        session = _Session(resend_raises=True)
        with (
            patch("app.services.owner_alert.running_under_test", return_value=False),
            patch("requests.Session", return_value=session),
            patch.dict(os.environ, ENV, clear=False),
        ):
            send_owner_email(
                user_id="user-1",
                dedup_key="generate:slot-1",
                subject="A post could not be generated",
                html_body="<p>x</p>",
                text="x",
            )
        urls = [url for _method, url, _kwargs in session.calls]
        self.assertTrue(any(url.endswith("/release_owner_alert") for url in urls))

    def test_deliver_still_returns_when_the_release_throws(self):
        session = _Session(resend_raises=True, release_raises=True)
        with (
            patch("app.services.owner_alert.running_under_test", return_value=False),
            patch("requests.Session", return_value=session),
            patch.dict(os.environ, ENV, clear=False),
        ):
            send_owner_email(
                user_id="user-1",
                dedup_key="generate:slot-1",
                subject="A post could not be generated",
                html_body="<p>x</p>",
                text="x",
            )

    def test_deliver_skips_when_supabase_is_not_configured(self):
        session = _Session()
        with patch.dict(
            os.environ,
            {**ENV, "SUPABASE_URL": "", "SUPABASE_SERVICE_ROLE_KEY": ""},
            clear=False,
        ):
            send_owner_email(
                user_id="user-1",
                dedup_key="generate:slot-1",
                subject="A post could not be generated",
                html_body="<p>x</p>",
                text="x",
                session=session,
            )
        self.assertEqual(session.calls, [])

    def test_notify_early_returns_send_nothing(self):
        session = _Session()
        with patch.dict(os.environ, ENV, clear=False):
            notify_generation_failed(None, slot_id="slot-1", title="x", reason="y", session=session)
            notify_publish_failed(None, slot_id="slot-1", title="x", reason="y", session=session)
            notify_publish_partial("user-1", slot_id="slot-1", title="x", failures=None, session=session)
            notify_publish_partial("", slot_id="slot-1", title="x", failures=[{"provider": "youtube", "account_id": "UC1", "reason": "boom"}], session=session)
        self.assertEqual(session.calls, [])


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


class EmailDirectGenerationFailureTests(unittest.TestCase):
    def _call(self, task, params):
        should = MagicMock(return_value=False)
        with (
            patch("app.services.owner_alert.running_under_test", return_value=False),
            patch("app.services.state.state.get_task", return_value=task),
            patch("app.services.owner_alert.notify_generation_failed") as notify,
        ):
            alert_failed_task("task-1", "boom", params, should, MagicMock(), MagicMock(), MagicMock())
        return notify

    def test_emails_the_owner_of_a_direct_generation(self):
        notify = self._call(
            {"user_id": "user-1"},
            SimpleNamespace(video_title="My video"),
        )
        notify.assert_called_once_with(
            "user-1",
            slot_id=None,
            title="My video",
            reason="boom",
            dedup_key="generate-task:task-1",
        )

    def test_skips_the_email_when_the_task_cannot_be_read(self):
        with (
            patch("app.services.owner_alert.running_under_test", return_value=False),
            patch("app.services.state.state.get_task", side_effect=RuntimeError("db down")),
            patch("app.services.owner_alert.notify_generation_failed") as notify,
        ):
            alert_failed_task("task-1", "boom", None, MagicMock(return_value=False), MagicMock(), MagicMock(), MagicMock())
        notify.assert_not_called()

    def test_skips_the_email_when_the_task_has_no_owner(self):
        notify = self._call({}, None)
        notify.assert_not_called()


if __name__ == "__main__":
    unittest.main()

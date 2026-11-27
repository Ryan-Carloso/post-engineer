"""Tests for the PostgREST ScheduleStore (app/services/publisher/store.py).

The store is the publisher data layer: reads ``schedules`` (with embedded
personas) and writes ``scheduled_posts`` to Supabase via PostgREST using the
service role. Requires explicit SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (no
fallback — repo rule). HTTP calls validated with a mocked ``requests``.
"""

import json
import os
import sys
import threading
import unittest
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest.mock import MagicMock, patch

from urllib3.connection import HTTPConnection
from urllib3.exceptions import NameResolutionError, ProtocolError

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import publisher as fs

UTC = timezone.utc

ENV = {
    "SUPABASE_URL": "https://supabase.example",
    "SUPABASE_SERVICE_ROLE_KEY": "service-key",
}

SCHEDULE_SELECT = "id,topic"


def _response(status_code=200, json_data=None):
    response = MagicMock()
    response.status_code = status_code
    response.content = b"x" if json_data is not None else b""
    response.json.return_value = json_data if json_data is not None else {}
    response.raise_for_status.return_value = None
    return response


class StoreEnvTests(unittest.TestCase):
    def test_missing_url_raises_explicitly(self):
        with patch.dict(os.environ, {k: "" for k in ENV}, clear=True):
            with self.assertRaises(RuntimeError) as ctx:
                fs.ScheduleStore()
        self.assertIn("SUPABASE_URL", str(ctx.exception))

    def test_missing_service_key_raises_explicitly(self):
        env = {"SUPABASE_URL": ENV["SUPABASE_URL"], "SUPABASE_SERVICE_ROLE_KEY": ""}
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(RuntimeError) as ctx:
                fs.ScheduleStore()
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", str(ctx.exception))


class StoreRequestsTests(unittest.TestCase):
    def setUp(self):
        with patch.dict(os.environ, ENV, clear=True):
            self.store = fs.ScheduleStore(requests_module=MagicMock())
        self.requests = self.store._requests
        self.requests.request.return_value = _response(json_data=[])


    def test_ready_due_slots_embeds_personas_for_notification(self):
        self.store.ready_due_slots(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        _, _, kwargs = self._last_call()
        self.assertIn("personas(", kwargs["params"]["select"])

    def test_ready_due_slots_filters_due_time(self):
        self.store.ready_due_slots(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        _, _, kwargs = self._last_call()
        self.assertEqual(kwargs["params"]["status"], f"eq.{fs.SLOT_READY}")
        self.assertTrue(kwargs["params"]["slot_at"].startswith("lte."))
        self.assertIn("linkedin_account_ids", kwargs["params"]["select"])

    def test_update_slot_patches_by_id(self):
        self.requests.request.return_value = _response(status_code=204)
        self.store.update_slot("slot-1", status="published", published_at="2026-09-07T12:00:00+00:00")
        method, url, kwargs = self._last_call()
        self.assertEqual(method, "PATCH")
        self.assertEqual(url, "https://supabase.example/rest/v1/scheduled_posts")
        self.assertEqual(kwargs["params"]["id"], "eq.slot-1")
        self.assertEqual(kwargs["json"]["status"], "published")


    def test_claim_ready_slot_is_conditional_on_ready(self):
        now = datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)
        self.requests.request.return_value = _response(json_data=[{"id": "slot-1"}])
        claimed = self.store.claim_ready_slot("slot-1", now)
        self.assertTrue(claimed)
        method, url, kwargs = self._last_call()
        self.assertEqual(method, "PATCH")
        self.assertEqual(kwargs["params"]["id"], "eq.slot-1")
        self.assertEqual(kwargs["params"]["status"], "eq.ready")
        self.assertEqual(kwargs["params"]["slot_at"], f"lte.{now.isoformat()}")
        self.assertEqual(kwargs["json"]["status"], "publishing")
        self.assertIn("representation", kwargs["headers"]["Prefer"])

    def test_claim_ready_slot_returns_false_when_lost(self):
        now = datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)
        self.requests.request.return_value = _response(json_data=[])
        self.assertFalse(self.store.claim_ready_slot("slot-1", now))

    def test_resumable_publishing_slots_reads_due_publishing_rows(self):
        self.requests.request.return_value = _response(
            json_data=[{"id": "slot-9", "status": "publishing"}, "junk"]
        )
        now = datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)
        rows = self.store.resumable_publishing_slots(now)
        self.assertEqual(rows, [{"id": "slot-9", "status": "publishing"}])
        method, _, kwargs = self._last_call()
        self.assertEqual(method, "GET")
        self.assertEqual(kwargs["params"]["status"], "eq.publishing")
        self.assertEqual(
            kwargs["params"]["or"],
            f"(publish_not_before.is.null,publish_not_before.lte.{now.isoformat()})",
        )
        self.assertEqual(kwargs["params"]["order"], "slot_at.asc")

    def test_web_claimed_held_slot_stays_hidden_until_its_lease_elapses(self):
        self.requests.request.return_value = _response(json_data=[])
        now = datetime(2026, 9, 7, 12, 10, tzinfo=timezone.utc)
        rows = self.store.resumable_publishing_slots(now)
        self.assertEqual(rows, [])
        _, _, kwargs = self._last_call()
        self.assertEqual(
            kwargs["params"]["or"],
            f"(publish_not_before.is.null,publish_not_before.lte.{now.isoformat()})",
        )

    def test_claim_resumable_slot_moves_the_lease_only_while_due(self):
        self.requests.request.return_value = _response(json_data=[{"id": "slot-9"}])
        self.assertTrue(self.store.claim_resumable_slot("slot-9", "NOW", "LEASE"))
        method, _, kwargs = self._last_call()
        self.assertEqual(method, "PATCH")
        self.assertEqual(kwargs["json"], {"publish_not_before": "LEASE"})
        self.assertEqual(kwargs["params"]["id"], "eq.slot-9")
        self.assertEqual(kwargs["params"]["status"], "eq.publishing")
        self.assertEqual(
            kwargs["params"]["or"],
            "(publish_not_before.is.null,publish_not_before.lte.NOW)",
        )
        self.assertEqual(kwargs["headers"]["Prefer"], "return=representation")

    def test_claim_resumable_slot_returns_false_when_another_worker_won(self):
        self.requests.request.return_value = _response(json_data=[])
        self.assertFalse(self.store.claim_resumable_slot("slot-9", "NOW", "LEASE"))

    def test_access_until_by_user_reads_the_window_in_chunks(self):
        self.requests.request.return_value = _response(
            json_data=[
                {"id": "u1", "access_until": "2026-12-01T00:00:00+00:00"},
                {"id": "u2", "access_until": None},
                "junk",
                {"access_until": "2026-12-01T00:00:00+00:00"},
            ]
        )
        rows = self.store.access_until_by_user(["u1", "u2"])
        self.assertEqual(rows, {"u1": "2026-12-01T00:00:00+00:00", "u2": None})
        method, url, kwargs = self._last_call()
        self.assertEqual(method, "GET")
        self.assertEqual(url, "https://supabase.example/rest/v1/user_profiles")
        self.assertEqual(kwargs["params"]["id"], "in.(u1,u2)")
        self.assertEqual(kwargs["params"]["select"], "id,access_until")

    def test_access_until_by_user_chunks_at_one_hundred(self):
        self.requests.request.return_value = _response(json_data=[])
        ids = [f"u{index}" for index in range(250)]
        self.store.access_until_by_user(ids)
        self.assertEqual(self.requests.request.call_count, 3)
        last_params = self.requests.request.call_args.kwargs["params"]["id"]
        self.assertEqual(last_params.count(","), 49)

    def test_expire_ready_slot_is_conditional_on_ready(self):
        now = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)
        self.requests.request.return_value = _response(json_data=[{"id": "slot-1", "status": "expired"}])
        self.assertTrue(self.store.expire_ready_slot("slot-1", now))
        method, url, kwargs = self._last_call()
        self.assertEqual(method, "PATCH")
        self.assertEqual(url, "https://supabase.example/rest/v1/scheduled_posts")
        self.assertEqual(kwargs["params"], {"id": "eq.slot-1", "status": "eq.ready", "slot_at": f"lte.{now.isoformat()}"})
        self.assertEqual(kwargs["json"], {"status": "expired", "publish_not_before": None})
        self.assertEqual(kwargs["headers"]["Prefer"], "return=representation")

    def test_expire_ready_slot_returns_false_when_another_tick_won(self):
        now = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)
        self.requests.request.return_value = _response(json_data=[])
        self.assertFalse(self.store.expire_ready_slot("slot-1", now))

    def test_expire_ready_slot_skips_a_slot_rescheduled_to_the_future(self):
        now = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)
        self.requests.request.return_value = _response(json_data=[])
        self.assertFalse(self.store.expire_ready_slot("slot-1", now))
        _, _, kwargs = self._last_call()
        self.assertEqual(kwargs["params"]["slot_at"], f"lte.{now.isoformat()}")

    def test_non_dict_rows_filtered(self):
        self.requests.request.return_value = _response(json_data=[{"id": "s1"}, "junk", 42])
        slots = self.store.ready_due_slots(datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc))
        self.assertEqual(len(slots), 1)

    def _last_call(self):
        call = self.requests.request.call_args
        args = call.args
        return args[0], args[1], call.kwargs


class SlotSelectTests(unittest.TestCase):
    """SLOT_SELECT shape: the PostgREST select used for scheduled_posts
    reads with the joined schedule (+persona) embed.
    """

    def setUp(self):
        with patch.dict(os.environ, ENV, clear=True):
            self.store = fs.ScheduleStore(requests_module=MagicMock())
        self.requests = self.store._requests
        self.requests.request.return_value = _response(json_data=[])

    def _last_call(self):
        call = self.requests.request.call_args
        return call.args[0], call.args[1], call.kwargs

    def test_slot_select_includes_bluesky_account_ids(self):
        self.assertIn("bluesky_account_ids", fs.ScheduleStore.SLOT_SELECT)

    def test_slot_select_reads_no_column_migration_087_dropped(self):
        for column in ("post_voice_id", "post_niche", "post_language", "post_video_aspect", "voice_id", "niche", "task_id"):
            self.assertNotIn(column, fs.ScheduleStore.SLOT_SELECT)
        self.assertIn("personas(name,ai_label)", fs.ScheduleStore.SLOT_SELECT)


class _JsonHandler(BaseHTTPRequestHandler):
    def _respond(self, payload):
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._respond([{"id": "slot-1"}])

    def do_PATCH(self):
        self._respond([{"id": "slot-1"}])

    def log_message(self, *args):
        pass


class RetryingSessionTests(unittest.TestCase):
    """A transient connect failure (DNS blip) must not fail the tick stage."""

    def setUp(self):
        self.server = HTTPServer(("127.0.0.1", 0), _JsonHandler)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        env = {
            "SUPABASE_URL": f"http://127.0.0.1:{self.server.server_port}",
            "SUPABASE_SERVICE_ROLE_KEY": "service-key",
        }
        with patch.dict(os.environ, env, clear=True):
            self.store = fs.ScheduleStore()

    def _patch_new_conn(self, failures):
        original = HTTPConnection._new_conn
        attempts = []

        def flaky_new_conn(conn):
            attempts.append(conn.host)
            if len(attempts) <= failures:
                raise NameResolutionError(conn.host, conn, OSError("temporary failure"))
            return original(conn)

        return attempts, patch.object(HTTPConnection, "_new_conn", flaky_new_conn)

    def test_default_store_retries_a_connect_failure(self):
        attempts, patcher = self._patch_new_conn(failures=1)
        with patcher:
            rows = self.store.ready_due_slots(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(rows, [{"id": "slot-1"}])
        self.assertEqual(len(attempts), 2)

    def test_default_store_gives_up_after_the_retry_budget(self):
        import requests

        attempts, patcher = self._patch_new_conn(failures=10)
        with patcher, self.assertRaises(requests.ConnectionError):
            self.store.ready_due_slots(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(len(attempts), fs.store.CONNECT_RETRIES + 1)

    def _patch_getresponse(self, failures):
        """Make the first `failures` reads die, then let them through.

        A read failure means the request reached Supabase and the response
        was lost, which is the one class that must never be retried.
        """
        original = HTTPConnection.getresponse
        attempts = []

        def flaky_getresponse(conn):
            attempts.append(1)
            if len(attempts) <= failures:
                raise ProtocolError("Connection aborted.", OSError("response lost"))
            return original(conn)

        return attempts, patch.object(HTTPConnection, "getresponse", flaky_getresponse)

    def test_read_failures_are_not_retried(self):
        import requests

        attempts, patcher = self._patch_getresponse(failures=1)
        with patcher, self.assertRaises(requests.ConnectionError):
            self.store.ready_due_slots(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertEqual(len(attempts), 1, "a read failure was retried")

    def test_patch_claim_retries_a_connect_failure(self):
        attempts, patcher = self._patch_new_conn(failures=1)
        with patcher:
            claimed = self.store.claim_ready_slot("slot-1", datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        self.assertTrue(claimed, "the retried PATCH did not reach the handler")
        self.assertEqual(len(attempts), 2)

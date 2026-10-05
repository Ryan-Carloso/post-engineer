"""SSE progress stream for video tasks.

GET /api/v1/tasks/{task_id}/events streams text/event-stream snapshots:
    data: {"task_id": "...", "state": 4, "progress": 30, "stage": "materials"}

Snapshots are only emitted when they change; a :heartbeat comment keeps
the connection alive; the stream closes after a terminal state.
"""

import asyncio
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.controllers.v1 import video as video_controller
from app.models import const
from app.models.exception import HttpException
from app.services import state as sm


def _collect(stream, limit=20):
    async def _run():
        events = []
        async for chunk in stream:
            events.append(chunk)
            if len(events) >= limit:
                break
        return events

    return asyncio.run(_run())


def _disconnect_after(polls):
    """is_disconnected stub that drops the connection after N polls."""
    calls = 0

    async def _check():
        nonlocal calls
        calls += 1
        return calls > polls

    return _check


class TaskEventsTests(unittest.TestCase):
    def setUp(self):
        self.task_id = "sse-task-1"
        sm.state.update_task(self.task_id, user_id="u-1")

    def tearDown(self):
        sm.state.delete_task(self.task_id)

    def _stream(self, **kwargs):
        kwargs.setdefault("poll_interval", 0.01)
        kwargs.setdefault("heartbeat_interval", 3600)
        # Disconnect after a few polls so non-terminal streams terminate.
        return video_controller._task_event_stream(
            self.task_id, "u-1", _disconnect_after(5), **kwargs
        )

    def test_emits_snapshot_on_progress_change(self):
        sm.state.update_task(
            self.task_id, state=const.TASK_STATE_PROCESSING, progress=30, stage="materials"
        )
        events = _collect(self._stream(), limit=1)
        self.assertEqual(len(events), 1)
        self.assertTrue(events[0].startswith("data: "))
        snapshot = json.loads(events[0][len("data: "):])
        self.assertEqual(snapshot["task_id"], self.task_id)
        self.assertEqual(snapshot["state"], const.TASK_STATE_PROCESSING)
        self.assertEqual(snapshot["progress"], 30)
        self.assertEqual(snapshot["stage"], "materials")

    def test_no_duplicate_emits_when_unchanged(self):
        sm.state.update_task(
            self.task_id, state=const.TASK_STATE_PROCESSING, progress=30
        )
        events = _collect(self._stream(), limit=3)
        # One snapshot, then silence (limit hit by breaking early).
        self.assertEqual(len(events), 1)

    def test_closes_after_terminal_state(self):
        sm.state.update_task(
            self.task_id, state=const.TASK_STATE_COMPLETE, progress=100
        )
        events = _collect(self._stream(), limit=5)
        self.assertEqual(len(events), 1)
        snapshot = json.loads(events[0][len("data: "):])
        self.assertEqual(snapshot["state"], const.TASK_STATE_COMPLETE)

    def test_closes_after_failed_state(self):
        sm.state.update_task(
            self.task_id, state=const.TASK_STATE_FAILED, progress=50
        )
        events = _collect(self._stream(), limit=5)
        self.assertEqual(len(events), 1)
        snapshot = json.loads(events[0][len("data: "):])
        self.assertEqual(snapshot["state"], const.TASK_STATE_FAILED)

    def test_heartbeat_comment(self):
        stream = video_controller._task_event_stream(
            self.task_id,
            "u-1",
            _disconnect_after(10),
            poll_interval=0.01,
            heartbeat_interval=0.02,
        )
        events = _collect(stream, limit=4)
        self.assertTrue(
            any(e.startswith(":heartbeat") for e in events),
            f"expected a heartbeat comment, got: {events}",
        )

    def test_stops_when_disconnected(self):
        async def _disconnected():
            return True

        stream = video_controller._task_event_stream(
            self.task_id, "u-1", _disconnected, poll_interval=0.01
        )
        events = _collect(stream, limit=5)
        self.assertEqual(events, [])

    def test_stops_when_task_deleted(self):
        sm.state.delete_task(self.task_id)
        events = _collect(self._stream(), limit=5)
        self.assertEqual(events, [])

    def test_route_404_for_unknown_task(self):
        request = type(
            "Request",
            (),
            {
                "headers": {},
                "state": type(
                    "State", (), {"auth": video_controller.base.AuthContext(
                        user_id="u-1", auth_type="internal")}
                )(),
                "is_disconnected": lambda self: asyncio.sleep(0, result=False),
            },
        )()
        with self.assertRaises(HttpException) as ctx:
            asyncio.run(video_controller.task_events(request, task_id="nope"))
        self.assertEqual(ctx.exception.status_code, 404)

    def test_route_scopes_by_user(self):
        # Another user's task must 404, not leak progress.
        sm.state.update_task("other-task", user_id="other-user")
        try:
            request = type(
                "Request",
                (),
                {
                    "headers": {},
                    "state": type(
                        "State", (), {"auth": video_controller.base.AuthContext(
                            user_id="u-1", auth_type="internal")}
                    )(),
                    "is_disconnected": lambda self: asyncio.sleep(0, result=False),
                },
            )()
            with self.assertRaises(HttpException) as ctx:
                asyncio.run(video_controller.task_events(request, task_id="other-task"))
            self.assertEqual(ctx.exception.status_code, 404)
        finally:
            sm.state.delete_task("other-task")


class GenerationIdLookupTests(unittest.TestCase):
    """Best-effort generation_id resolution on the 404 path.

    When a task row is gone the row-based tracking context can't help;
    _generation_id_for_task resolves the web generation_id from
    video_generations so the 404 $exception stays correlatable.
    It must never raise: missing credentials or any failure degrades to
    None and the 404 still goes out.
    """

    def _ok_response(self, rows):
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = rows
        return resp

    def test_returns_generation_id_on_success(self):
        with patch.dict(
            "os.environ",
            {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "k"},
        ), patch("requests.get", return_value=self._ok_response(
            [{"generation_id": "gen-abc-123"}]
        )) as get:
            result = video_controller._generation_id_for_task("task-1")
        self.assertEqual(result, "gen-abc-123")
        _, kwargs = get.call_args
        self.assertIn("video_generations", get.call_args[0][0])
        self.assertEqual(kwargs["params"]["engine_task_id"], "eq.task-1")

    def test_returns_none_without_credentials(self):
        with patch.dict("os.environ", {}, clear=True):
            result = video_controller._generation_id_for_task("task-1")
        self.assertIsNone(result)

    def test_returns_none_on_request_failure(self):
        with patch.dict(
            "os.environ",
            {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "k"},
        ), patch("requests.get", side_effect=Exception("boom")):
            result = video_controller._generation_id_for_task("task-1")
        self.assertIsNone(result)

    def test_returns_none_on_empty_rows(self):
        with patch.dict(
            "os.environ",
            {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "k"},
        ), patch("requests.get", return_value=self._ok_response([])):
            result = video_controller._generation_id_for_task("task-1")
        self.assertIsNone(result)

    def test_returns_none_on_malformed_row(self):
        with patch.dict(
            "os.environ",
            {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "k"},
        ), patch("requests.get", return_value=self._ok_response([{"invalid": "structure"}])):
            result = video_controller._generation_id_for_task("task-1")
        self.assertIsNone(result)

    def test_returns_none_on_malformed_json_body(self):
        resp = MagicMock()
        resp.status_code = 200
        resp.json.side_effect = ValueError("not json")
        with patch.dict(
            "os.environ",
            {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "k"},
        ), patch("requests.get", return_value=resp):
            result = video_controller._generation_id_for_task("task-1")
        self.assertIsNone(result)

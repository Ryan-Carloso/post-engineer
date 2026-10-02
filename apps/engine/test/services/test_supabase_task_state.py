"""Tests for the PostgREST-backed engine task state (app/services/state.py).

SupabaseTaskState persists video-generation task state in the
``engine_task_state`` table so status polls survive engine
restarts/redeploys. HTTP calls are validated with a mocked ``requests``
module; no test touches the network.
"""

import os
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch
import sys

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models import const
from app.services import state as state_module

ENV = {
    "SUPABASE_URL": "https://supabase.example",
    "SUPABASE_SERVICE_ROLE_KEY": "service-key",
}


def _response(status_code=200, json_data=None, headers=None):
    response = MagicMock()
    response.status_code = status_code
    response.content = b"x" if json_data is not None else b""
    response.json.return_value = json_data if json_data is not None else {}
    response.headers = headers or {}
    response.raise_for_status.return_value = None
    return response


def _http_error(status_code):
    import requests

    response = MagicMock()
    response.status_code = status_code
    error = requests.HTTPError(f"{status_code} Client Error")
    error.response = response
    response.raise_for_status.side_effect = error
    return response


def _make_state(requests_mock, **kwargs):
    """Build a SupabaseTaskState whose table-verify SELECT succeeds."""
    requests_mock.request.return_value = _response(json_data=[])
    with patch.dict(os.environ, ENV, clear=True):
        backend = state_module.SupabaseTaskState(
            requests_module=requests_mock, reconcile_on_boot=False, **kwargs
        )
    # Drop the init verify call so tests index only their own requests.
    requests_mock.request.reset_mock()
    return backend


class SupabaseStateEnvTests(unittest.TestCase):
    def test_missing_url_raises_explicitly(self):
        with patch.dict(os.environ, {k: "" for k in ENV}, clear=True):
            with self.assertRaises(RuntimeError) as ctx:
                state_module.SupabaseTaskState(
                    requests_module=MagicMock(), reconcile_on_boot=False
                )
        self.assertIn("SUPABASE_URL", str(ctx.exception))

    def test_missing_service_key_raises_explicitly(self):
        env = {"SUPABASE_URL": ENV["SUPABASE_URL"], "SUPABASE_SERVICE_ROLE_KEY": ""}
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(RuntimeError) as ctx:
                state_module.SupabaseTaskState(
                    requests_module=MagicMock(), reconcile_on_boot=False
                )
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", str(ctx.exception))

    def test_missing_table_fails_fast_with_migration_hint(self):
        requests_mock = MagicMock()
        requests_mock.request.return_value = _http_error(404)
        with patch.dict(os.environ, ENV, clear=True):
            with self.assertRaises(RuntimeError) as ctx:
                state_module.SupabaseTaskState(
                    requests_module=requests_mock, reconcile_on_boot=False
                )
        self.assertIn("engine-task-state.sql", str(ctx.exception))


class SupabaseStateUpdateTests(unittest.TestCase):
    def setUp(self):
        self.requests = MagicMock()
        self.backend = _make_state(self.requests)

    def test_update_task_upserts_merged_row(self):
        existing = {
            "task_id": "t-1",
            "user_id": "u-1",
            "state": const.TASK_STATE_PROCESSING,
            "progress": 10,
            "data": {"stage": "render"},
        }
        self.requests.request.side_effect = [
            _response(json_data=[existing]),  # SELECT existing
            _response(json_data=[{}]),  # POST upsert
        ]
        self.backend.update_task("t-1", state=const.TASK_STATE_PROCESSING, progress=50, stage="lipsync")

        upsert = self.requests.request.call_args_list[1]
        self.assertEqual(upsert[0][0], "POST")
        self.assertIn("resolution=merge-duplicates", upsert[1]["headers"]["Prefer"])
        payload = upsert[1]["json"]
        self.assertEqual(payload["task_id"], "t-1")
        self.assertEqual(payload["user_id"], "u-1")
        self.assertEqual(payload["progress"], 50)
        # kwargs merge into the stored data instead of replacing it
        self.assertEqual(payload["data"]["stage"], "lipsync")

    def test_update_task_clamps_progress(self):
        self.requests.request.side_effect = [
            _response(json_data=[]),
            _response(json_data=[{}]),
        ]
        self.backend.update_task("t-1", progress=137)
        payload = self.requests.request.call_args_list[1][1]["json"]
        self.assertEqual(payload["progress"], 100)

    def test_update_task_stamps_updated_at(self):
        self.requests.request.side_effect = [
            _response(json_data=[]),
            _response(json_data=[{}]),
        ]
        before = datetime.now(timezone.utc)
        self.backend.update_task("t-1", progress=5)
        payload = self.requests.request.call_args_list[1][1]["json"]
        stamped = datetime.fromisoformat(payload["updated_at"])
        self.assertGreaterEqual(stamped, before)


class SupabaseStateReadTests(unittest.TestCase):
    def setUp(self):
        self.requests = MagicMock()
        self.backend = _make_state(self.requests)

    def test_get_task_returns_memory_shape(self):
        row = {
            "task_id": "t-1",
            "user_id": "u-1",
            "state": const.TASK_STATE_PROCESSING,
            "progress": 42,
            "data": {"stage": "render", "user_id": "u-1"},
        }
        self.requests.request.return_value = _response(json_data=[row])
        task = self.backend.get_task("t-1", user_id="u-1")
        self.assertEqual(task["task_id"], "t-1")
        self.assertEqual(task["state"], const.TASK_STATE_PROCESSING)
        self.assertEqual(task["progress"], 42)
        self.assertEqual(task["stage"], "render")

    def test_get_task_missing_row_returns_none(self):
        self.requests.request.return_value = _response(json_data=[])
        self.assertIsNone(self.backend.get_task("nope", user_id="u-1"))

    def test_get_task_wrong_user_returns_none(self):
        row = {
            "task_id": "t-1",
            "user_id": "u-1",
            "state": const.TASK_STATE_PROCESSING,
            "progress": 1,
            "data": {},
        }
        self.requests.request.return_value = _response(json_data=[row])
        self.assertIsNone(self.backend.get_task("t-1", user_id="u-2"))

    def test_get_all_tasks_paginates(self):
        rows = [
            {"task_id": "t-1", "user_id": "u-1", "state": 4, "progress": 1, "data": {}},
            {"task_id": "t-2", "user_id": "u-1", "state": 1, "progress": 100, "data": {}},
        ]
        self.requests.request.return_value = _response(
            json_data=rows, headers={"Content-Range": "0-1/42"}
        )
        tasks, total = self.backend.get_all_tasks(1, 2, user_id="u-1")
        self.assertEqual(total, 42)
        self.assertEqual([t["task_id"] for t in tasks], ["t-1", "t-2"])
        params = self.requests.request.call_args[0][1]
        self.assertIn("limit=2", params)
        self.assertIn("offset=0", params)
        self.assertIn("user_id=eq.u-1", params)

    def test_delete_task(self):
        self.requests.request.return_value = _response(json_data=[])
        self.backend.delete_task("t-1")
        call = self.requests.request.call_args
        self.assertEqual(call[0][0], "DELETE")
        self.assertIn("task_id=eq.t-1", call[0][1])


class SupabaseStateReconcileTests(unittest.TestCase):
    def setUp(self):
        self.requests = MagicMock()

    def test_reconcile_marks_orphans_failed(self):
        orphans = [
            {"task_id": "t-1", "data": {"stage": "render"}},
            {"task_id": "t-2", "data": {}},
        ]
        backend = _make_state(self.requests)
        self.requests.request.side_effect = [
            _response(json_data=orphans),  # SELECT non-terminal rows
            _response(json_data=[{}]),  # PATCH t-1
            _response(json_data=[{}]),  # PATCH t-2
        ]
        backend.reconcile_orphaned_tasks()

        select = self.requests.request.call_args_list[0]
        self.assertIn("state=not.in.(-1,1)", select[0][1])
        for i, task_id in enumerate(["t-1", "t-2"], start=1):
            call = self.requests.request.call_args_list[i]
            self.assertEqual(call[0][0], "PATCH")
            self.assertIn(f"task_id=eq.{task_id}", call[0][1])
            payload = call[1]["json"]
            self.assertEqual(payload["state"], const.TASK_STATE_FAILED)
            self.assertIn("error", payload["data"])

    def test_reconcile_keeps_existing_data(self):
        backend = _make_state(self.requests)
        self.requests.request.side_effect = [
            _response(json_data=[{"task_id": "t-1", "data": {"stage": "render"}}]),
            _response(json_data=[{}]),
        ]
        backend.reconcile_orphaned_tasks()
        payload = self.requests.request.call_args_list[1][1]["json"]
        self.assertEqual(payload["data"]["stage"], "render")
        self.assertIn("error", payload["data"])

    def test_reconcile_with_no_orphans_patches_nothing(self):
        backend = _make_state(self.requests)
        self.requests.request.side_effect = [_response(json_data=[])]
        backend.reconcile_orphaned_tasks()
        # only the SELECT ran
        self.assertEqual(self.requests.request.call_count, 1)

    def test_reconcile_runs_on_boot_by_default(self):
        requests_mock = MagicMock()
        requests_mock.request.side_effect = [
            _response(json_data=[]),  # table verify
            _response(json_data=[]),  # reconcile SELECT
        ]
        with patch.dict(os.environ, ENV, clear=True):
            state_module.SupabaseTaskState(requests_module=requests_mock)
        select = requests_mock.request.call_args_list[1][0][1]
        self.assertIn("state=not.in.(-1,1)", select)

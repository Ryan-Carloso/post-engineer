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
        self.assertIn("003_engine-task-state.sql", str(ctx.exception))


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

    def test_kwargs_only_update_omits_state_and_progress(self):
        # Regression: a kwargs-only update (e.g. music_mood mid-pipeline)
        # must not clobber progress/state with defaults — the upsert omits
        # them so merge-duplicates keeps the stored values.
        existing = {
            "task_id": "t-1",
            "user_id": "u-1",
            "state": const.TASK_STATE_PROCESSING,
            "progress": 40,
            "data": {"stage": "subtitle"},
        }
        self.requests.request.side_effect = [
            _response(json_data=[existing]),  # SELECT existing
            _response(json_data=[{}]),  # POST upsert
        ]
        self.backend.update_task("t-1", music_mood="chill")

        payload = self.requests.request.call_args_list[1][1]["json"]
        self.assertNotIn("state", payload)
        self.assertNotIn("progress", payload)
        self.assertEqual(payload["data"]["music_mood"], "chill")
        # Pre-existing data is preserved.
        self.assertEqual(payload["data"]["stage"], "subtitle")

    def test_explicit_state_without_progress_omits_only_progress(self):
        self.requests.request.side_effect = [
            _response(json_data=[]),
            _response(json_data=[{}]),
        ]
        self.backend.update_task("t-1", state=const.TASK_STATE_FAILED)

        payload = self.requests.request.call_args_list[1][1]["json"]
        self.assertEqual(payload["state"], const.TASK_STATE_FAILED)
        self.assertNotIn("progress", payload)


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
            _response(json_data=[]),  # GET video_generations for t-1: no row
            _response(json_data=[{}]),  # PATCH t-1 failed
            _response(json_data=[]),  # GET video_generations for t-2: no row
            _response(json_data=[{}]),  # PATCH t-2 failed
        ]
        with patch.object(state_module.logger, "warning"):
            failed = backend.reconcile_orphaned_tasks()

        self.assertEqual(failed, 2)
        calls = self.requests.request.call_args_list
        self.assertIn("state=not.in.(-1,1)", calls[0][0][1])
        # Billing settles before the terminal task PATCH, per task:
        # [SELECT, GET gen t-1, PATCH t-1, GET gen t-2, PATCH t-2]
        self.assertEqual(calls[1][0][0], "GET")
        self.assertIn("video_generations", calls[1][0][1])
        for i, task_id in zip([2, 4], ["t-1", "t-2"]):
            call = calls[i]
            self.assertEqual(call[0][0], "PATCH")
            self.assertIn(f"task_id=eq.{task_id}", call[0][1])
            payload = call[1]["json"]
            self.assertEqual(payload["state"], const.TASK_STATE_FAILED)
            self.assertIn("error", payload["data"])

    def test_reconcile_continues_when_task_patch_fails(self):
        # A failed terminal PATCH must not abort the loop: the task stays
        # non-terminal and is retried on the next boot, while the other
        # orphans are still reconciled now.
        orphans = [{"task_id": "t-1", "data": {}}, {"task_id": "t-2", "data": {}}]
        backend = _make_state(self.requests)
        self.requests.request.side_effect = [
            _response(json_data=orphans),  # SELECT non-terminal rows
            _response(json_data=[]),  # GET video_generations for t-1: no row
            _http_error(500),  # PATCH t-1 failed: boom
            _response(json_data=[]),  # GET video_generations for t-2: no row
            _response(json_data=[{}]),  # PATCH t-2 failed
        ]
        with patch.object(state_module.logger, "warning"), patch.object(
            state_module.logger, "error"
        ) as log_error:
            failed = backend.reconcile_orphaned_tasks()
        self.assertEqual(failed, 1)
        self.assertTrue(log_error.called)
        last_patch = self.requests.request.call_args_list[-1][1]["json"]
        self.assertEqual(last_patch["state"], const.TASK_STATE_FAILED)

    def test_reconcile_keeps_existing_data(self):
        backend = _make_state(self.requests)
        self.requests.request.side_effect = [
            _response(json_data=[{"task_id": "t-1", "data": {"stage": "render"}}]),
            _response(json_data=[]),  # GET video_generations: no row
            _response(json_data=[{}]),  # PATCH task
        ]
        with patch.object(state_module.logger, "warning"):
            backend.reconcile_orphaned_tasks()
        payload = self.requests.request.call_args_list[2][1]["json"]
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


class SupabaseStateBillingReconcileTests(unittest.TestCase):
    """The engine settles orphaned tasks alone: no web visit required.

    For each orphaned task the reconcile marks the video_generations row
    failed and refunds the token via the idempotent
    refund_generation_tokens RPC.
    """

    def setUp(self):
        self.requests = MagicMock()

    def _orphan(self):
        return [{"task_id": "t-1", "data": {}}]

    def _generation(self, **overrides):
        row = {
            "generation_id": "g-1",
            "user_id": "u-1",
            "status": "pending",
            "tokens_refunded": False,
        }
        row.update(overrides)
        return row

    def test_reconcile_settles_generation_and_refunds(self):
        backend = _make_state(self.requests)
        self.requests.request.side_effect = [
            _response(json_data=self._orphan()),  # SELECT orphaned tasks
            _response(json_data=[self._generation()]),  # GET video_generations
            _response(json_data={"refunded": True}),  # POST refund RPC
            _response(json_data=[{}]),  # PATCH video_generations
            _response(json_data=[{}]),  # PATCH task failed
        ]
        backend.reconcile_orphaned_tasks()

        calls = self.requests.request.call_args_list
        rpc = calls[2]
        self.assertIn("rpc/refund_generation_tokens", rpc[0][1])
        self.assertEqual(
            rpc[1]["json"],
            {
                "p_user_id": "u-1",
                "p_generation_id": "g-1",
                "p_reason": f"{state_module._ORPHAN_ERROR_MESSAGE}; tokens refunded",
            },
        )
        settle = calls[3]
        self.assertIn("video_generations", settle[0][1])
        self.assertIn("generation_id=eq.g-1", settle[0][1])
        payload = settle[1]["json"]
        self.assertEqual(payload["status"], "failed")
        self.assertEqual(payload["error_code"], "engine_restart")
        self.assertTrue(payload["tokens_refunded"])
        self.assertIn("completed_at", payload)
        # the terminal task PATCH runs after the billing settle
        task_patch = calls[4]
        self.assertEqual(task_patch[0][0], "PATCH")
        self.assertIn("task_id=eq.t-1", task_patch[0][1])
        self.assertEqual(task_patch[1]["json"]["state"], const.TASK_STATE_FAILED)

    def test_reconcile_skips_already_settled_generation(self):
        backend = _make_state(self.requests)
        self.requests.request.side_effect = [
            _response(json_data=self._orphan()),
            _response(json_data=[self._generation(status="failed", tokens_refunded=True)]),
            _response(json_data=[{}]),  # PATCH task failed
        ]
        backend.reconcile_orphaned_tasks()
        # SELECT tasks, GET generation, PATCH task — nothing more
        self.assertEqual(self.requests.request.call_count, 3)
        urls = [c[0][1] for c in self.requests.request.call_args_list]
        self.assertFalse(any("rpc/" in url for url in urls))

    def test_reconcile_skips_refund_when_already_refunded(self):
        backend = _make_state(self.requests)
        self.requests.request.side_effect = [
            _response(json_data=self._orphan()),
            _response(json_data=[self._generation(tokens_refunded=True)]),
            _response(json_data=[{}]),  # PATCH video_generations
            _response(json_data=[{}]),  # PATCH task failed
        ]
        backend.reconcile_orphaned_tasks()
        urls = [c[0][1] for c in self.requests.request.call_args_list]
        self.assertFalse(any("rpc/" in url for url in urls))
        settle = self.requests.request.call_args_list[2][1]["json"]
        self.assertTrue(settle["tokens_refunded"])
        self.assertEqual(settle["status"], "failed")

    def test_reconcile_warns_when_no_generation_row(self):
        # No video_generations row is normal for fill_schedule batch tasks
        # (the batch reconciler settles those); warn, don't error.
        backend = _make_state(self.requests)
        self.requests.request.side_effect = [
            _response(json_data=self._orphan()),
            _response(json_data=[]),  # GET video_generations: no row
            _response(json_data=[{}]),  # PATCH task failed
        ]
        with patch.object(state_module.logger, "warning") as log_warning, patch.object(
            state_module.logger, "error"
        ) as log_error:
            settled = backend.reconcile_orphaned_tasks()
        # the task is still failed; the missing billing row is a warning, not an error
        self.assertEqual(settled, 1)
        self.assertTrue(log_warning.called)
        self.assertFalse(log_error.called)
        urls = [c[0][1] for c in self.requests.request.call_args_list]
        self.assertFalse(any("rpc/" in url for url in urls))

    def test_reconcile_continues_when_rpc_fails(self):
        backend = _make_state(self.requests)
        orphans = [{"task_id": "t-1", "data": {}}, {"task_id": "t-2", "data": {}}]
        self.requests.request.side_effect = [
            _response(json_data=orphans),
            _response(json_data=[self._generation()]),  # GET generation t-1
            _http_error(500),  # POST refund RPC fails
            _response(json_data=[{}]),  # PATCH video_generations anyway
            _response(json_data=[{}]),  # PATCH t-1 failed
            _response(json_data=[]),  # GET video_generations t-2: no row
            _response(json_data=[{}]),  # PATCH t-2 failed
        ]
        with patch.object(state_module.logger, "error"), patch.object(
            state_module.logger, "warning"
        ):
            settled = backend.reconcile_orphaned_tasks()
        self.assertEqual(settled, 2)
        # the failed refund is recorded honestly: tokens_refunded is left
        # untouched (not forced to false) so a concurrent true can never be
        # clobbered, and the web's poll path retries the refund as a
        # backstop when the user next checks
        gen_patch = self.requests.request.call_args_list[3][1]["json"]
        self.assertEqual(gen_patch["status"], "failed")
        self.assertNotIn("tokens_refunded", gen_patch)


class SupabaseStateAuthTests(unittest.TestCase):
    def test_401_raises_auth_error_naming_env_var(self):
        requests_mock = MagicMock()
        backend = _make_state(requests_mock)
        requests_mock.request.return_value = _http_error(401)
        with self.assertRaises(state_module._SupabaseAuthError) as ctx:
            backend._request("GET", "select=task_id&limit=1")
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", str(ctx.exception))

    def test_non_401_http_error_reraises_unchanged(self):
        import requests

        requests_mock = MagicMock()
        backend = _make_state(requests_mock)
        requests_mock.request.return_value = _http_error(500)
        with self.assertRaises(requests.HTTPError):
            backend._request("GET", "select=task_id&limit=1")


class SupabaseStateTimeoutTests(unittest.TestCase):
    def test_state_requests_use_short_timeout(self):
        # A Supabase outage must fail fast: update_task holds the RLock
        # across its calls, and a 30s timeout would serialize every
        # concurrent task thread's progress writes behind one wedged holder.
        #
        # The tuple is (connect, read). Connect is 3, NOT the store's 10:
        # with the retry policy the worst case per call is
        # max(2 * connect + 0.5 backoff, read), so connect=10 would push a
        # blackholed Supabase to 20.5s under the lock and re-serialize
        # every writer — exactly what the 10s ceiling exists to prevent.
        requests_mock = MagicMock()
        backend = _make_state(requests_mock)
        requests_mock.request.side_effect = [_response(json_data=[])]
        backend.get_task("t-1")
        call = requests_mock.request.call_args
        self.assertEqual(call[1]["timeout"], (3, 10))

    def test_rpc_uses_short_timeout(self):
        requests_mock = MagicMock()
        backend = _make_state(requests_mock)
        requests_mock.request.side_effect = [_response(json_data={"refunded": True})]
        backend._rpc("refund_generation_tokens", {"p_user_id": "u-1"})
        call = requests_mock.request.call_args
        self.assertEqual(call[1]["timeout"], (3, 10))

    def test_worst_case_per_call_stays_within_the_previous_ceiling(self):
        # The invariant that keeps update_task's lock bounded: the retry
        # policy must not raise the 10s ceiling the flat timeout=10 had.
        from app.utils.supabase_retry import worst_case_seconds

        self.assertLessEqual(worst_case_seconds(3, 10), 10)


class SupabaseStateRetryTests(unittest.TestCase):
    """The task-state client must ride the shared connect-retry policy.

    reconcile/publish call get_task once per generating/ready slot on every
    tick. Without retries, one DNS blip fails the whole stage — the exact
    noise the fill-schedule store's retry was added to remove.
    """

    def setUp(self):
        self.requests_mock = MagicMock()
        self.backend = _make_state(self.requests_mock)
        # _make_state injects requests_module, so build the retrying session
        # the production path would use and mount it on the same instance.
        from app.utils.supabase_retry import build_retrying_session

        self.backend._requests = build_retrying_session()

    def test_production_backend_builds_a_retrying_session(self):
        # Guards the wiring itself: with requests_module injected the session
        # is bypassed, so assert the default constructor's session retries.
        from app.utils.supabase_retry import CONNECT_RETRIES

        # The default constructor builds a real session and then verifies the
        # table, which would do a live DNS lookup. Stub the verify so the
        # constructor completes and the session can be inspected; the retry
        # policy is asserted without ever opening a connection.
        with patch.dict(os.environ, ENV, clear=True):
            with patch.object(state_module.SupabaseTaskState, "_verify_table"):
                backend = state_module.SupabaseTaskState(reconcile_on_boot=False)
        retry = backend._requests.get_adapter("https://supabase.example").max_retries
        self.assertEqual(retry.connect, CONNECT_RETRIES)
        self.assertIs(retry.read, False)

    def test_injected_mock_is_not_replaced_by_the_session(self):
        # The injection seam is load-bearing for ~30 existing tests: when
        # requests_module is passed, the retrying session must not be built.
        requests_mock = MagicMock()
        backend = _make_state(requests_mock)
        requests_mock.request.side_effect = [_response(json_data=[])]
        backend.get_task("t-1")
        self.assertIs(backend._requests, requests_mock)


class SupabaseStateQuotingTests(unittest.TestCase):
    def setUp(self):
        self.requests = MagicMock()
        self.backend = _make_state(self.requests)

    def test_task_id_special_chars_are_percent_encoded(self):
        self.requests.request.side_effect = [_response(json_data=[])]
        self.backend.get_task("a b&c=d")
        query = self.requests.request.call_args_list[0][0][1]
        self.assertIn("task_id=eq.a%20b%26c%3Dd", query)
        self.assertNotIn(" ", query.split("task_id=eq.")[1].split("&select")[0])

    def test_user_id_special_chars_are_percent_encoded(self):
        self.requests.request.side_effect = [_response(json_data=[])]
        self.backend.get_all_tasks(1, 10, user_id="u&1")
        query = self.requests.request.call_args_list[0][0][1]
        self.assertIn("user_id=eq.u%261", query)

    def test_delete_task_encodes_task_id(self):
        self.requests.request.side_effect = [_response(json_data=[])]
        self.backend.delete_task("a/b")
        query = self.requests.request.call_args_list[0][0][1]
        self.assertIn("task_id=eq.a%2Fb", query)


class SupabaseStateShapeGuardTests(unittest.TestCase):
    def setUp(self):
        self.requests = MagicMock()
        self.backend = _make_state(self.requests)

    def test_get_task_with_non_dict_data_degrades_to_empty(self):
        row = {
            "task_id": "t-1",
            "state": const.TASK_STATE_PROCESSING,
            "progress": 10,
            "data": "not-a-dict",
        }
        self.requests.request.side_effect = [_response(json_data=[row])]
        task = self.backend.get_task("t-1")
        self.assertIsNotNone(task)
        self.assertEqual(task["task_id"], "t-1")
        self.assertNotIn("not-a-dict", str(task))

    def test_update_task_with_non_dict_stored_data_merges_into_empty(self):
        existing = {
            "task_id": "t-1",
            "user_id": "u-1",
            "state": const.TASK_STATE_PROCESSING,
            "progress": 10,
            "data": ["a", "list"],
        }
        self.requests.request.side_effect = [
            _response(json_data=[existing]),
            _response(json_data=[{}]),
        ]
        # Must not raise; kwargs merge into a fresh dict.
        self.backend.update_task("t-1", progress=50, stage="x")
        payload = self.requests.request.call_args_list[1][1]["json"]
        self.assertEqual(payload["data"], {"stage": "x"})

    def test_reconcile_with_non_dict_data_still_fails_row(self):
        orphans = [{"task_id": "t-1", "data": 42}]
        backend = _make_state(self.requests)
        self.requests.request.side_effect = [
            _response(json_data=orphans),
            _response(json_data=[]),  # GET video_generations: no row
            _response(json_data=[{}]),  # PATCH task failed
        ]
        with patch.object(state_module.logger, "warning"):
            self.assertEqual(backend.reconcile_orphaned_tasks(), 1)
        payload = self.requests.request.call_args_list[2][1]["json"]
        self.assertEqual(payload["state"], const.TASK_STATE_FAILED)
        self.assertIn("error", payload["data"])


class SupabaseStateLockTests(unittest.TestCase):
    def setUp(self):
        self.requests = MagicMock()

    def test_update_task_holds_lock_for_select_and_post(self):
        # The SELECT→POST read-modify-write must run under the instance
        # lock: a probe thread attempting a non-blocking acquire from
        # inside the request path must fail for both calls, proving
        # neither can interleave with another writer's sequence.
        # (Probed from a second thread because RLock re-acquire by the
        # owning thread always succeeds.)
        import threading

        backend = _make_state(self.requests)
        held = {}

        def fake_request(method, url, **kwargs):
            outcome = {}

            def probe():
                acquired = backend._lock.acquire(blocking=False)
                outcome["free"] = acquired
                if acquired:
                    backend._lock.release()

            t = threading.Thread(target=probe)
            t.start()
            t.join(timeout=5)
            held[method] = not outcome.get("free", True)
            return _response(json_data=[])

        self.requests.request.side_effect = fake_request
        backend.update_task("t-1", progress=5, stage="x")
        self.assertTrue(held.get("GET"), "SELECT ran outside the lock")
        self.assertTrue(held.get("POST"), "POST ran outside the lock")

    def test_concurrent_update_tasks_do_not_lose_kwargs(self):
        import threading
        import time

        db = {}

        def fake_request(method, url, **kwargs):
            if method == "GET":
                time.sleep(0.02)  # widen the race window
                task_id = url.split("task_id=eq.")[1].split("&")[0]
                return _response(json_data=[db[task_id]] if task_id in db else [])
            payload = kwargs["json"]
            db[payload["task_id"]] = payload
            return _response(json_data=[payload])

        requests_mock = MagicMock()
        backend = _make_state(requests_mock)
        requests_mock.request.side_effect = fake_request

        def writer(kwarg):
            backend.update_task("t-race", **{kwarg: True})

        threads = [threading.Thread(target=writer, args=(f"kw{i}",)) for i in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)

        final = db["t-race"]["data"]
        for i in range(4):
            self.assertTrue(final.get(f"kw{i}"), f"kw{i} lost: {final}")


class PersistStateUpdateTests(unittest.TestCase):
    def test_success_returns_true_single_call(self):
        state = MagicMock()
        self.assertTrue(state_module.persist_state_update(state, "t-1", progress=5))
        state.update_task.assert_called_once_with("t-1", progress=5)

    def test_transient_failure_retries_once(self):
        state = MagicMock()
        state.update_task.side_effect = [RuntimeError("blip"), None]
        self.assertTrue(state_module.persist_state_update(state, "t-1", progress=5))
        self.assertEqual(state.update_task.call_count, 2)

    def test_permanent_failure_returns_false_and_logs_loudly(self):
        from loguru import logger

        state = MagicMock()
        state.update_task.side_effect = RuntimeError("supabase down")
        records = []
        handler = logger.add(lambda m: records.append(m.record))
        try:
            result = state_module.persist_state_update(
                state, "t-1", state_=const.TASK_STATE_FAILED
            )
        finally:
            logger.remove(handler)
        self.assertFalse(result)
        self.assertEqual(state.update_task.call_count, 2)
        errors = [r for r in records if r["level"].name == "ERROR"]
        self.assertTrue(
            any("t-1" in r["message"] for r in errors),
            "permanent write loss must log loudly with the task id",
        )

    def test_never_raises(self):
        state = MagicMock()
        state.update_task.side_effect = RuntimeError("down")
        # Must not raise: a persistence failure must never mask the outcome.
        state_module.persist_state_update(state, "t-1", progress=1)


class SupabaseStateReconcileBatchTests(unittest.TestCase):
    """Batch bounds for the boot reconcile (MINOR review findings)."""

    def setUp(self):
        self.requests = MagicMock()

    def _orphan(self, task_id):
        return {"task_id": task_id, "data": {}}

    def _generation(self, **overrides):
        row = {
            "generation_id": "g-1",
            "user_id": "u-1",
            "status": "pending",
            "tokens_refunded": False,
        }
        row.update(overrides)
        return row

    def test_reconcile_select_is_capped_and_ordered(self):
        backend = _make_state(self.requests)
        self.requests.request.side_effect = [
            _response(json_data=[]),  # SELECT orphaned tasks: none
        ]
        backend.reconcile_orphaned_tasks()
        params = self.requests.request.call_args[0][1]
        self.assertIn(
            f"limit={state_module._RECONCILE_BATCH_LIMIT}", params
        )
        self.assertIn("order=updated_at.asc", params)

    def test_reconcile_warns_when_batch_cap_hit(self):
        backend = _make_state(self.requests)
        cap = state_module._RECONCILE_BATCH_LIMIT
        orphans = [self._orphan(f"t-{i}") for i in range(cap)]
        self.requests.request.side_effect = [
            _response(json_data=orphans),
            *[
                response
                for _ in orphans
                for response in (
                    _response(json_data=[]),  # GET video_generations: no row
                    _response(json_data=[{}]),  # PATCH task failed
                )
            ],
        ]
        with patch.object(state_module.logger, "warning") as log_warning:
            settled = backend.reconcile_orphaned_tasks()
        self.assertEqual(settled, cap)
        cap_warnings = [
            c for c in log_warning.call_args_list if "batch cap" in str(c)
        ]
        self.assertEqual(len(cap_warnings), 1)

    def test_reconcile_warns_on_multiple_generation_rows(self):
        backend = _make_state(self.requests)
        rows = [
            self._generation(generation_id="g-old"),
            self._generation(generation_id="g-new"),
        ]
        self.requests.request.side_effect = [
            _response(json_data=[self._orphan("t-1")]),
            _response(json_data=rows),  # GET video_generations: two rows
            _response(json_data={"refunded": True}),  # POST refund RPC
            _response(json_data=[{}]),  # PATCH video_generations
            _response(json_data=[{}]),  # PATCH task failed
        ]
        with patch.object(state_module.logger, "warning") as log_warning:
            backend.reconcile_orphaned_tasks()
        multi_warnings = [
            c for c in log_warning.call_args_list if "2 video_generations" in str(c)
        ]
        self.assertEqual(len(multi_warnings), 1)
        # the oldest row (rows[0]) is the one settled
        rpc = self.requests.request.call_args_list[2]
        self.assertEqual(rpc[1]["json"]["p_generation_id"], "g-old")

    def test_reconcile_logs_progress_every_n_rows(self):
        backend = _make_state(self.requests)
        every = state_module._RECONCILE_PROGRESS_EVERY
        orphans = [self._orphan(f"t-{i}") for i in range(every)]
        self.requests.request.side_effect = [
            _response(json_data=orphans),
            *[
                response
                for _ in orphans
                for response in (
                    _response(json_data=[]),  # GET video_generations: no row
                    _response(json_data=[{}]),  # PATCH task failed
                )
            ],
        ]
        with patch.object(state_module.logger, "info") as log_info:
            with patch.object(state_module.logger, "warning"):
                backend.reconcile_orphaned_tasks()
        progress = [
            c for c in log_info.call_args_list if "reconcile progress" in str(c)
        ]
        self.assertEqual(len(progress), 1)
        self.assertIn(f"{every}/{every}", str(progress[0]))

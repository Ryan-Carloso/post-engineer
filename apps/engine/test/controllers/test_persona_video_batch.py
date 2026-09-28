"""POST /api/v1/persona-videos/batch: one request, N persona videos.

- Body: {persona, items[1..10], webhook_url?}; per-item shapes reuse
  ContentParams validation.
- Validates all items first; checks token balance upfront for N videos and
  fails fast with 400 INSUFFICIENT (nothing created/charged) if insufficient.
- Returns 202 {task_ids} immediately; the N tasks run SEQUENTIALLY in
  background (strictly one-at-a-time). One video failing does not cancel
  the rest; webhook_url applies per task.
"""

import threading
import types
import unittest
from unittest.mock import patch

from pydantic import ValidationError

from app.controllers.v1 import video as video_controller
from app.models.schema import (
    BatchVideoItem,
    PersonaParams,
    PersonaVideoBatchRequest,
)


def _persona() -> PersonaParams:
    return PersonaParams(
        voice_id="voice-1",
        photo_url="https://example.com/a.png",
        niche="tech",
        speaking_style="casual",
        audience="devs",
        language="pt-BR",
    )


def _batch_request(n: int, **kwargs) -> PersonaVideoBatchRequest:
    items = [BatchVideoItem(topic=f"topic {i}") for i in range(n)]
    return PersonaVideoBatchRequest(persona=_persona(), items=items, **kwargs)


def _request() -> object:
    return type(
        "Request",
        (),
        {
            "headers": {"x-task-id": "request"},
            "state": types.SimpleNamespace(
                auth=video_controller.base.AuthContext(
                    user_id="user-1", auth_type="internal"
                )
            ),
        },
    )()


class BatchSchemaTest(unittest.TestCase):
    def test_items_min_1(self):
        with self.assertRaises(ValidationError):
            PersonaVideoBatchRequest(persona=_persona(), items=[])

    def test_items_max_10(self):
        items = [BatchVideoItem(topic=f"t{i}") for i in range(11)]
        with self.assertRaises(ValidationError):
            PersonaVideoBatchRequest(persona=_persona(), items=items)

    def test_items_max_10_ok(self):
        body = _batch_request(10)
        self.assertEqual(len(body.items), 10)

    def test_item_topic_required(self):
        with self.assertRaises(ValidationError):
            BatchVideoItem(topic="")

    def test_item_optional_fields(self):
        item = BatchVideoItem(topic="t")
        self.assertIsNone(item.goal)
        self.assertIsNone(item.platform_ids)

    def test_webhook_url_must_be_http(self):
        with self.assertRaises(ValidationError):
            _batch_request(1, webhook_url="ftp://example.com/hook")
        body = _batch_request(1, webhook_url="https://example.com/hook")
        self.assertEqual(body.webhook_url, "https://example.com/hook")


class BatchEndpointTest(unittest.TestCase):
    def _run_endpoint(self, body, store=None):
        """Run the endpoint with a stub billing store; return the response."""
        if store is None:
            store = types.SimpleNamespace(
                spend_tokens=lambda *a, **k: True,
                refund_tokens=lambda *a, **k: True,
            )
        with (
            patch.object(
                video_controller, "_batch_billing_store", return_value=store
            ),
            patch.object(video_controller.sm.state, "update_task"),
            patch.object(video_controller.sm.state, "delete_task"),
        ):
            return video_controller.create_persona_video_batch(_request(), body)

    def test_batch_of_3_returns_202_with_3_task_ids(self):
        body = _batch_request(3)
        with patch.object(video_controller.tm, "start"):
            # Don't run the background thread; just capture the specs.
            with patch.object(threading, "Thread") as thread_cls:
                result = self._run_endpoint(body)
                thread_cls.assert_called_once()
        self.assertEqual(result["status"], 202)
        task_ids = result["data"]["task_ids"]
        self.assertEqual(len(task_ids), 3)
        self.assertEqual(len(set(task_ids)), 3)

    def test_insufficient_balance_fails_fast_with_400(self):
        body = _batch_request(3)
        calls = []

        def spend(user_id, generation_id, amount, reason):
            calls.append(generation_id)
            return len(calls) < 2  # second video fails

        refunded = []
        store = types.SimpleNamespace(
            spend_tokens=spend,
            refund_tokens=lambda u, g, r: refunded.append(g) or True,
        )
        with (
            patch.object(
                video_controller, "_batch_billing_store", return_value=store
            ),
            patch.object(video_controller.sm.state, "update_task") as update_task,
            patch.object(video_controller.sm.state, "delete_task"),
        ):
            with self.assertRaises(Exception) as ctx:
                video_controller.create_persona_video_batch(_request(), body)
        self.assertEqual(ctx.exception.status_code, 400)
        # The one successful spend was refunded: nothing stays charged.
        self.assertEqual(refunded, calls[:1])
        # No tasks were created.
        update_task.assert_not_called()

    def test_single_video_batch_works(self):
        body = _batch_request(1)
        with patch.object(threading, "Thread"):
            result = self._run_endpoint(body)
        self.assertEqual(result["status"], 202)
        self.assertEqual(len(result["data"]["task_ids"]), 1)

    def test_webhook_url_propagates_to_each_task_params(self):
        body = _batch_request(2, webhook_url="https://example.com/hook")
        seen = []
        with (
            patch.object(threading, "Thread"),
            patch.object(
                video_controller.tm, "start", side_effect=lambda *a, **k: seen.append(k)
            ),
        ):
            # Capture the specs by running the thread target inline.
            with patch.object(
                threading, "Thread", side_effect=lambda **kw: _run_inline(**kw)
            ):
                self._run_endpoint(body)
        self.assertEqual(len(seen), 2)
        for kwargs in seen:
            self.assertEqual(
                kwargs["params"].webhook_url, "https://example.com/hook"
            )


class _run_inline:
    """threading.Thread replacement that runs the target synchronously."""

    def __init__(self, **kwargs):
        self._target = kwargs["target"]
        self._args = kwargs["args"]

    def start(self):
        self._target(*self._args)


class BatchSequentialTest(unittest.TestCase):
    def test_tasks_run_strictly_sequentially(self):
        body = _batch_request(3)
        active = threading.Semaphore(1)
        overlap = []
        order = []

        def fake_start(task_id, params, stop_at):
            acquired = active.acquire(blocking=False)
            overlap.append(acquired)
            order.append(task_id)
            try:
                pass
            finally:
                if acquired:
                    active.release()

        specs_holder = {}

        def capture_thread(**kwargs):
            specs_holder["target"] = kwargs["target"]
            specs_holder["args"] = kwargs["args"]
            return types.SimpleNamespace(start=lambda: None)

        with (
            patch.object(
                video_controller, "_batch_billing_store",
                return_value=types.SimpleNamespace(
                    spend_tokens=lambda *a, **k: True, refund_tokens=lambda *a, **k: True
                ),
            ),
            patch.object(video_controller.sm.state, "update_task"),
            patch.object(video_controller.sm.state, "delete_task"),
            patch.object(threading, "Thread", side_effect=capture_thread),
        ):
            video_controller.create_persona_video_batch(_request(), body)

        # Run the sequential runner inline with the probing start.
        with patch.object(video_controller.tm, "start", side_effect=fake_start):
            specs_holder["target"](*specs_holder["args"])

        self.assertEqual(len(order), 3)
        # No two tasks ever overlapped.
        self.assertTrue(all(overlap), "tasks must not overlap")

    def test_one_failure_does_not_cancel_the_rest(self):
        body = _batch_request(3)
        ran = []

        def fake_start(task_id, params, stop_at):
            ran.append(task_id)
            if len(ran) == 2:
                raise RuntimeError("video 2 exploded")

        specs_holder = {}

        def capture_thread(**kwargs):
            specs_holder["target"] = kwargs["target"]
            specs_holder["args"] = kwargs["args"]
            return types.SimpleNamespace(start=lambda: None)

        with (
            patch.object(
                video_controller, "_batch_billing_store",
                return_value=types.SimpleNamespace(
                    spend_tokens=lambda *a, **k: True, refund_tokens=lambda *a, **k: True
                ),
            ),
            patch.object(video_controller.sm.state, "update_task"),
            patch.object(video_controller.sm.state, "delete_task"),
            patch.object(threading, "Thread", side_effect=capture_thread),
        ):
            video_controller.create_persona_video_batch(_request(), body)

        with patch.object(video_controller.tm, "start", side_effect=fake_start):
            # Must not raise: the runner isolates per-task failures.
            specs_holder["target"](*specs_holder["args"])

        self.assertEqual(len(ran), 3)


class BatchFailureRefundTest(unittest.TestCase):
    """Engine-billed batches own their ledger: a failed video's upfront
    charge is refunded by the batch runner. The web refund proxy cannot
    reach these charge rows (it looks up by engine_task_id, which
    engine-billed rows never carry), so each task is refunded at most once.
    """

    def _run_batch_inline(self, body, store, start_side_effect, get_task_side_effect):
        specs_holder = {}

        def capture_thread(**kwargs):
            specs_holder["target"] = kwargs["target"]
            specs_holder["args"] = kwargs["args"]
            return types.SimpleNamespace(start=lambda: None)

        with (
            patch.object(video_controller, "_batch_billing_store", return_value=store),
            patch.object(video_controller.sm.state, "update_task"),
            patch.object(video_controller.sm.state, "delete_task"),
            patch.object(threading, "Thread", side_effect=capture_thread),
        ):
            video_controller.create_persona_video_batch(_request(), body)

        with (
            patch.object(video_controller.tm, "start", side_effect=start_side_effect),
            patch.object(
                video_controller.sm.state, "get_task", side_effect=get_task_side_effect
            ),
        ):
            specs_holder["target"](*specs_holder["args"])

    def test_failed_video_gets_its_upfront_charge_refunded(self):
        body = _batch_request(3)
        spent = []
        refunded = []

        def fake_spend(user_id, generation_id, amount, reason):
            spent.append((user_id, generation_id))
            return True

        store = types.SimpleNamespace(
            spend_tokens=fake_spend,
            refund_tokens=lambda u, g, r: refunded.append((u, g)) or True,
        )
        task_ids = []

        def fake_start(task_id, params, stop_at):
            task_ids.append(task_id)

        def fake_get_task(task_id):
            # Only the second video failed.
            return {"state": -1 if task_id == task_ids[1] else 1}

        self._run_batch_inline(body, store, fake_start, fake_get_task)

        # Exactly one refund: the failed video's own upfront charge.
        self.assertEqual(refunded, [spent[1]])
        self.assertEqual(refunded[0][0], "user-1")
        self.assertTrue(refunded[0][1].endswith(":video:1"))

    def test_successful_videos_are_never_refunded(self):
        body = _batch_request(2)
        refunded = []
        store = types.SimpleNamespace(
            spend_tokens=lambda *a, **k: True,
            refund_tokens=lambda u, g, r: refunded.append(g) or True,
        )

        self._run_batch_inline(
            body,
            store,
            lambda task_id, params, stop_at: None,
            lambda task_id: {"state": 1},
        )
        self.assertEqual(refunded, [])

    def test_refund_failure_does_not_cancel_the_rest(self):
        body = _batch_request(3)
        ran = []

        def fake_start(task_id, params, stop_at):
            ran.append(task_id)

        def fail_refund(user_id, generation_id, reason):
            raise RuntimeError("ledger down")

        store = types.SimpleNamespace(
            spend_tokens=lambda *a, **k: True, refund_tokens=fail_refund
        )

        # All three fail; the refund RPC explodes each time — the runner
        # must still attempt every video and every refund.
        self._run_batch_inline(
            body, store, fake_start, lambda task_id: {"state": -1}
        )
        self.assertEqual(len(ran), 3)

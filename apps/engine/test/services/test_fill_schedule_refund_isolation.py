"""A refund failure in fill_schedule is logged and isolated to its slot.

Root AGENTS.md rules pinned here:

- "A refund returning False/`error` is a real failure — log loudly."
- "Data-dependent failures fail the item once, not the whole stage every tick."

Transport failures must still reach the stage-level handler, which reports
one outage incident instead of one error per slot.
"""

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import requests

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import fill_schedule as fs
from app.services.fill_schedule import generate as gen_module
from app.services.fill_schedule import reconcile as reconcile_module
from app.services.fill_schedule.reconcile import BatchReconciler

UTC = timezone.utc
NOW = datetime(2026, 9, 6, 12, 0, tzinfo=UTC)


class _GenerateStore:
    def __init__(self, slot, refund):
        self._slot = slot
        self._refund = refund
        self.updates = []

    def pending_slots(self, now, limit):
        return [self._slot]

    def update_slot(self, slot_id, **fields):
        self.updates.append((slot_id, fields))

    def refund_batch_tokens(self, *args, **kwargs):
        if isinstance(self._refund, Exception):
            raise self._refund
        return self._refund

    def spend_tokens(self, *args):
        return True

    def set_connect_retries(self, n):
        pass

    def signed_url(self, *args, **kwargs):
        return "https://signed/foto.png"


def _slot(**extra):
    slot = {
        "id": "slot-1",
        "slot_at": "2026-09-08T09:00:00+00:00",
        "title": "Batch title one",
        "description": "Agent description.",
        "video_type": "hook_lipsync",
        "segments": [
            {"kind": "hook", "text": "Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is still waiting nearby for you today.", "media": [{"url": "https://example.com/h0.jpg"}, {"url": "https://example.com/h1.jpg"}, {"url": "https://example.com/h2.jpg"}, {"url": "https://example.com/h3.jpg"}, {"url": "https://example.com/h4.jpg"}]},
            {"kind": "content", "text": "Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.", "media": [{"url": "https://example.com/b0.jpg"}, {"url": "https://example.com/b1.jpg"}, {"url": "https://example.com/b2.jpg"}, {"url": "https://example.com/b3.jpg"}, {"url": "https://example.com/b4.jpg"}, {"url": "https://example.com/b5.jpg"}, {"url": "https://example.com/b6.jpg"}, {"url": "https://example.com/b7.jpg"}]},
            {"kind": "content", "text": "Save this video before your next trip to Porto.", "media": [{"url": "https://example.com/c0.jpg"}, {"url": "https://example.com/c1.jpg"}]},
        ],
        "schedules": {
            "id": "sched-1",
            "user_id": "user-1",
            "providers": ["youtube"],
            "youtube_account_ids": ["yt-1"],
            "personas": {
                "name": "Ana",
                "niche": "travel",
                "script_prompt": "",
                "language": "en",
                "video_aspect": "9:16",
                "photo_path": "user-1/foto.png",
                "avatar_url": None,
                "voice_id": "calm",
                "voice_audio_path": None,
                "paragraph_number": 1,
                "face_quality": "ok",
            },
        },
    }
    slot.update(extra)
    return slot


def _error_messages(logger_mock):
    return [str(call.args[0]) for call in logger_mock.error.call_args_list]


class DispatchFailureRefundTests(unittest.TestCase):
    def _run(self, refund):
        store = _GenerateStore(_slot(charged_tokens=2), refund)
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=MagicMock(), publish_video=MagicMock()
        )
        with patch.object(gen_module, "logger") as log, patch.object(
            scheduler.generator,
            "_dispatch_generation",
            side_effect=RuntimeError("engine rejected"),
        ):
            scheduler.generate(NOW)
        return store, log

    def _failed_error(self, store):
        failed = [f for _, f in store.updates if f.get("status") == "failed"]
        self.assertEqual(len(failed), 1)
        return failed[0]["error"]

    def test_dispatch_failure_keeps_the_dispatch_error_when_the_refund_raises(self):
        store, log = self._run(RuntimeError("refund rpc 500"))
        error = self._failed_error(store)
        self.assertIn("engine rejected", error)
        self.assertNotIn("refund rpc 500", error)
        self.assertTrue(
            any("refund failed" in m and "slot-1" in m for m in _error_messages(log))
        )

    def test_dispatch_failure_logs_a_not_applied_refund(self):
        store, log = self._run(False)
        self._failed_error(store)
        self.assertTrue(
            any("refund not applied" in m for m in _error_messages(log))
        )

    def test_dispatch_failure_with_a_landed_refund_logs_no_refund_error(self):
        with patch.object(gen_module, "track_refund_issued") as tracked:
            store, log = self._run(True)
        self._failed_error(store)
        tracked.assert_called_once()
        self.assertFalse([m for m in _error_messages(log) if "refund" in m])


class _ReconcileStore:
    def __init__(self, slots, failing_update=None, failing_refund=None):
        self._slots = slots
        self._failing_update = failing_update
        self._failing_refund = failing_refund
        self.updates = []
        self.refunds = []

    def generating_slots(self):
        return self._slots

    def update_slot(self, slot_id, **fields):
        if slot_id == self._failing_update:
            raise ValueError("check violation")
        self.updates.append((slot_id, fields))

    def refund_batch_tokens(
        self, user_id, generation_id, refund_key, amount, reason, engine_task_id=None
    ):
        slot_id = refund_key.split(":slot:")[1]
        if slot_id == self._failing_refund:
            raise RuntimeError("refund rpc 500")
        self.refunds.append(slot_id)
        return True


def _generating(slot_id):
    return {
        "id": slot_id,
        "task_id": f"task-{slot_id}",
        "schedule_id": "sched-1",
        "charged_tokens": 2,
        "title": "t",
        "schedules": {"user_id": "user-1"},
    }


def _state(state):
    task_state = MagicMock()
    task_state.get_task.return_value = {"state": state, "error": "boom"}
    return task_state


class PersistedHookRefundTests(unittest.TestCase):
    def test_persisted_slot_with_short_hook_refunds_instead_of_burning_the_slot(self):
        slot = _slot(charged_tokens=2)
        slot["segments"][0]["text"] = (
            "Stop wasting your trip stuck in a ninety minute line for the "
            "original dish when a better table waits nearby."
        )
        store = _GenerateStore(slot, True)
        refund_calls = []
        store.refund_batch_tokens = lambda *args, **kwargs: (
            refund_calls.append(args) or True
        )
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=MagicMock(), publish_video=MagicMock()
        )
        with patch.object(
            scheduler.generator, "_dispatch_generation"
        ) as dispatch_generation:
            enqueued = scheduler.generate(NOW)

        self.assertEqual(enqueued, 0)
        dispatch_generation.assert_not_called()
        self.assertEqual(len(refund_calls), 1)
        self.assertEqual(refund_calls[0][3], 2)
        failed = [f for _, f in store.updates if f.get("status") == "failed"]
        self.assertEqual(len(failed), 1)
        self.assertIn("Hook must have 25", failed[0]["error"])


class ReconcileIsolationTests(unittest.TestCase):
    def _slots(self):
        return [_generating("slot-bad"), _generating("slot-good")]

    def test_one_slot_raising_does_not_block_the_next_slot(self):
        store = _ReconcileStore(self._slots(), failing_update="slot-bad")
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=_state(1), publish_video=MagicMock()
        )
        with patch.object(reconcile_module, "logger") as log:
            updated = scheduler.reconcile(NOW)
        self.assertEqual(updated, 1)
        self.assertEqual(store.updates, [("slot-good", {"status": "ready"})])
        self.assertTrue(any("slot-bad" in m for m in _error_messages(log)))

    def test_connection_failure_still_aborts_the_stage(self):
        store = _ReconcileStore(self._slots())
        task_state = MagicMock()
        task_state.get_task.side_effect = requests.exceptions.ConnectionError()
        with self.assertRaises(requests.exceptions.ConnectionError):
            BatchReconciler(store, task_state).run(NOW)

    def test_refund_raising_on_a_failed_task_is_isolated(self):
        store = _ReconcileStore(self._slots(), failing_refund="slot-bad")
        with patch.object(reconcile_module, "logger") as log, patch.object(
            reconcile_module, "notify_owner_async"
        ):
            updated = BatchReconciler(store, _state(-1)).run(NOW)
        self.assertEqual(updated, 1)
        self.assertEqual(store.refunds, ["slot-good"])
        self.assertEqual([s for s, _ in store.updates], ["slot-good"])
        self.assertEqual(store.updates[0][1]["status"], "failed")
        self.assertTrue(any("slot-bad" in m for m in _error_messages(log)))


if __name__ == "__main__":
    unittest.main()

"""Batch fill-schedule dispatch shares the task-manager concurrency cap.

Issue #445: one tick used to start a pipeline thread per pending slot.
These tests pin the cap: with max_concurrent_tasks=N and M>N pending
slots, one tick admits at most N, the rest stay pending, a later tick
after completions admits more, boot triage plus the first tick still
respects the cap, and a slot is never dispatched twice.
"""

from __future__ import annotations

import os
import threading
import time
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from app.controllers.manager.memory_manager import InMemoryTaskManager
from app.controllers.v1 import video as video_controller
from app.services.fill_schedule.batch_admission import (
    SlotDeferred,
    free_running_slots,
    pending_page_limit,
    read_pending_slots,
    submit_batch_start,
)
from app.services.fill_schedule.constants import SLOT_GENERATING, SLOT_PENDING
from app.models import const
from app.services.fill_schedule.generate import BatchGenerator, new_task_id
from app.services.fill_schedule.store import ScheduleStore
from app.services.orphan_requeue import triage_orphan, triage_requeue
from app.services.state import MemoryState

UTC = timezone.utc
NOW = datetime(2026, 9, 6, 12, 0, tzinfo=UTC)

_SEGMENTS = [
    {
        "kind": "hook",
        "text": (
            "Stop wasting your trip stuck in a ninety minute line for the "
            "original dish when a better table is waiting nearby for you today "
            "before the lunch crowd arrives."
        ),
        "media": [
            {"url": "https://example.com/h0.jpg"},
            {"url": "https://example.com/h1.jpg"},
            {"url": "https://example.com/h2.jpg"},
            {"url": "https://example.com/h3.jpg"},
        ],
    },
    {
        "kind": "content",
        "text": (
            "Locals skip the famous house and walk two minutes to a smaller "
            "kitchen where the sauce recipe has not changed since nineteen "
            "fifty three and the cook still greets every table by name before "
            "the first plate arrives at your table tonight."
        ),
        "media": [
            {"url": "https://example.com/b0.jpg"},
            {"url": "https://example.com/b1.jpg"},
            {"url": "https://example.com/b2.jpg"},
            {"url": "https://example.com/b3.jpg"},
            {"url": "https://example.com/b4.jpg"},
            {"url": "https://example.com/b5.jpg"},
        ],
    },
    {
        "kind": "content",
        "text": "Save this video before your next trip to Porto.",
        "media": [
            {"url": "https://example.com/c0.jpg"},
            {"url": "https://example.com/c1.jpg"},
        ],
    },
]


def _slot(index: int, status: str = SLOT_PENDING) -> dict:
    """One prepaid pending slot. slot_at order is the dispatch order."""
    return {
        "id": f"slot-{index}",
        "slot_at": f"2026-09-08T09:00:{index:02d}+00:00",
        "title": f"Batch title {index}",
        "description": "Agent description.",
        "video_type": "faceless",
        "charged_tokens": 2,
        "status": status,
        "segments": _SEGMENTS,
        "schedules": {
            "id": "sched-batch-1",
            "user_id": "user-1",
            "providers": ["youtube"],
            "youtube_account_ids": ["yt-1"],
            "post_voice_id": "calm",
            "post_language": "en",
            "post_niche": "travel",
            "personas": {
                "name": "Ana",
                "niche": "travel",
                "language": "en",
                "voice_id": "calm",
            },
        },
    }


class _MemorySlots:
    """In-memory scheduled_posts: pending_slots returns only pending rows."""

    def __init__(self, slots: list[dict]) -> None:
        self.slots = {slot["id"]: slot for slot in slots}
        self.refund_batch_calls: list[tuple] = []

    def pending_slots(self, now, limit):
        rows = [slot for slot in self.slots.values() if slot.get("status") == SLOT_PENDING]
        return sorted(rows, key=lambda slot: slot["slot_at"])

    def update_slot(self, slot_id, **fields):
        self.slots[slot_id].update(fields)

    def get_slot(self, slot_id):
        return self.slots.get(slot_id)

    def refund_batch_tokens(self, *args, **kwargs):
        self.refund_batch_calls.append((args, kwargs))
        return True

    def signed_url(self, bucket, path):
        return "https://signed.example/photo.png"


def _statuses(store: _MemorySlots) -> dict[str, str]:
    return {slot_id: slot["status"] for slot_id, slot in store.slots.items()}


def _boot_triage(state: MemoryState, store: _MemorySlots) -> list[str]:
    """Fail the non-terminal rows boot reconcile would fail.

    Mirrors ``reconcile_orphaned_tasks``: ``triage_orphan`` claims a row
    or the caller marks it failed. A claimed row is not a refund.
    """
    failed: list[str] = []
    tasks, _total = state.get_all_tasks(1, 100)
    for task in tasks:
        if task.get("state") in (const.TASK_STATE_FAILED, const.TASK_STATE_COMPLETE):
            continue
        task_id = str(task["task_id"])
        data = {
            key: value
            for key, value in task.items()
            if key not in ("state", "progress")
        }
        if triage_orphan(state, task_id, data, store):
            continue
        failed.append(task_id)
        state.update_task(task_id, state=const.TASK_STATE_FAILED)
        slot_id = data.get("slot_id")
        slot = store.get_slot(slot_id) if isinstance(slot_id, str) else None
        if isinstance(slot, dict):
            store.refund_batch_tokens(
                "user-1",
                "batch:sched-batch-1",
                f"batch:sched-batch-1:slot:{slot_id}",
                2,
                "engine restarted while the task was still running",
                engine_task_id=task_id,
            )
    return failed


class BatchDispatchCapTests(unittest.TestCase):
    """One tick admits at most max_concurrent_tasks pending batch slots."""

    def setUp(self):
        self.release = threading.Event()
        self.started: list[str] = []
        self.started_lock = threading.Lock()
        self.saved_manager = video_controller.task_manager

    def tearDown(self):
        self.release.set()
        video_controller.task_manager = self.saved_manager

    def _worker(self, task_id, params, stop_at="video"):
        with self.started_lock:
            self.started.append(task_id)
        self.release.wait(5)

    def _generator(self, store: _MemorySlots, manager: InMemoryTaskManager) -> BatchGenerator:
        video_controller.task_manager = manager
        return BatchGenerator(store=store, task_state=MagicMock(), notify=MagicMock())

    def _run(self, generator: BatchGenerator):
        with patch("app.services.fill_schedule.generate.tm.start", self._worker):
            return generator.run(NOW)

    def _wait_started(self, count: int, timeout: float = 1.0) -> int:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            with self.started_lock:
                if len(self.started) >= count:
                    return len(self.started)
            time.sleep(0.01)
        with self.started_lock:
            return len(self.started)

    def test_one_tick_admits_at_most_max_concurrent_and_leaves_the_rest_pending(self):
        # N running slots, a queue large enough to absorb the overflow, and
        # M>N pending rows. The overflow must stay pending: queue room is
        # not a reason to take every row on this tick.
        concurrent = 2
        pending = 5
        manager = InMemoryTaskManager(max_concurrent_tasks=concurrent, max_queued_tasks=10)
        store = _MemorySlots([_slot(index) for index in range(pending)])
        generator = self._generator(store, manager)

        admitted = self._run(generator)

        self.assertEqual(admitted, concurrent)
        self.assertEqual(manager.current_tasks, concurrent)
        self.assertEqual(manager.queue_size(), 0)
        self.assertEqual(self._wait_started(concurrent + 1, timeout=0.4), concurrent)
        statuses = _statuses(store)
        self.assertEqual(
            sum(1 for status in statuses.values() if status == SLOT_GENERATING),
            concurrent,
        )
        self.assertEqual(
            sum(1 for status in statuses.values() if status == SLOT_PENDING),
            pending - concurrent,
        )
        self.assertNotIn("failed", statuses.values())
        self.assertEqual(store.refund_batch_calls, [])
        # Soonest slot_at wins the free slots.
        self.assertEqual(statuses["slot-0"], SLOT_GENERATING)
        self.assertEqual(statuses["slot-1"], SLOT_GENERATING)
        self.assertEqual(statuses["slot-2"], SLOT_PENDING)

    def test_later_tick_after_completions_admits_more_without_double_dispatch(self):
        concurrent = 2
        pending = 5
        manager = InMemoryTaskManager(max_concurrent_tasks=concurrent, max_queued_tasks=10)
        store = _MemorySlots([_slot(index) for index in range(pending)])
        generator = self._generator(store, manager)

        first = self._run(generator)
        self.assertEqual(first, concurrent)
        self.assertEqual(self._wait_started(concurrent), concurrent)
        with self.started_lock:
            first_wave = list(self.started)

        self.release.set()
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if manager.current_tasks == 0 and manager.queue_size() == 0:
                break
            time.sleep(0.01)
        self.assertEqual(manager.current_tasks, 0)

        # A fresh hold so the second wave stays inside the manager long
        # enough to count, and does not re-enter the ids already admitted.
        self.release = threading.Event()
        second = self._run(generator)
        self.assertEqual(second, concurrent)
        self.assertEqual(self._wait_started(concurrent * 2, timeout=0.4), concurrent * 2)
        with self.started_lock:
            second_wave = [task_id for task_id in self.started if task_id not in first_wave]
        self.assertEqual(len(second_wave), concurrent)
        self.assertEqual(set(first_wave).intersection(second_wave), set())
        self.assertEqual(len(self.started), len(set(self.started)))
        self.assertEqual(
            sum(1 for status in _statuses(store).values() if status == SLOT_PENDING),
            pending - concurrent * 2,
        )
        self.assertEqual(store.refund_batch_calls, [])

    def test_occupied_manager_defers_every_pending_slot(self):
        # A direct job already holds the only running slot. Batch work
        # shares that cap: nothing is admitted, nothing is refunded.
        manager = InMemoryTaskManager(max_concurrent_tasks=1, max_queued_tasks=10)
        held = threading.Event()

        def hold():
            held.wait(5)

        manager.add_task(hold)
        self.addCleanup(held.set)
        store = _MemorySlots([_slot(index) for index in range(3)])
        generator = self._generator(store, manager)

        admitted = self._run(generator)

        self.assertEqual(admitted, 0)
        self.assertEqual(manager.current_tasks, 1)
        self.assertEqual(manager.queue_size(), 0)
        self.assertEqual(self._wait_started(1, timeout=0.3), 0)
        self.assertTrue(all(status == SLOT_PENDING for status in _statuses(store).values()))
        self.assertEqual(store.refund_batch_calls, [])

    def test_restart_triage_then_first_tick_respects_the_cap(self):
        # Boot resets every generating batch slot to pending. The first
        # tick after that reset still admits at most N, not one pipeline
        # per in-flight slot.
        concurrent = 1
        pending = 4
        manager = InMemoryTaskManager(max_concurrent_tasks=concurrent, max_queued_tasks=10)
        store = _MemorySlots(
            [_slot(index, status=SLOT_GENERATING) for index in range(pending)]
        )
        state = MagicMock()
        for index in range(pending):
            claimed = triage_requeue(
                state,
                store,
                f"old-task-{index}",
                {"slot_id": f"slot-{index}", "stage": "render", "requeue_count": 0},
            )
            self.assertTrue(claimed)
        self.assertTrue(all(status == SLOT_PENDING for status in _statuses(store).values()))

        generator = self._generator(store, manager)
        admitted = self._run(generator)

        self.assertEqual(admitted, concurrent)
        self.assertEqual(manager.current_tasks, concurrent)
        self.assertEqual(self._wait_started(concurrent + 1, timeout=0.4), concurrent)
        self.assertEqual(
            sum(1 for status in _statuses(store).values() if status == SLOT_PENDING),
            pending - concurrent,
        )
        self.assertEqual(store.refund_batch_calls, [])

    def test_manager_rejection_leaves_the_slot_pending_without_a_refund(self):
        # Free running slots say the tick may try, then the manager
        # rejects. That is a deferral: pending, not failed, no refund.
        class _RejectManager:
            max_concurrent_tasks = 2
            current_tasks = 0

            def queue_size(self):
                return 0

            def try_reserve_running(self):
                return None

        store = _MemorySlots([_slot(0), _slot(1)])
        generator = self._generator(store, _RejectManager())
        admitted = self._run(generator)
        self.assertEqual(admitted, 0)
        self.assertTrue(all(status == SLOT_PENDING for status in _statuses(store).values()))
        self.assertEqual(store.refund_batch_calls, [])
        self.assertEqual(self._wait_started(1, timeout=0.2), 0)

    def test_full_running_cap_defers_instead_of_filling_the_queue(self):
        # The page was sized as if one running slot were free, then a
        # direct job took it. Batch dispatch does not fill the queue:
        # every slot stays pending, and no task row is written.
        manager = InMemoryTaskManager(max_concurrent_tasks=1, max_queued_tasks=5)
        direct = threading.Event()
        manager.add_task(lambda: direct.wait(5))
        self.addCleanup(direct.set)
        store = _MemorySlots([_slot(index) for index in range(3)])
        state = MemoryState()
        generator = self._generator(store, manager)
        generator.task_state = state
        with patch(
            "app.services.fill_schedule.generate.free_running_slots", return_value=1
        ):
            admitted = self._run(generator)
        self.assertEqual(admitted, 0)
        self.assertEqual(manager.queue_size(), 0)
        self.assertEqual(manager.current_tasks, 1)
        self.assertTrue(all(status == SLOT_PENDING for status in _statuses(store).values()))
        self.assertEqual(store.refund_batch_calls, [])
        for slot in store.slots.values():
            self.assertIsNone(state.get_task(new_task_id(slot)))

    def test_rejected_admission_leaves_no_task_row_for_boot_triage(self):
        # The tick still tries one slot, then the manager cannot start it
        # (running cap taken, queue unable to absorb). The slot stays
        # pending and the memory task state has no row for its task id.
        # Boot triage over that state therefore fails and refunds nothing.
        manager = InMemoryTaskManager(max_concurrent_tasks=1, max_queued_tasks=0)
        manager.current_tasks = 1
        store = _MemorySlots([_slot(0)])
        state = MemoryState()
        generator = self._generator(store, manager)
        generator.task_state = state
        with patch(
            "app.services.fill_schedule.generate.free_running_slots", return_value=1
        ):
            admitted = self._run(generator)

        self.assertEqual(admitted, 0)
        self.assertEqual(_statuses(store)["slot-0"], SLOT_PENDING)
        self.assertEqual(store.refund_batch_calls, [])
        task_id = new_task_id(store.slots["slot-0"])
        self.assertIsNone(state.get_task(task_id))

        failed = _boot_triage(state, store)
        self.assertEqual(failed, [])
        self.assertEqual(store.refund_batch_calls, [])
        self.assertEqual(_statuses(store)["slot-0"], SLOT_PENDING)
        self.assertIsNone(state.get_task(task_id))

    def test_task_row_write_failure_does_not_hold_a_running_slot(self):
        # Admission reserves the running slot before the task row is
        # written. If that write raises, the reservation is released and
        # a later direct job can still take the only running slot.
        manager = InMemoryTaskManager(max_concurrent_tasks=1, max_queued_tasks=5)
        seen: list[int] = []

        class _State:
            def update_task(self, *args, **kwargs):
                seen.append(manager.current_tasks)
                raise RuntimeError("supabase down")

        store = _MemorySlots([_slot(0)])
        generator = self._generator(store, manager)
        generator.task_state = _State()
        admitted = self._run(generator)
        self.assertEqual(admitted, 0)
        self.assertEqual(seen, [1])
        self.assertEqual(manager.current_tasks, 0)
        self.assertEqual(manager.queue_size(), 0)
        release = threading.Event()
        self.addCleanup(release.set)
        manager.add_task(lambda: release.wait(2))
        self.assertEqual(manager.current_tasks, 1)


class PendingSlotReadTests(unittest.TestCase):
    """pending_slots pages in slot_at order, at the caller's limit."""

    def test_pending_slots_sends_the_caller_limit(self):
        env = {
            "SUPABASE_URL": "https://supabase.example",
            "SUPABASE_SERVICE_ROLE_KEY": "service-key",
        }
        with patch.dict(os.environ, env, clear=False):
            store = ScheduleStore(requests_module=MagicMock())
        response = MagicMock()
        response.status_code = 200
        response.content = b"[]"
        response.json.return_value = []
        response.raise_for_status.return_value = None
        store._requests.request.return_value = response

        store.pending_slots(NOW, limit=2)

        params = store._requests.request.call_args.kwargs["params"]
        self.assertEqual(params["order"], "slot_at.asc")
        self.assertEqual(params["status"], f"eq.{SLOT_PENDING}")
        self.assertEqual(params["limit"], "2")

    def test_pending_slots_sends_limit_zero(self):
        env = {
            "SUPABASE_URL": "https://supabase.example",
            "SUPABASE_SERVICE_ROLE_KEY": "service-key",
        }
        with patch.dict(os.environ, env, clear=False):
            store = ScheduleStore(requests_module=MagicMock())
        response = MagicMock()
        response.status_code = 200
        response.content = b"[]"
        response.json.return_value = []
        response.raise_for_status.return_value = None
        store._requests.request.return_value = response
        store.pending_slots(NOW, limit=0)
        params = store._requests.request.call_args.kwargs["params"]
        self.assertEqual(params["limit"], "0")
        self.assertEqual(params["order"], "slot_at.asc")


class BatchAdmissionHelperTests(unittest.TestCase):
    """Direct tests for batch_admission.py (mutmut attributes this file)."""

    def test_free_running_slots_is_the_unused_cap(self):
        manager = InMemoryTaskManager(max_concurrent_tasks=2, max_queued_tasks=10)
        self.assertEqual(free_running_slots(manager), 2)
        manager.current_tasks = 1
        self.assertEqual(free_running_slots(manager), 1)
        manager.current_tasks = 2
        self.assertEqual(free_running_slots(manager), 0)
        manager.current_tasks = 3
        self.assertEqual(free_running_slots(manager), 0)

    def test_pending_page_limit_accepts_only_non_negative_ints(self):
        self.assertEqual(pending_page_limit(4), 4)
        self.assertEqual(pending_page_limit(0), 0)
        self.assertEqual(pending_page_limit(True), 0)
        self.assertEqual(pending_page_limit(-3), 0)
        self.assertEqual(pending_page_limit(None), 0)

    def test_read_pending_slots_returns_empty_when_the_store_returns_a_non_list(self):
        class _Store:
            def pending_slots(self, now, limit):
                return None

        self.assertEqual(read_pending_slots(_Store(), NOW, 3), [])

    def test_read_pending_slots_does_not_query_when_there_is_no_room(self):
        called: list[object] = []

        class _Store:
            def pending_slots(self, now, limit):
                called.append(now)
                return [{"id": "a"}]

        self.assertEqual(read_pending_slots(_Store(), NOW, 0), [])
        self.assertEqual(called, [])

    def test_read_pending_slots_slices_a_store_that_ignores_limit(self):
        class _Store:
            def pending_slots(self, now, limit):
                return [{"id": "a"}, {"id": "b"}, {"id": "c"}, "junk"]

        self.assertEqual(
            read_pending_slots(_Store(), NOW, 2),
            [{"id": "a"}, {"id": "b"}],
        )

    def test_read_pending_slots_passes_limit_when_the_store_accepts_it(self):
        seen: dict[str, int | None] = {}

        class _Store:
            def pending_slots(self, now, limit=None):
                seen["limit"] = limit
                return [{"id": "a"}, {"id": "b"}, {"id": "c"}]

        self.assertEqual(read_pending_slots(_Store(), NOW, 1), [{"id": "a"}])
        self.assertEqual(seen["limit"], 1)

    def test_submit_starts_immediately_when_a_running_slot_is_free(self):
        manager = InMemoryTaskManager(max_concurrent_tasks=1, max_queued_tasks=2)
        release = threading.Event()
        self.addCleanup(release.set)
        started: list[str] = []

        def work(**kwargs):
            started.append(kwargs["task_id"])
            release.wait(2)

        submit_batch_start(
            manager,
            work,
            task_id="batch-1",
            params=object(),
        )
        self.assertEqual(manager.current_tasks, 1)
        self.assertEqual(manager.queue_size(), 0)
        deadline = time.monotonic() + 1
        while time.monotonic() < deadline and not started:
            time.sleep(0.01)
        self.assertEqual(started, ["batch-1"])

    def test_row_write_runs_outside_the_manager_lock(self):
        # The manager lock is not reentrant. The task-row write must be
        # able to take it, which it can only do when submit is not holding
        # it across the write.
        manager = InMemoryTaskManager(max_concurrent_tasks=1, max_queued_tasks=1)
        release = threading.Event()
        self.addCleanup(release.set)
        held: list[bool] = []

        def before_start():
            got = manager.lock.acquire(timeout=0.2)
            held.append(got)
            if got:
                manager.lock.release()

        submit_batch_start(
            manager,
            lambda **kwargs: release.wait(2),
            task_id="batch-1",
            params=object(),
            before_start=before_start,
        )
        self.assertEqual(held, [True])
        self.assertEqual(manager.current_tasks, 1)

    def test_submit_releases_the_slot_when_on_accepted_raises(self):
        # The task row is written, then the funnel callback raises. The
        # reservation must come back before the error propagates: no
        # worker, and the running cap is not held.
        manager = InMemoryTaskManager(max_concurrent_tasks=1, max_queued_tasks=2)
        wrote: list[int] = []
        started: list[str] = []

        def before_start() -> None:
            wrote.append(manager.current_tasks)

        def on_accepted() -> None:
            raise RuntimeError("funnel event failed")

        with self.assertRaises(RuntimeError) as caught:
            submit_batch_start(
                manager,
                lambda **kwargs: started.append(kwargs["task_id"]),
                task_id="batch-1",
                params=object(),
                before_start=before_start,
                on_accepted=on_accepted,
            )
        self.assertEqual(str(caught.exception), "funnel event failed")
        self.assertEqual(wrote, [1])
        self.assertEqual(started, [])
        self.assertEqual(manager.current_tasks, 0)
        self.assertEqual(manager.queue_size(), 0)
        release = threading.Event()
        self.addCleanup(release.set)
        manager.add_task(lambda: release.wait(2))
        self.assertEqual(manager.current_tasks, 1)
        self.assertEqual(manager.queue_size(), 0)

    def test_submit_defers_when_the_running_cap_is_full(self):
        # Queue room is not admission. A batch slot only starts now.
        manager = InMemoryTaskManager(max_concurrent_tasks=1, max_queued_tasks=2)
        release = threading.Event()
        manager.add_task(lambda: release.wait(2))
        self.addCleanup(release.set)
        with self.assertRaises(SlotDeferred):
            submit_batch_start(
                manager,
                lambda **kwargs: None,
                task_id="batch-1",
                params=object(),
            )
        self.assertEqual(manager.current_tasks, 1)
        self.assertEqual(manager.queue_size(), 0)

    def test_submit_raises_slot_deferred_when_the_queue_is_full(self):
        manager = InMemoryTaskManager(max_concurrent_tasks=0, max_queued_tasks=0)
        with self.assertRaises(SlotDeferred):
            submit_batch_start(
                manager,
                lambda **kwargs: None,
                task_id="batch-1",
                params=object(),
            )
        self.assertEqual(manager.current_tasks, 0)
        self.assertEqual(manager.queue_size(), 0)

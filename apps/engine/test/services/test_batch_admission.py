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

from app.controllers.manager.base_manager import TaskQueueFullError
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
from app.services.fill_schedule.generate import BatchGenerator, new_task_id
from app.services.fill_schedule.store import ScheduleStore
from app.services.orphan_requeue import triage_requeue

UTC = timezone.utc
NOW = datetime(2026, 9, 6, 12, 0, tzinfo=UTC)

_SEGMENTS = [
    {
        "kind": "hook",
        "text": (
            "Stop wasting your trip stuck in a ninety minute line for the "
            "original dish when a better table is waiting nearby for you today."
        ),
        "media": [
            {"url": "https://example.com/h0.jpg"},
            {"url": "https://example.com/h1.jpg"},
            {"url": "https://example.com/h2.jpg"},
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

    def pending_slots(self, now):
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

            def add_task(self, func, *args, **kwargs):
                raise TaskQueueFullError("task queue is full, please try again later")

        store = _MemorySlots([_slot(0), _slot(1)])
        generator = self._generator(store, _RejectManager())
        admitted = self._run(generator)
        self.assertEqual(admitted, 0)
        self.assertTrue(all(status == SLOT_PENDING for status in _statuses(store).values()))
        self.assertEqual(store.refund_batch_calls, [])
        self.assertEqual(self._wait_started(1, timeout=0.2), 0)

    def test_queued_acceptance_is_claimed_and_not_redispatched(self):
        # The running cap is already taken, but this tick still submits
        # one slot (the budget says so) and the manager queues it. The
        # slot leaves pending. A later tick that walks the pending rows
        # again must not submit that same task id a second time.
        manager = InMemoryTaskManager(max_concurrent_tasks=1, max_queued_tasks=5)
        direct = threading.Event()
        manager.add_task(lambda: direct.wait(5))
        self.addCleanup(direct.set)
        store = _MemorySlots([_slot(index) for index in range(3)])
        generator = self._generator(store, manager)
        with patch(
            "app.services.fill_schedule.generate.free_running_slots", return_value=1
        ):
            admitted = self._run(generator)
        self.assertEqual(admitted, 1)
        self.assertEqual(manager.queue_size(), 1)
        self.assertEqual(_statuses(store)["slot-0"], SLOT_GENERATING)
        self.assertEqual(self._wait_started(1, timeout=0.2), 0)

        with patch(
            "app.services.fill_schedule.generate.free_running_slots", return_value=5
        ):
            again = self._run(generator)
        self.assertEqual(again, 2)
        queued_ids = [item["kwargs"]["task_id"] for item in list(manager.queue.queue)]
        slot0_task = new_task_id(store.slots["slot-0"])
        self.assertEqual(queued_ids.count(slot0_task), 1)
        self.assertEqual(len(queued_ids), 3)
        self.assertEqual(_statuses(store)["slot-0"], SLOT_GENERATING)
        self.assertNotIn(SLOT_PENDING, _statuses(store).values())
        self.assertEqual(store.refund_batch_calls, [])


class PendingSlotReadTests(unittest.TestCase):
    """pending_slots pages in slot_at order, bounded by free capacity."""

    def test_pending_slots_sends_a_limit_sized_to_free_capacity(self):
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

        manager = InMemoryTaskManager(max_concurrent_tasks=2, max_queued_tasks=10)
        with patch("app.controllers.v1.video.task_manager", manager):
            store.pending_slots(NOW)

        params = store._requests.request.call_args.kwargs["params"]
        self.assertEqual(params["order"], "slot_at.asc")
        self.assertEqual(params["status"], f"eq.{SLOT_PENDING}")
        self.assertEqual(params["limit"], "2")

    def test_pending_slots_sends_limit_zero_when_the_manager_is_full(self):
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
        manager = InMemoryTaskManager(max_concurrent_tasks=1, max_queued_tasks=10)
        manager.current_tasks = 1
        with patch("app.controllers.v1.video.task_manager", manager):
            store.pending_slots(NOW)
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

    def test_pending_page_limit_rejects_bools_and_reads_free_capacity(self):
        manager = InMemoryTaskManager(max_concurrent_tasks=2, max_queued_tasks=9)
        self.assertEqual(pending_page_limit(None, manager), 2)
        manager.current_tasks = 2
        self.assertEqual(pending_page_limit(None, manager), 0)
        self.assertEqual(pending_page_limit(4, manager), 4)
        self.assertEqual(pending_page_limit(0, manager), 0)
        self.assertEqual(pending_page_limit(True, manager), 0)
        self.assertEqual(pending_page_limit(-3, manager), 0)

    def test_read_pending_slots_does_not_query_when_there_is_no_room(self):
        called: list[object] = []

        class _Store:
            def pending_slots(self, now):
                called.append(now)
                return [{"id": "a"}]

        self.assertEqual(read_pending_slots(_Store(), NOW, 0), [])
        self.assertEqual(called, [])

    def test_read_pending_slots_slices_a_store_that_ignores_limit(self):
        class _Store:
            def pending_slots(self, now):
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

    def test_submit_queues_an_accepted_slot_instead_of_deferring(self):
        manager = InMemoryTaskManager(max_concurrent_tasks=1, max_queued_tasks=2)
        release = threading.Event()
        manager.add_task(lambda: release.wait(2))
        self.addCleanup(release.set)
        started: list[str] = []
        submit_batch_start(
            manager,
            lambda **kwargs: started.append(kwargs["task_id"]),
            task_id="batch-1",
            params=object(),
        )
        self.assertEqual(manager.queue_size(), 1)
        self.assertEqual(manager.current_tasks, 1)
        self.assertEqual(started, [])

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

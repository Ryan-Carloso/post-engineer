"""TaskManager.add_task on_accepted callback.

The video funnel entry (video_generation_requested) must fire after the
task is accepted but strictly before the worker thread starts — otherwise
PostHog timestamps video_generation_started first and the funnel drops
the conversion. The callback gives that ordering deterministically; these
tests pin it at the manager level (the controller test pins the wiring).

The concurrency slot is reserved under the manager lock, before the
worker runs. A burst of add_task calls (boot redispatch) must queue
behind max_concurrent_tasks instead of all starting at once.
"""

import sys
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.controllers.manager.base_manager import TaskManager, TaskQueueFullError
from app.controllers.manager.memory_manager import InMemoryTaskManager


class ConcreteTaskManager(TaskManager):
    def create_queue(self):
        return []

    def queue_size(self):
        return len(self.queue)

    def enqueue(self, item):
        self.queue.append(item)


class OnAcceptedTests(unittest.TestCase):
    def test_callback_fires_before_thread_start_on_immediate_path(self):
        manager = ConcreteTaskManager(max_concurrent_tasks=1)
        order = []
        manager.execute_task = lambda func, *a, **k: order.append("execute_task")
        manager.add_task(lambda: None, on_accepted=lambda: order.append("on_accepted"))
        self.assertEqual(order, ["on_accepted", "execute_task"])

    def test_callback_fires_after_enqueue_on_queued_path(self):
        manager = ConcreteTaskManager(max_concurrent_tasks=0)
        order = []
        manager.add_task(lambda: None, on_accepted=lambda: order.append("on_accepted"))
        self.assertEqual(manager.queue_size(), 1)
        self.assertEqual(order, ["on_accepted"])

    def test_callback_not_fired_on_queue_full_rejection(self):
        manager = ConcreteTaskManager(max_concurrent_tasks=0, max_queued_tasks=0)
        called = []
        with self.assertRaises(TaskQueueFullError):
            manager.add_task(lambda: None, on_accepted=lambda: called.append(True))
        self.assertEqual(called, [])

    def test_no_callback_is_backward_compatible(self):
        manager = ConcreteTaskManager(max_concurrent_tasks=1)
        executed = []
        manager.execute_task = lambda func, *a, **k: executed.append(True)
        manager.add_task(lambda: None)
        self.assertEqual(executed, [True])

    def test_reservation_released_when_spawn_raises(self):
        manager = ConcreteTaskManager(max_concurrent_tasks=1)

        def boom(*_args, **_kwargs):
            raise RuntimeError("start failed")

        manager.execute_task = boom
        with self.assertRaises(RuntimeError):
            manager.add_task(lambda: None)
        self.assertEqual(manager.current_tasks, 0)

    def test_reservation_released_when_on_accepted_raises(self):
        manager = ConcreteTaskManager(max_concurrent_tasks=1)
        started: list[bool] = []
        manager.execute_task = lambda *_a, **_k: started.append(True)

        def boom():
            raise RuntimeError("callback failed")

        with self.assertRaises(RuntimeError):
            manager.add_task(lambda: None, on_accepted=boom)
        self.assertEqual(manager.current_tasks, 0)
        # The worker must not start after the callback rejected the accept.
        self.assertEqual(started, [])


class BurstReservationTests(unittest.TestCase):
    def test_burst_reserves_one_slot_and_queues_the_rest(self):
        manager = InMemoryTaskManager(max_concurrent_tasks=1, max_queued_tasks=10)
        release = threading.Event()
        entered: list[int] = []
        lock = threading.Lock()

        def work(index: int) -> None:
            with lock:
                entered.append(index)
            release.wait(2)

        try:
            for index in range(3):
                manager.add_task(work, index)
            # Synchronous: the slot is reserved before add_task returns,
            # so this does not race the worker.
            self.assertEqual(manager.current_tasks, 1)
            self.assertEqual(manager.queue_size(), 2)
            release.set()
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                if manager.current_tasks == 0 and manager.queue_size() == 0:
                    break
                time.sleep(0.01)
            else:
                self.fail(
                    f"workers did not drain (current={manager.current_tasks}, "
                    f"queued={manager.queue_size()})"
                )
            with lock:
                self.assertEqual(sorted(entered), [0, 1, 2])
        finally:
            release.set()


if __name__ == "__main__":
    unittest.main()

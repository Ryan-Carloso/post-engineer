"""TaskManager.add_task on_accepted callback.

The video funnel entry (video_generation_requested) must fire after the
task is accepted but strictly before the worker thread starts — otherwise
PostHog timestamps video_generation_started first and the funnel drops
the conversion. The callback gives that ordering deterministically; these
tests pin it at the manager level (the controller test pins the wiring).
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.controllers.manager.base_manager import TaskManager, TaskQueueFullError


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


if __name__ == "__main__":
    unittest.main()

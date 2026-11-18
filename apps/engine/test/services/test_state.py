import sys
import threading
import unittest
from unittest.mock import MagicMock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models import const
from app.services.state import MemoryState, RedisState
from app.services.task_cancellation import is_cancelled, request_cancel


class _FakeRedis:
    def __init__(self, batches):
        self.batches = batches
        self.data = {}
        self.hset_calls = []
        self.deleted_keys = []
        for key in [key for batch in batches for key in batch]:
            index = int(key.decode("utf-8").split(":")[-1])
            self.data[key] = {
                b"task_id": key,
                b"state": b"1",
                b"progress": str(index).encode("utf-8"),
            }

    def scan(self, cursor, count):
        batch_index = int(cursor)
        next_cursor = batch_index + 1
        if next_cursor >= len(self.batches):
            next_cursor = 0
        return next_cursor, self.batches[batch_index]

    def hgetall(self, key):
        if isinstance(key, str):
            key = key.encode("utf-8")
        return self.data.get(key, {})

    def hset(self, key, field, value):
        self.hset_calls.append((key, field, value))
        if isinstance(key, str):
            key = key.encode("utf-8")
        if isinstance(field, str):
            field = field.encode("utf-8")
        if isinstance(value, str):
            value = value.encode("utf-8")
        self.data.setdefault(key, {})[field] = value

    def delete(self, key):
        if isinstance(key, str):
            key = key.encode("utf-8")
        self.data.pop(key, None)
        self.deleted_keys.append(key)


class TestMemoryState(unittest.TestCase):
    def test_progress_is_capped_and_missing_tasks_are_safe(self):
        state = MemoryState()
        state.update_task("task-1", progress=125)

        self.assertEqual(state.get_task("task-1")["progress"], 100)
        self.assertEqual(state.get_all_tasks(page=2, page_size=10), ([], 1))
        state.delete_task("task-1")
        state.delete_task("missing")
        self.assertIsNone(state.get_task("task-1"))

    def test_tasks_are_isolated_by_user(self):
        state = MemoryState()
        state.update_task("alice-task", user_id="alice")
        state.update_task("bob-task", user_id="bob")

        tasks, total = state.get_all_tasks(page=1, page_size=10, user_id="alice")

        self.assertEqual(total, 1)
        self.assertEqual([task["task_id"] for task in tasks], ["alice-task"])
        self.assertIsNone(state.get_task("bob-task", user_id="alice"))

    def test_get_task_and_get_all_tasks_return_isolated_snapshots(self):
        state = MemoryState()
        state.update_task(
            "task-1",
            state=const.TASK_STATE_PROCESSING,
            progress=25,
            videos=["first.mp4"],
        )

        task = state.get_task("task-1")
        task["videos"].append("mutated.mp4")

        tasks, total = state.get_all_tasks(page=1, page_size=10)
        tasks[0]["videos"].append("mutated-again.mp4")

        self.assertEqual(total, 1)
        self.assertEqual(state.get_task("task-1")["videos"], ["first.mp4"])

    def test_kwargs_only_update_preserves_state_and_progress(self):
        state = MemoryState()
        state.update_task(
            "task-1", state=const.TASK_STATE_PROCESSING, progress=40
        )
        state.update_task("task-1", music_mood="chill")

        task = state.get_task("task-1")
        self.assertEqual(task["progress"], 40)
        self.assertEqual(task["state"], const.TASK_STATE_PROCESSING)
        self.assertEqual(task["music_mood"], "chill")

    def test_explicit_progress_zero_still_resets(self):
        state = MemoryState()
        state.update_task("task-1", progress=40)
        state.update_task("task-1", progress=0)

        self.assertEqual(state.get_task("task-1")["progress"], 0)

    def test_stage_only_update_preserves_state_and_progress(self):
        state = MemoryState()
        state.update_task(
            "task-1", state=const.TASK_STATE_PROCESSING, progress=50
        )
        state.update_task("task-1", stage="music_mood")

        task = state.get_task("task-1")
        self.assertEqual(task["progress"], 50)
        self.assertEqual(task["state"], const.TASK_STATE_PROCESSING)
        self.assertEqual(task["stage"], "music_mood")

    def test_concurrent_memory_updates_are_preserved(self):
        state = MemoryState()
        thread_count = 5
        tasks_per_thread = 50

        def update_tasks(thread_index):
            for task_index in range(tasks_per_thread):
                state.update_task(
                    f"task-{thread_index}-{task_index}",
                    state=const.TASK_STATE_PROCESSING,
                    progress=task_index,
                )

        threads = [
            threading.Thread(target=update_tasks, args=(thread_index,))
            for thread_index in range(thread_count)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        tasks, total = state.get_all_tasks(page=1, page_size=thread_count * tasks_per_thread)

        self.assertEqual(total, thread_count * tasks_per_thread)
        self.assertEqual(len(tasks), total)


class TestRedisState(unittest.TestCase):
    def _build_state(self, batch_sizes):
        keys = [f"task:{i}".encode("utf-8") for i in range(sum(batch_sizes))]
        batches = []
        offset = 0
        for batch_size in batch_sizes:
            batches.append(keys[offset : offset + batch_size])
            offset += batch_size

        state = RedisState.__new__(RedisState)
        state._redis = _FakeRedis(batches)
        state._lock = threading.RLock()
        return state

    def test_get_all_tasks_paginates_across_scan_batches(self):
        """
        When Redis SCAN returns keys in batches, the page slice is taken
        from the full collected list, not from the current batch alone.

        Reproduces the 18-task, page_size=10 case: a first batch of 10 keys
        and a second of 8. The old logic returned an empty first page and
        only 2 rows on the second; the fix returns 10, then the remaining 8.
        """
        state = self._build_state([10, 8])

        first_page, first_total = state.get_all_tasks(page=1, page_size=10)
        second_page, second_total = state.get_all_tasks(page=2, page_size=10)

        self.assertEqual(first_total, 18)
        self.assertEqual(second_total, 18)
        self.assertEqual(len(first_page), 10)
        self.assertEqual(len(second_page), 8)
        self.assertEqual(
            [task["task_id"] for task in first_page],
            [f"task:{i}" for i in range(10)],
        )
        self.assertEqual(
            [task["task_id"] for task in second_page],
            [f"task:{i}" for i in range(10, 18)],
        )

    def test_kwargs_only_update_preserves_state_and_progress(self):
        state = self._build_state([1])
        state.update_task("task:0", state=const.TASK_STATE_PROCESSING, progress=40)
        state.update_task("task:0", music_mood="chill")

        task = state.get_task("task:0")
        self.assertEqual(task["progress"], 40)
        self.assertEqual(task["state"], const.TASK_STATE_PROCESSING)
        self.assertEqual(task["music_mood"], "chill")

    def test_cancelled_update_writes_nothing_to_redis(self):
        state = self._build_state([1])
        request_cancel("task:0")
        state.update_task("task:0", state=const.TASK_STATE_COMPLETE, progress=100)
        self.assertEqual(state._redis.hset_calls, [])

    def test_delete_task_marks_cancelled_and_removes_row(self):
        state = self._build_state([1])
        self.assertIsNotNone(state.get_task("task:0"))
        state.delete_task("task:0")
        self.assertTrue(is_cancelled("task:0"))
        self.assertIsNone(state.get_task("task:0"))
        self.assertEqual(state._redis.deleted_keys, [b"task:0"])

    def test_failed_delete_clears_the_cancel_mark(self):
        state = self._build_state([1])
        state._redis.delete = MagicMock(side_effect=ConnectionError("redis down"))
        with self.assertRaises(ConnectionError):
            state.delete_task("task:0")
        self.assertFalse(is_cancelled("task:0"))


if __name__ == "__main__":
    unittest.main()

import sys
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models import const
from app.services.state import MemoryState, RedisState


class _FakeRedis:
    def __init__(self, batches):
        self.batches = batches
        self.data = {}
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
        if isinstance(key, str):
            key = key.encode("utf-8")
        if isinstance(field, str):
            field = field.encode("utf-8")
        if isinstance(value, str):
            value = value.encode("utf-8")
        self.data.setdefault(key, {})[field] = value


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
        # Regression: a kwargs-only update_task() call (e.g. setting
        # music_mood mid-pipeline) must not reset progress to 0 — the web
        # once showed 40% (subtitle) dropping to 0% (music_mood) because of it.
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
        return state

    def test_get_all_tasks_paginates_across_scan_batches(self):
        """
        Redis SCAN 分批返回 key 时，分页切片必须按当前批次起始位置计算。

        这个用例复现 PR #890 描述的 18 条任务、page_size=10 场景：
        第一批 10 条，第二批 8 条。旧逻辑第一页会返回空列表，第二页
        只返回 2 条；修复后第一页返回 10 条，第二页返回剩余 8 条。
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
        # Same regression as the MemoryState case: setting music_mood must
        # not reset progress to 0.
        state = self._build_state([1])
        state.update_task("task:0", state=const.TASK_STATE_PROCESSING, progress=40)
        state.update_task("task:0", music_mood="chill")

        task = state.get_task("task:0")
        self.assertEqual(task["progress"], 40)
        self.assertEqual(task["state"], const.TASK_STATE_PROCESSING)
        self.assertEqual(task["music_mood"], "chill")

    def test_convert_values_preserves_literals_and_converts_numbers(self):
        self.assertEqual(RedisState._convert_to_original_type(b"['clip.mp4']"), ["clip.mp4"])
        self.assertEqual(RedisState._convert_to_original_type(b"42"), 42)
        self.assertEqual(RedisState._convert_to_original_type(b"ready"), "ready")


if __name__ == "__main__":
    unittest.main()

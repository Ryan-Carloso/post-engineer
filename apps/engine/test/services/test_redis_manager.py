import json
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.controllers.manager import redis_manager
from app.models.schema import VideoParams
from app.services import remote_dispatch, task as tm


class FakeRedis:
    def __init__(self):
        self.lists = {}

    def rpush(self, key, value):
        self.lists.setdefault(key, []).append(value)
        return len(self.lists[key])

    def lpop(self, key):
        if not self.lists.get(key):
            return None
        return self.lists[key].pop(0)

    def llen(self, key):
        return len(self.lists.get(key, []))


def make_manager():
    fake = FakeRedis()
    with patch.object(redis_manager.redis.Redis, "from_url", return_value=fake):
        manager = redis_manager.RedisTaskManager(2, "redis://fake")
    assert manager.redis_client is fake
    return manager, fake


def test_create_queue_names_the_task_queue():
    manager, _ = make_manager()
    assert manager.create_queue() == "task_queue"
    assert manager.queue == "task_queue"


def test_enqueue_serializes_func_name_and_params():
    manager, fake = make_manager()
    params = VideoParams(
        video_title="test", video_description="Test description.", video_type="faceless"
    )
    manager.enqueue({"func": tm.start, "args": ("task-1",), "kwargs": {"params": params}})

    assert manager.queue_size() == 1
    stored = json.loads(fake.lists["task_queue"][0])
    assert stored["func"] == "start"
    assert stored["args"] == ["task-1"]
    assert stored["kwargs"]["params"] == params.dict()


def test_enqueue_without_video_params_keeps_kwargs():
    manager, fake = make_manager()
    manager.enqueue({"func": tm.start, "args": (), "kwargs": {"note": "hi"}})

    stored = json.loads(fake.lists["task_queue"][0])
    assert stored["kwargs"] == {"note": "hi"}


def test_dequeue_restores_func_and_params():
    manager, _ = make_manager()
    params = VideoParams(
        video_title="test", video_description="Test description.", video_type="faceless"
    )
    manager.enqueue({"func": tm.start, "args": (), "kwargs": {"params": params}})

    restored = manager.dequeue()
    assert restored["func"] is remote_dispatch.start
    assert isinstance(restored["kwargs"]["params"], VideoParams)
    assert restored["kwargs"]["params"].video_title == "test"
    assert manager.queue_size() == 0


def test_dequeue_on_empty_queue_returns_none():
    manager, _ = make_manager()

    assert manager.dequeue() is None
    assert manager.is_queue_empty() is True


def test_is_queue_empty_follows_size():
    manager, _ = make_manager()
    assert manager.is_queue_empty() is True

    manager.enqueue({"func": tm.start, "args": (), "kwargs": {}})
    assert manager.is_queue_empty() is False
    assert manager.queue_size() == 1

    manager.dequeue()
    assert manager.is_queue_empty() is True

import json
from types import SimpleNamespace
from typing import Dict

import redis
from loguru import logger
from pydantic import ValidationError

from app.controllers.manager.base_manager import TaskManager
from app.models.schema import TaskVideoRequest, VideoParams
from app.services import remote_dispatch

FUNC_MAP = {
    "start": remote_dispatch.start,
}


class RedisTaskManager(TaskManager):
    def __init__(
        self,
        max_concurrent_tasks: int,
        redis_url: str,
        max_queued_tasks: int = 100,
    ):
        self.redis_client = redis.Redis.from_url(redis_url)
        super().__init__(max_concurrent_tasks, max_queued_tasks=max_queued_tasks)

    def create_queue(self):
        return "task_queue"

    def enqueue(self, task: Dict):
        task_with_serializable_params = task.copy()

        if "params" in task["kwargs"] and isinstance(
            task["kwargs"]["params"], VideoParams
        ):
            task_with_serializable_params["kwargs"]["params"] = task["kwargs"][
                "params"
            ].dict()

        task_with_serializable_params["func"] = task["func"].__name__
        self.redis_client.rpush(self.queue, json.dumps(task_with_serializable_params))

    def dequeue(self):
        task_json = self.redis_client.lpop(self.queue)
        if task_json:
            task_info = json.loads(task_json)
            task_info["func"] = FUNC_MAP[task_info["func"]]

            if "params" in task_info["kwargs"] and isinstance(
                task_info["kwargs"]["params"], dict
            ):
                try:
                    task_info["kwargs"]["params"] = TaskVideoRequest(
                        **task_info["kwargs"]["params"]
                    )
                except ValidationError as exc:
                    self._fail_invalid_task(task_info, exc)
                    return None

            return task_info
        return None

    def _fail_invalid_task(self, task_info, exc):
        from app.services.task_outcome import fail_or_stop

        kwargs = task_info.get("kwargs") or {}
        args = task_info.get("args") or []
        task_id = kwargs.get("task_id") or (args[0] if args else None)
        error = "; ".join(str(item["msg"]) for item in exc.errors())
        if task_id is None:
            logger.error(f"dropping invalid queued task with no task id: {error}")
            return
        raw_params = kwargs.get("params")
        if isinstance(raw_params, dict):
            webhook_url = raw_params.get("webhook_url")
        else:
            webhook_url = getattr(raw_params, "webhook_url", None)
        failure_params = (
            SimpleNamespace(webhook_url=webhook_url, video_title="")
            if webhook_url
            else None
        )
        fail_or_stop(
            task_id, f"invalid task params: {error}", failure_params, stage="dispatch"
        )

    def is_queue_empty(self):
        return self.redis_client.llen(self.queue) == 0

    def queue_size(self):
        return self.redis_client.llen(self.queue)

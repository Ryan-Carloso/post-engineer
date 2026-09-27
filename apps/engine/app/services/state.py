import ast
import copy
import threading
import os
from abc import ABC, abstractmethod

from app.config import config
from app.models import const


# Base class for state management
class BaseState(ABC):
    @abstractmethod
    def update_task(self, task_id: str, state: int, progress: int = 0, **kwargs: object) -> None:
        pass

    @abstractmethod
    def get_task(self, task_id: str, user_id: str | None = None) -> dict[str, object] | None:
        pass

    @abstractmethod
    def get_all_tasks(self, page: int, page_size: int, user_id: str | None = None):
        pass


# Memory state management
class MemoryState(BaseState):
    def __init__(self):
        self._tasks = {}
        self._lock = threading.RLock()

    def get_all_tasks(self, page: int, page_size: int, user_id: str | None = None):
        start = (page - 1) * page_size
        end = start + page_size
        with self._lock:
            tasks = [copy.deepcopy(task) for task in self._tasks.values() if user_id is None or task.get("user_id") == user_id]
            total = len(tasks)
        return tasks[start:end], total

    def update_task(
        self,
        task_id: str,
        state: int = const.TASK_STATE_PROCESSING,
        progress: int = 0,
        **kwargs,
    ):
        progress = int(progress)
        if progress > 100:
            progress = 100

        with self._lock:
            self._tasks[task_id] = {
                **self._tasks.get(task_id, {}),
                "task_id": task_id,
                "state": state,
                "progress": progress,
                **kwargs,
            }

    def get_task(self, task_id: str, user_id: str | None = None):
        with self._lock:
            task = self._tasks.get(task_id, None)
            if task is not None and user_id is not None and task.get("user_id") != user_id:
                return None
            return copy.deepcopy(task) if task is not None else None

    def delete_task(self, task_id: str):
        with self._lock:
            self._tasks.pop(task_id, None)


# Redis state management
class RedisState(BaseState):
    """
    Redis-backed task state.

    Trust boundary: Redis is expected to be private to this application. Task
    values are written by MoneyPrinterTurbo and converted back from strings for
    compatibility with existing state records. Do not expose this Redis database
    to untrusted writers without replacing deserialization with a stricter
    schema-based format.
    """

    def __init__(self, host="localhost", port=6379, db=0, password=None):
        import redis

        self._redis = redis.StrictRedis(host=host, port=port, db=db, password=password)

    def get_all_tasks(self, page: int, page_size: int, user_id: str | None = None):
        start = (page - 1) * page_size
        end = start + page_size
        all_tasks = []
        cursor = 0
        while True:
            cursor, keys = self._redis.scan(cursor, count=page_size)
            for key in keys:
                task_data = self._redis.hgetall(key)
                task = {
                    k.decode("utf-8"): self._convert_to_original_type(v)
                    for k, v in task_data.items()
                }
                if user_id is None or task.get("user_id") == user_id:
                    all_tasks.append(task)

            # Even when the current page is already full, keep SCANning until
            # cursor=0: the caller needs the exact total to render pagination.
            if cursor == 0:
                break
        return all_tasks[start:end], len(all_tasks)

    def update_task(
        self,
        task_id: str,
        state: int = const.TASK_STATE_PROCESSING,
        progress: int = 0,
        **kwargs,
    ):
        progress = int(progress)
        if progress > 100:
            progress = 100

        fields = {
            "task_id": task_id,
            "state": state,
            "progress": progress,
            **kwargs,
        }

        for field, value in fields.items():
            self._redis.hset(task_id, field, str(value))

    def get_task(self, task_id: str, user_id: str | None = None):
        task_data = self._redis.hgetall(task_id)
        if not task_data:
            return None

        task = {
            key.decode("utf-8"): self._convert_to_original_type(value)
            for key, value in task_data.items()
        }
        if user_id is not None and task.get("user_id") != user_id:
            return None
        return task

    def delete_task(self, task_id: str):
        self._redis.delete(task_id)

    @staticmethod
    def _convert_to_original_type(value):
        """
        Convert values written by this application back to common Python types.

        This compatibility parser assumes Redis is inside the application's
        trust boundary. If Redis can be written by untrusted clients, task state
        should move to a strict JSON/schema parser instead of open-ended literal
        conversion.
        """
        value_str = value.decode("utf-8")

        try:
            # try to convert byte string array to list
            return ast.literal_eval(value_str)
        except (ValueError, SyntaxError):
            pass

        if value_str.isdigit():
            return int(value_str)
        # Add more conversions here if needed
        return value_str


class SupabaseState(BaseState):
    """Removed — the engine only uses memory/redis.

    Kept as a stub so legacy imports don't break; any explicit use fails
    with an actionable message instead of an opaque 500.
    """

    def __init__(self, *args: object, **kwargs: object) -> None:
        raise RuntimeError("SupabaseState foi removido; use MPT_STATE_BACKEND=memory")


# Global state — memory by default; redis when enable_redis=true.
# (The supabase backend was removed; MPT_STATE_BACKEND=supabase now fails
# fast via the SupabaseState stub above with an actionable error.)
_enable_redis = config.app.get("enable_redis", False)
_redis_host = config.app.get("redis_host", "localhost")
_redis_port = config.app.get("redis_port", 6379)
_redis_db = config.app.get("redis_db", 0)
_redis_password = config.app.get("redis_password", None)

_state_backend = os.getenv("MPT_STATE_BACKEND", "memory").lower()
if _state_backend == "supabase":
    import warnings

    warnings.warn("MPT_STATE_BACKEND=supabase foi removido; usando memory")
    _state_backend = "memory"
state = (
    RedisState(
        host=_redis_host, port=_redis_port, db=_redis_db, password=_redis_password
    )
    if _enable_redis
    else MemoryState()
)

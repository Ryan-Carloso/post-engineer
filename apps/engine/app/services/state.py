import ast
import copy
import threading
import os
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any

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


class _SupabaseAuthError(RuntimeError):
    """Supabase rejected the service key (HTTP 401).

    Raised so the boot/tick log names the exact env var to fix instead of a
    raw "401 Client Error".
    """


class SupabaseTaskState(BaseState):
    """PostgREST-backed task state.

    Persists video-generation task state in the ``engine_task_state``
    Supabase table so status polls survive engine restarts/redeploys. The
    memory backend loses everything on restart, and polls then answer 404
    "task not found" forever.

    Single-writer assumption: one engine process owns the table. Rows are
    keyed by task_id; the flexible task payload (stage, videos, error, ...)
    lives in the ``data`` JSONB column, and get_task returns the same shape
    as the memory backend: {"task_id", "state", "progress", **data}.
    """

    def __init__(
        self,
        url: str | None = None,
        service_key: str | None = None,
        requests_module: Any | None = None,
        table: str = "engine_task_state",
        reconcile_on_boot: bool = True,
    ) -> None:
        import requests

        base_url = url or os.getenv("SUPABASE_URL")
        key = service_key or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not base_url:
            raise RuntimeError("SUPABASE_URL is required for MPT_STATE_BACKEND=supabase")
        if not key:
            raise RuntimeError(
                "SUPABASE_SERVICE_ROLE_KEY is required for MPT_STATE_BACKEND=supabase"
            )
        self._requests = requests_module if requests_module is not None else requests
        self._base_url = base_url.rstrip("/")
        self._table = table
        self._headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        self._verify_table()
        if reconcile_on_boot:
            self.reconcile_orphaned_tasks()

    def _request(self, method: str, query: str, **kwargs: Any) -> Any:
        response = self._requests.request(
            method,
            f"{self._base_url}/rest/v1/{self._table}?{query}",
            headers=kwargs.pop("headers", self._headers),
            timeout=30,
            **kwargs,
        )
        try:
            response.raise_for_status()
        except Exception as exc:  # noqa: BLE001 - translated below when 401
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status == 401:
                raise _SupabaseAuthError(
                    "Supabase rejected the request with 401 Unauthorized: "
                    "SUPABASE_SERVICE_ROLE_KEY in the engine environment is "
                    "invalid or has been rotated. Update the key and restart "
                    "the engine."
                ) from exc
            raise
        return response

    def _verify_table(self) -> None:
        # Fail fast at boot when the migration was not applied: every later
        # call would 404 opaquely.
        try:
            self._request("GET", "select=task_id&limit=1")
        except Exception as exc:  # noqa: BLE001 - inspected for 404 below
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status == 404:
                raise RuntimeError(
                    "engine_task_state table not found in Supabase: apply "
                    "supabase/engine-task-state.sql in the Supabase dashboard "
                    "SQL editor, then restart the engine."
                ) from exc
            raise

    def _select_row(self, task_id: str) -> dict[str, Any] | None:
        response = self._request(
            "GET",
            f"task_id=eq.{task_id}&select=task_id,user_id,state,progress,data",
        )
        rows = response.json()
        return rows[0] if rows else None

    @staticmethod
    def _row_to_task(row: dict[str, Any]) -> dict[str, object]:
        data = row.get("data") or {}
        return {
            "task_id": row["task_id"],
            "state": row["state"],
            "progress": row["progress"],
            **data,
        }

    def update_task(
        self,
        task_id: str,
        state: int = const.TASK_STATE_PROCESSING,
        progress: int = 0,
        **kwargs: object,
    ) -> None:
        progress = int(progress)
        if progress > 100:
            progress = 100
        existing = self._select_row(task_id)
        data: dict[str, Any] = dict(existing.get("data") or {}) if existing else {}
        data.update(kwargs)
        user_id = kwargs.get("user_id", existing.get("user_id") if existing else None)
        self._request(
            "POST",
            "",
            headers={**self._headers, "Prefer": "resolution=merge-duplicates"},
            json={
                "task_id": task_id,
                "user_id": user_id,
                "state": state,
                "progress": progress,
                "data": data,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    def get_task(self, task_id: str, user_id: str | None = None) -> dict[str, object] | None:
        row = self._select_row(task_id)
        if row is None:
            return None
        if user_id is not None and row.get("user_id") != user_id:
            return None
        return self._row_to_task(row)

    def get_all_tasks(self, page: int, page_size: int, user_id: str | None = None):
        offset = (page - 1) * page_size
        query = (
            "select=task_id,user_id,state,progress,data,updated_at"
            f"&order=updated_at.desc&limit={page_size}&offset={offset}"
        )
        if user_id is not None:
            query += f"&user_id=eq.{user_id}"
        response = self._request(
            "GET", query, headers={**self._headers, "Prefer": "count=exact"}
        )
        total = 0
        content_range = response.headers.get("Content-Range", "")
        if "/" in content_range:
            try:
                total = int(content_range.rsplit("/", 1)[1])
            except ValueError:
                total = 0
        tasks = [self._row_to_task(row) for row in response.json()]
        return tasks, total

    def delete_task(self, task_id: str) -> None:
        self._request("DELETE", f"task_id=eq.{task_id}")

    def reconcile_orphaned_tasks(self) -> int:
        """Mark tasks left running across a restart as failed.

        Their GPU handles died with the old process, so they can never
        complete; failing them once lets the web record the failure (and
        refund the token) instead of polling a 404 forever. Returns how
        many rows were failed.
        """
        response = self._request(
            "GET",
            "select=task_id,data"
            f"&state=not.in.({const.TASK_STATE_FAILED},{const.TASK_STATE_COMPLETE})",
        )
        failed = 0
        for row in response.json():
            data = dict(row.get("data") or {})
            data["error"] = "engine restarted while the task was still running"
            self._request(
                "PATCH",
                f"task_id=eq.{row['task_id']}",
                json={
                    "state": const.TASK_STATE_FAILED,
                    "data": data,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
            )
            failed += 1
        return failed


# Global state — memory by default; redis when enable_redis=true; supabase
# when MPT_STATE_BACKEND=supabase (persistent: survives restarts/redeploys;
# requires the engine_task_state table — see supabase/engine-task-state.sql).
_enable_redis = config.app.get("enable_redis", False)
_redis_host = config.app.get("redis_host", "localhost")
_redis_port = config.app.get("redis_port", 6379)
_redis_db = config.app.get("redis_db", 0)
_redis_password = config.app.get("redis_password", None)

_state_backend = os.getenv("MPT_STATE_BACKEND", "memory").lower()
state: BaseState
if _state_backend == "supabase":
    state = SupabaseTaskState()
elif _enable_redis:
    state = RedisState(
        host=_redis_host, port=_redis_port, db=_redis_db, password=_redis_password
    )
else:
    state = MemoryState()

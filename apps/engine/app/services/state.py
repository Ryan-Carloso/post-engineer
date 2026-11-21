import copy
import threading
import os
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

from loguru import logger

from app.config import config
from app.models import const
from app.services.redis_task_values import convert_redis_task_value
from app.services.task_cancellation import cancel_and_delete, is_cancelled
from app.utils.supabase_retry import build_retrying_session


class BaseState(ABC):
    @abstractmethod
    def update_task(
        self,
        task_id: str,
        state: int | None = None,
        progress: int | None = None,
        **kwargs: object,
    ) -> None:
        """Merge ``kwargs`` into the task row.

        ``state``/``progress`` are only overwritten when explicitly passed:
        a kwargs-only call (e.g. recording ``music_mood`` mid-pipeline) must
        never reset progress to 0. Pass ``progress=0`` explicitly to reset.
        """

    @abstractmethod
    def get_task(self, task_id: str, user_id: str | None = None) -> dict[str, object] | None:
        pass

    @abstractmethod
    def get_all_tasks(self, page: int, page_size: int, user_id: str | None = None):
        pass


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
        state: int | None = None,
        progress: int | None = None,
        **kwargs,
    ):
        update: dict[str, object] = {"task_id": task_id}
        if state is not None:
            update["state"] = state
        if progress is not None:
            clamped = int(progress)
            if clamped > 100:
                clamped = 100
            update["progress"] = clamped

        with self._lock:
            if is_cancelled(task_id):
                return
            current = self._tasks.get(task_id, {})
            self._tasks[task_id] = {**current, **update, **kwargs}

    def get_task(self, task_id: str, user_id: str | None = None):
        with self._lock:
            task = self._tasks.get(task_id, None)
            if task is not None and user_id is not None and task.get("user_id") != user_id:
                return None
            return copy.deepcopy(task) if task is not None else None

    def delete_task(self, task_id: str):
        def _pop() -> None:
            with self._lock:
                self._tasks.pop(task_id, None)

        cancel_and_delete(task_id, _pop)


class RedisState(BaseState):
    """
    Redis-backed task state.

    Trust boundary: Redis is expected to be private to this application. Task
    values are written by this application and converted back from strings for
    compatibility with existing state records. Do not expose this Redis database
    to untrusted writers without replacing deserialization with a stricter
    schema-based format.
    """

    def __init__(self, host="localhost", port=6379, db=0, password=None):
        import redis

        self._redis = redis.StrictRedis(host=host, port=port, db=db, password=password)
        self._lock = threading.RLock()

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
                    k.decode("utf-8"): convert_redis_task_value(v)
                    for k, v in task_data.items()
                }
                if user_id is None or task.get("user_id") == user_id:
                    all_tasks.append(task)

            if cursor == 0:
                break
        return all_tasks[start:end], len(all_tasks)

    def update_task(
        self,
        task_id: str,
        state: int | None = None,
        progress: int | None = None,
        **kwargs,
    ):
        fields: dict[str, object] = {"task_id": task_id}
        if state is not None:
            fields["state"] = state
        if progress is not None:
            clamped = int(progress)
            if clamped > 100:
                clamped = 100
            fields["progress"] = clamped
        fields.update(kwargs)

        with self._lock:
            if is_cancelled(task_id):
                return
            for field, value in fields.items():
                self._redis.hset(task_id, field, str(value))

    def get_task(self, task_id: str, user_id: str | None = None):
        task_data = self._redis.hgetall(task_id)
        if not task_data:
            return None

        task = {
            key.decode("utf-8"): convert_redis_task_value(value)
            for key, value in task_data.items()
        }
        if user_id is not None and task.get("user_id") != user_id:
            return None
        return task

    def delete_task(self, task_id: str):
        def _delete() -> None:
            with self._lock:
                self._redis.delete(task_id)

        cancel_and_delete(task_id, _delete)


_STATE_REQUEST_TIMEOUT_SECONDS = (3, 10)

_RECONCILE_BATCH_LIMIT = 100
_RECONCILE_PROGRESS_EVERY = 25


class _SupabaseAuthError(RuntimeError):
    """Supabase rejected the service key (HTTP 401).

    Raised so the boot/tick log names the exact env var to fix instead of a
    raw "401 Client Error".
    """


_ORPHAN_ERROR_MESSAGE = "engine restarted while the task was still running"


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
    ) -> None:
        base_url = url or os.getenv("SUPABASE_URL")
        key = service_key or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not base_url:
            raise RuntimeError("SUPABASE_URL is required for MPT_STATE_BACKEND=supabase")
        if not key:
            raise RuntimeError(
                "SUPABASE_SERVICE_ROLE_KEY is required for MPT_STATE_BACKEND=supabase"
            )
        self._requests = requests_module if requests_module is not None else build_retrying_session()
        self._base_url = base_url.rstrip("/")
        self._table = table
        self._headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        self._lock = threading.RLock()
        self._verify_table()

    def _request(
        self, method: str, query: str, table: str | None = None, **kwargs: Any
    ) -> Any:
        target = table or self._table
        response = self._requests.request(
            method,
            f"{self._base_url}/rest/v1/{target}?{query}",
            headers=kwargs.pop("headers", self._headers),
            timeout=_STATE_REQUEST_TIMEOUT_SECONDS,
            **kwargs,
        )
        self._raise_for_status(response)
        return response

    def _rpc(self, function: str, payload: dict[str, Any]) -> Any:
        response = self._requests.request(
            "POST",
            f"{self._base_url}/rest/v1/rpc/{function}",
            headers=self._headers,
            timeout=_STATE_REQUEST_TIMEOUT_SECONDS,
            json=payload,
        )
        self._raise_for_status(response)
        return response

    @staticmethod
    def _raise_for_status(response: Any) -> None:
        try:
            response.raise_for_status()
        except Exception as exc:  # noqa: BLE001
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status == 401:
                raise _SupabaseAuthError(
                    "Supabase rejected the request with 401 Unauthorized: "
                    "SUPABASE_SERVICE_ROLE_KEY in the engine environment is "
                    "invalid or has been rotated. Update the key and restart "
                    "the engine."
                ) from exc
            raise

    def _verify_table(self) -> None:
        try:
            self._request("GET", "select=task_id&limit=1")
        except Exception as exc:  # noqa: BLE001
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status == 404:
                raise RuntimeError(
                    "engine_task_state table not found in Supabase: apply "
                    "supabase/migrations/003_engine-task-state.sql in the Supabase dashboard "
                    "SQL editor, then restart the engine."
                ) from exc
            raise

    def _select_row(self, task_id: str) -> dict[str, Any] | None:
        response = self._request(
            "GET",
            f"task_id=eq.{self._eq(task_id)}&select=task_id,user_id,state,progress,data",
        )
        rows = response.json()
        return rows[0] if rows else None

    @staticmethod
    def _eq(value: str) -> str:
        return quote(value, safe="")

    @staticmethod
    def _safe_data(row: dict[str, Any]) -> dict[str, Any]:
        data = row.get("data")
        if not isinstance(data, dict):
            logger.warning(
                "engine_task_state row for task {} holds non-object data ({}); "
                "treating as empty",
                row.get("task_id"),
                type(data).__name__,
            )
            return {}
        return data

    @staticmethod
    def _row_to_task(row: dict[str, Any]) -> dict[str, object]:
        data = SupabaseTaskState._safe_data(row)
        return {
            "task_id": row["task_id"],
            "state": row["state"],
            "progress": row["progress"],
            **data,
        }

    def update_task(
        self,
        task_id: str,
        state: int | None = None,
        progress: int | None = None,
        **kwargs: object,
    ) -> None:
        clamped_progress: int | None = None
        if progress is not None:
            clamped_progress = int(progress)
            if clamped_progress > 100:
                clamped_progress = 100
        with self._lock:
            if is_cancelled(task_id):
                return
            existing = self._select_row(task_id)
            data: dict[str, Any] = (
                dict(self._safe_data(existing)) if existing else {}
            )
            data.update(kwargs)
            user_id = kwargs.get("user_id", existing.get("user_id") if existing else None)
            payload: dict[str, Any] = {
                "task_id": task_id,
                "user_id": user_id,
                "data": data,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            if state is not None:
                payload["state"] = state
            if clamped_progress is not None:
                payload["progress"] = clamped_progress
            self._request(
                "POST",
                "",
                headers={**self._headers, "Prefer": "resolution=merge-duplicates"},
                json=payload,
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
            query += f"&user_id=eq.{self._eq(user_id)}"
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
        def _delete() -> None:
            with self._lock:
                self._request("DELETE", f"task_id=eq.{self._eq(task_id)}")

        cancel_and_delete(task_id, _delete)

    def reconcile_orphaned_tasks(self) -> int:
        """Triage tasks left running across a restart, then settle the rest.

        Each orphan is classified by its last persisted stage
        (app.services.orphan_requeue.classify_orphan): generation stages
        linked to a batch slot go back to ``pending`` for the next
        fill-schedule tick, and everything else keeps the historical
        fail+refund. A per-task failure is logged loudly and never breaks
        the loop or the boot: the task stays non-terminal and is retried
        on the next boot. Returns how many rows were failed
        (requeued orphans are not counted).
        """
        from app.services import orphan_requeue

        response = self._request(
            "GET",
            "select=task_id,data"
            f"&state=not.in.({const.TASK_STATE_FAILED},{const.TASK_STATE_COMPLETE})"
            f"&order=updated_at.asc&limit={_RECONCILE_BATCH_LIMIT}",
        )
        rows = response.json()
        if len(rows) >= _RECONCILE_BATCH_LIMIT:
            logger.warning(
                f"orphan reconcile hit the batch cap ({_RECONCILE_BATCH_LIMIT}); "
                "remaining rows will be drained by subsequent boots"
            )
        slot_store = orphan_requeue.slot_store_or_none()
        failed = 0
        for index, row in enumerate(rows, start=1):
            if index % _RECONCILE_PROGRESS_EVERY == 0:
                logger.info(f"orphan reconcile progress: {index}/{len(rows)} rows processed")
            task_id = row["task_id"]
            data = dict(self._safe_data(row))
            try:
                if orphan_requeue.triage_orphan(self, task_id, data, slot_store):
                    continue
            except Exception as exc:  # noqa: BLE001
                logger.error(f"failed to triage orphaned task {task_id}: {exc}")
                continue
            try:
                self._settle_orphan_billing(task_id)
                data["error"] = _ORPHAN_ERROR_MESSAGE
                self._request(
                    "PATCH",
                    f"task_id=eq.{self._eq(task_id)}",
                    json={
                        "state": const.TASK_STATE_FAILED,
                        "data": data,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
                failed += 1
            except Exception as exc:  # noqa: BLE001
                logger.error(f"failed to reconcile orphaned task {task_id}: {exc}")
        return failed

    def _settle_orphan_billing(self, task_id: str) -> None:
        """Record the failure and refund the token for one orphaned task.

        Finds the video_generations row by engine_task_id, marks it failed,
        and calls the idempotent refund_generation_tokens RPC. Rows that
        are already terminal are left alone; rows whose refund never lands
        keep tokens_refunded=false so the web's poll path retries the
        refund as a backstop when the user next checks.
        """
        response = self._request(
            "GET",
            f"engine_task_id=eq.{self._eq(task_id)}"
            "&select=generation_id,user_id,status,tokens_refunded"
            "&order=created_at.asc",
            table="video_generations",
        )
        rows = response.json()
        if not rows:
            logger.warning(
                f"orphaned task {task_id} has no video_generations row "
                "(expected for fill_schedule batch tasks); "
                "marking failed without refund"
            )
            return
        if len(rows) > 1:
            logger.warning(
                f"orphaned task {task_id} has {len(rows)} video_generations "
                "rows; settling the oldest only"
            )
        gen = rows[0]
        if gen.get("status") in ("failed", "completed"):
            return
        refunded = bool(gen.get("tokens_refunded"))
        if not refunded:
            try:
                rpc_response = self._rpc(
                    "refund_generation_tokens",
                    {
                        "p_user_id": gen["user_id"],
                        "p_generation_id": gen["generation_id"],
                        "p_reason": f"{_ORPHAN_ERROR_MESSAGE}; tokens refunded",
                    },
                )
                refunded = bool((rpc_response.json() or {}).get("refunded"))
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    f"refund RPC failed for generation {gen['generation_id']}: {exc}"
                )
                refunded = False
        now = datetime.now(timezone.utc).isoformat()
        patch = {
            "status": "failed",
            "error_code": "engine_restart",
            "error_message": _ORPHAN_ERROR_MESSAGE,
            "completed_at": now,
            "updated_at": now,
        }
        if refunded:
            patch["tokens_refunded"] = True
        self._request(
            "PATCH",
            f"generation_id=eq.{self._eq(gen['generation_id'])}",
            table="video_generations",
            json=patch,
        )

from app.services.state_persistence import persist_state_update  # noqa: F401,E402

__all__ = ["BaseState", "MemoryState", "RedisState", "SupabaseTaskState", "persist_state_update"]


_enable_redis = config.app.get("enable_redis", False)
_redis_host = config.app.get("redis_host", "localhost")
_redis_port = config.app.get("redis_port", 6379)
_redis_db = config.app.get("redis_db", 0)
_redis_password = config.app.get("redis_password", None)

_state_backend = os.getenv("MPT_STATE_BACKEND", "memory").lower()
state: BaseState
if _state_backend == "supabase":
    from app.services.death_diagnostics import DeathDiagnosticTaskState

    state = DeathDiagnosticTaskState()
elif _enable_redis:
    state = RedisState(
        host=_redis_host, port=_redis_port, db=_redis_db, password=_redis_password
    )
else:
    state = MemoryState()

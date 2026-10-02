import ast
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


# HTTP timeout for task-state requests: short enough that a Supabase outage
# fails fast instead of wedging writers behind update_task's RLock (each
# holder would otherwise block up to 30s per call, serializing every
# concurrent task thread's progress writes).
_STATE_REQUEST_TIMEOUT_SECONDS = 10

# Boot reconcile bounds: a huge orphan backlog after a long outage must not
# stall boot — leftover rows are drained by subsequent boots.
_RECONCILE_BATCH_LIMIT = 100
_RECONCILE_PROGRESS_EVERY = 25


class _SupabaseAuthError(RuntimeError):
    """Supabase rejected the service key (HTTP 401).

    Raised so the boot/tick log names the exact env var to fix instead of a
    raw "401 Client Error".
    """


# Reason recorded on tasks (and their video_generations rows) orphaned by an
# engine restart: shared between the task-state write and the billing write
# so both surfaces tell the same story.
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
        # Serializes the SELECT→POST read-modify-write in update_task:
        # in-process writers are multi-threaded (task thread, publish
        # thread, fill-schedule thread), and without the lock two writers
        # can read the same base row and the last POST wins, silently
        # dropping the other's kwargs. Same role as MemoryState's RLock.
        self._lock = threading.RLock()
        self._verify_table()
        if reconcile_on_boot:
            failed = self.reconcile_orphaned_tasks()
            if failed:
                logger.info(f"marked {failed} orphaned task(s) failed at boot")

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
        # PostgREST stored-procedure call, e.g. the idempotent
        # refund_generation_tokens used to return tokens for dead tasks.
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
            f"task_id=eq.{self._eq(task_id)}&select=task_id,user_id,state,progress,data",
        )
        rows = response.json()
        return rows[0] if rows else None

    @staticmethod
    def _eq(value: str) -> str:
        # Percent-encode PostgREST filter values: task_id/user_id originate
        # partly from caller-controlled headers, and a raw space, & or ,
        # would otherwise produce 400s or silently wrong filters.
        return quote(value, safe="")

    @staticmethod
    def _safe_data(row: dict[str, Any]) -> dict[str, Any]:
        # The data column is untyped JSONB: a non-object value (manual
        # dashboard edit, future writer) must degrade to {} with a log,
        # never brick the row by raising on every subsequent read/write.
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
        state: int = const.TASK_STATE_PROCESSING,
        progress: int = 0,
        **kwargs: object,
    ) -> None:
        progress = int(progress)
        if progress > 100:
            progress = 100
        # The SELECT→POST below is a read-modify-write: hold the lock for
        # the whole sequence so concurrent writers cannot read the same
        # base row and silently drop each other's kwargs (last POST wins).
        with self._lock:
            existing = self._select_row(task_id)
            data: dict[str, Any] = (
                dict(self._safe_data(existing)) if existing else {}
            )
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
        self._request("DELETE", f"task_id=eq.{self._eq(task_id)}")

    def reconcile_orphaned_tasks(self) -> int:
        """Mark tasks left running across a restart as failed, and settle them.

        Their GPU handles died with the old process, so they can (almost)
        never complete. Each orphan is failed in the task table AND its
        billing is settled (video_generations marked failed + token refunded
        via the idempotent refund_generation_tokens RPC) — entirely inside
        the engine, so an away user still gets their token back without ever
        opening the web. A per-task failure is logged loudly and never
        breaks the loop or the boot: the task stays non-terminal and is
        retried on the next boot. Returns how many rows were failed.

        Billing trade-off (rare, bounded): if a terminal COMPLETE write was
        lost twice, the terminal webhook still delivered the video, yet the
        row is non-terminal — this reconcile then marks it failed and refunds
        the token, so the user keeps the video AND the token. Requires two
        consecutive write failures plus a restart; accepted over the worse
        alternative (a delivered-but-unrecorded task silently keeping the
        token).

        The batch is capped (_RECONCILE_BATCH_LIMIT) so a huge backlog after
        a long outage cannot stall boot: leftover rows are drained by later
        boots, and the ordering is idempotent.
        """
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
        failed = 0
        for index, row in enumerate(rows, start=1):
            if index % _RECONCILE_PROGRESS_EVERY == 0:
                logger.info(
                    f"orphan reconcile progress: {index}/{len(rows)} rows processed"
                )
            task_id = row["task_id"]
            try:
                # Billing first: if the process dies after the settle but
                # before the task PATCH, the next boot re-selects the still
                # non-terminal task and the settle skips the already-terminal
                # generation row (idempotent RPC) — a crash can never lose a
                # refund that the task PATCH already survived.
                self._settle_orphan_billing(task_id)
                data = dict(self._safe_data(row))
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
            except Exception as exc:  # noqa: BLE001 - loud log, next boot retries
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
            # No video_generations row is normal for fill_schedule batch
            # tasks (the web never sees batch task ids; the batch reconciler
            # settles those refunds separately) — warn, don't error, so the
            # log doesn't read as stuck user tokens.
            logger.warning(
                f"orphaned task {task_id} has no video_generations row "
                "(expected for fill_schedule batch tasks); "
                "marking failed without refund"
            )
            return
        if len(rows) > 1:
            # The relation is 1:1 today; a second row would silently stay
            # pending and unrefunded if we only settled rows[0]. Settle the
            # oldest and say so loudly so the new flow gets a row per task.
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
            except Exception as exc:  # noqa: BLE001 - recorded below; web poll retries
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
            # Never write tokens_refunded=false over a row that already
            # carries true (the refund RPC may have landed on an earlier
            # attempt, or the web poll path settled concurrently): the web
            # backstop heals a false flag on the next poll, but a true flag
            # must never flap back to false.
            patch["tokens_refunded"] = True
        self._request(
            "PATCH",
            f"generation_id=eq.{self._eq(gen['generation_id'])}",
            table="video_generations",
            json=patch,
        )


def persist_state_update(backend: BaseState, task_id: str, **kwargs: object) -> bool:
    """Write a task-state update that must not be silently lost, retrying once.

    With the memory backend update_task() effectively cannot fail; with a
    network backend (Supabase) every write is an HTTP request that can raise
    (timeout, 5xx, rotated key). A lost terminal write leaves the row
    PROCESSING forever — the web polls with no failure recorded and no
    refund, which is exactly the failure mode persistence was added to
    eliminate. Retry once, then log loudly and report the loss. Never
    raises: a persistence failure must not mask the task outcome it was
    recording.
    """
    try:
        backend.update_task(task_id, **kwargs)
        return True
    except Exception as exc:  # noqa: BLE001 - one retry before giving up
        logger.warning(f"task state write failed for {task_id}, retrying: {exc}")
    try:
        backend.update_task(task_id, **kwargs)
        return True
    except Exception as exc:  # noqa: BLE001 - loud, then report the loss
        logger.error(
            f"task state write permanently failed for {task_id}; "
            f"the task row may be stale: {exc}"
        )
        return False


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

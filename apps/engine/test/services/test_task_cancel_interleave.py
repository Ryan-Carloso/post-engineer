"""Check-then-act races between update_task and delete_task (issue #447).

``update_task`` used to call ``is_cancelled`` and only later write the row.
``delete_task`` marks the id and removes the row in that gap, and the write
recreates it (Supabase upserts with ``user_id=None`` when the SELECT saw
nothing). The cancel check and the write have to be atomic with the removal:
same lock, check inside it.

Events gate the threads. Timeouts only bound a missed wakeup; nothing sleeps
to "let the other thread run".
"""

import threading
from unittest.mock import MagicMock, patch
from urllib.parse import urlparse

from app.services.state import MemoryState, RedisState, SupabaseTaskState


_JOIN_SECONDS = 2.0


class _FirstEntryGate:
    """Block the first ``with lock`` before it acquires the inner lock.

    That is the gap after a check that already returned false and before the
    critical section. ``delete_task`` can finish in the gap. Later entries
    take the inner lock immediately, so the deleter is not gated.
    """

    def __init__(self, inner: threading.RLock):
        self._inner = inner
        self._arm = True
        self.entered = threading.Event()
        self.release = threading.Event()

    def __enter__(self):
        if self._arm:
            self._arm = False
            self.entered.set()
            if not self.release.wait(timeout=_JOIN_SECONDS):
                raise TimeoutError("timed out before entering the state lock")
        self._inner.acquire()
        return self

    def __exit__(self, exc_type, exc, tb):
        self._inner.release()
        return False


class _ContentionProbe:
    """Set ``contended`` when a second thread enters while another holds it."""

    def __init__(self, inner: threading.RLock):
        self._inner = inner
        self.contended = threading.Event()
        self._owner: int | None = None
        self._meta = threading.Lock()

    def __enter__(self):
        with self._meta:
            owner = self._owner
        if owner is not None and owner != threading.get_ident():
            self.contended.set()
        self._inner.acquire()
        with self._meta:
            self._owner = threading.get_ident()
        return self

    def __exit__(self, exc_type, exc, tb):
        with self._meta:
            self._owner = None
        self._inner.release()
        return False


def _guard(fn, errors: list[BaseException]) -> None:
    try:
        fn()
    except BaseException as exc:  # noqa: BLE001
        errors.append(exc)


def _wait_first(events: list[threading.Event], timeout: float = _JOIN_SECONDS) -> bool:
    """Return when any event is set. Losing waiters time out on their own."""
    done = threading.Event()

    def _relay(event: threading.Event) -> None:
        if event.wait(timeout=timeout):
            done.set()

    for event in events:
        threading.Thread(target=_relay, args=(event,), daemon=True).start()
    return done.wait(timeout=timeout)


def _finish(threads: list[threading.Thread], errors: list[BaseException]) -> None:
    for thread in threads:
        thread.join(timeout=_JOIN_SECONDS)
        assert not thread.is_alive(), "thread still blocked after the gate released"
    assert errors == [], errors


def test_memory_delete_during_lock_wait_is_not_recreated():
    state = MemoryState()
    state.update_task("mem-race", state=4, progress=10, user_id="u-1")
    gate = _FirstEntryGate(state._lock)
    state._lock = gate
    deleted = threading.Event()
    errors: list[BaseException] = []

    def _update() -> None:
        state.update_task("mem-race", state=1, progress=90, user_id="u-1")

    def _delete() -> None:
        state.delete_task("mem-race")
        deleted.set()

    updater = threading.Thread(target=_guard, args=(_update, errors))
    deleter = threading.Thread(target=_guard, args=(_delete, errors))
    try:
        updater.start()
        assert gate.entered.wait(timeout=_JOIN_SECONDS), "update did not reach the lock"
        deleter.start()
        assert deleted.wait(timeout=_JOIN_SECONDS), "delete did not finish while the writer waited"
    finally:
        gate.release.set()
    _finish([updater, deleter], errors)
    assert state.get_task("mem-race") is None


def test_redis_delete_during_write_window_is_not_recreated():
    errors: list[BaseException] = []
    gate = _FirstEntryGate(threading.RLock())
    deleted = threading.Event()

    class _RaceRedis:
        def __init__(self):
            self.data: dict[bytes, dict[bytes, bytes]] = {}
            self.hset_entered = threading.Event()
            self.hset_release = threading.Event()

        def hset(self, key, field, value):
            if field == "task_id" and not gate.entered.is_set():
                self.hset_entered.set()
                if not self.hset_release.wait(timeout=_JOIN_SECONDS):
                    raise TimeoutError("timed out in the redis write window")
            key_b = key.encode("utf-8") if isinstance(key, str) else key
            field_b = field.encode("utf-8") if isinstance(field, str) else field
            value_b = value.encode("utf-8") if isinstance(value, str) else value
            self.data.setdefault(key_b, {})[field_b] = value_b

        def hgetall(self, key):
            key_b = key.encode("utf-8") if isinstance(key, str) else key
            return dict(self.data.get(key_b, {}))

        def delete(self, key):
            key_b = key.encode("utf-8") if isinstance(key, str) else key
            self.data.pop(key_b, None)

    fake = _RaceRedis()
    state = RedisState.__new__(RedisState)
    state._redis = fake
    state._lock = gate

    def _update() -> None:
        state.update_task("redis-race", state=1, progress=90, user_id="u-1")

    def _delete() -> None:
        state.delete_task("redis-race")
        deleted.set()

    updater = threading.Thread(target=_guard, args=(_update, errors))
    deleter = threading.Thread(target=_guard, args=(_delete, errors))
    try:
        updater.start()
        assert _wait_first([gate.entered, fake.hset_entered]), "update did not reach the race window"
        deleter.start()
        assert deleted.wait(timeout=_JOIN_SECONDS), "delete did not finish while the writer waited"
    finally:
        gate.release.set()
        fake.hset_release.set()
    _finish([updater, deleter], errors)
    assert state.get_task("redis-race") is None


def _response(json_data=None):
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = [] if json_data is None else json_data
    response.headers = {}
    response.raise_for_status.return_value = None
    return response


def _supabase_state(request):
    requests_mod = MagicMock()
    requests_mod.request.side_effect = request
    env = {
        "SUPABASE_URL": "https://supabase.example",
        "SUPABASE_SERVICE_ROLE_KEY": "service-key",
    }
    with patch.dict("os.environ", env, clear=False):
        backend = SupabaseTaskState(requests_module=requests_mod)
    return backend


def test_supabase_delete_during_lock_wait_does_not_upsert():
    ops: list[str] = []

    def request(method, url, **kwargs):
        if method in ("POST", "DELETE"):
            ops.append(method)
        return _response([])

    backend = _supabase_state(request)
    gate = _FirstEntryGate(backend._lock)
    backend._lock = gate
    deleted = threading.Event()
    errors: list[BaseException] = []

    def _update() -> None:
        backend.update_task("sb-race", state=1, progress=90, user_id="u-1")

    def _delete() -> None:
        backend.delete_task("sb-race")
        deleted.set()

    updater = threading.Thread(target=_guard, args=(_update, errors))
    deleter = threading.Thread(target=_guard, args=(_delete, errors))
    try:
        updater.start()
        assert gate.entered.wait(timeout=_JOIN_SECONDS), "update did not reach the lock"
        deleter.start()
        assert deleted.wait(timeout=_JOIN_SECONDS), "delete did not finish while the writer waited"
    finally:
        gate.release.set()
    _finish([updater, deleter], errors)
    assert "DELETE" in ops, ops
    last_delete = max(index for index, op in enumerate(ops) if op == "DELETE")
    assert "POST" not in ops[last_delete + 1 :], ops


def test_supabase_select_inside_lock_does_not_upsert_after_delete():
    ops: list[str] = []
    select_entered = threading.Event()
    select_release = threading.Event()
    delete_sent = threading.Event()

    def request(method, url, **kwargs):
        query = urlparse(url).query
        if method == "GET" and "select=task_id,user_id" in query:
            ops.append("select")
            select_entered.set()
            if not select_release.wait(timeout=_JOIN_SECONDS):
                raise TimeoutError("timed out in the supabase select")
            return _response([])
        if method == "DELETE":
            ops.append("delete")
            delete_sent.set()
            return _response([])
        if method == "POST":
            prefer = (kwargs.get("headers") or {}).get("Prefer", "")
            if "resolution=merge-duplicates" in prefer:
                ops.append("upsert")
            else:
                ops.append("post")
            return _response([])
        return _response([])

    backend = _supabase_state(request)
    probe = _ContentionProbe(backend._lock)
    backend._lock = probe
    errors: list[BaseException] = []

    def _update() -> None:
        backend.update_task("sb-select", state=1, progress=40, user_id="u-1")

    def _delete() -> None:
        backend.delete_task("sb-select")

    updater = threading.Thread(target=_guard, args=(_update, errors))
    deleter = threading.Thread(target=_guard, args=(_delete, errors))
    try:
        updater.start()
        assert select_entered.wait(timeout=_JOIN_SECONDS), "update did not reach the select"
        deleter.start()
        assert _wait_first([delete_sent, probe.contended]), "delete neither ran nor blocked on the lock"
    finally:
        select_release.set()
    _finish([updater, deleter], errors)
    assert "delete" in ops, ops
    last_delete = max(index for index, op in enumerate(ops) if op == "delete")
    assert "upsert" not in ops[last_delete + 1 :], ops

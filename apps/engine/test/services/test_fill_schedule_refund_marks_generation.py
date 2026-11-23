"""ScheduleStore.refund_batch_tokens marks the slot's video_generations row.

The engine refunds a failed batch slot itself, so the web never sees the
refund: without this write the generation status reads tokensRefunded
false for tokens that were returned.
"""

from app.services.fill_schedule.store import ScheduleStore


class _Response:
    def __init__(self, body, status=200):
        self._body = body
        self.status_code = status
        self.content = b"x" if body is not None else b""

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._body


class _Requests:
    def __init__(self, rpc_body, patch_status=204):
        self.rpc_body = rpc_body
        self.patch_status = patch_status
        self.calls = []

    def request(self, method, url, headers=None, timeout=None, **kwargs):
        self.calls.append({"method": method, "url": url, **kwargs})
        if url.endswith("rpc/refund_batch_tokens"):
            return _Response(self.rpc_body)
        return _Response(None, self.patch_status)


def _store(requests):
    store = ScheduleStore.__new__(ScheduleStore)
    store._requests = requests
    store._base_url = "https://supabase.example"
    store._headers = {}
    return store


def _refund(store):
    return store.refund_batch_tokens(
        "user-1", "batch:sched-1", "batch:sched-1:slot:slot-1", 2, "Batch generation failed",
        engine_task_id="task-1",
    )


def test_a_landed_refund_marks_the_slot_generation_refunded():
    requests = _Requests({"refunded": True})
    assert _refund(_store(requests)) is True
    patch = requests.calls[1]
    assert patch["method"] == "PATCH"
    assert patch["url"] == "https://supabase.example/rest/v1/video_generations"
    assert patch["params"] == {"generation_id": "eq.batch:sched-1:slot:slot-1"}
    assert patch["json"] == {"tokens_refunded": True}


def test_a_refund_that_did_not_land_marks_nothing():
    requests = _Requests({"refunded": False})
    assert _refund(_store(requests)) is False
    assert [call["method"] for call in requests.calls] == ["POST"]


def test_a_failed_mark_still_reports_the_landed_refund():
    from loguru import logger

    messages = []
    sink = logger.add(messages.append, level="ERROR")
    try:
        requests = _Requests({"refunded": True}, patch_status=500)
        assert _refund(_store(requests)) is True
    finally:
        logger.remove(sink)
    assert len(messages) == 1
    assert "refund landed but video_generations was not marked" in messages[0]
    assert "batch:sched-1:slot:slot-1" in messages[0]

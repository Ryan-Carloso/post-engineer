"""slot_id on web-created tasks: accepted by the schema and persisted to
the task row so boot orphan triage can requeue them.

Before this change, only fill-schedule tasks carried slot_id, so a web
task orphaned by an engine restart fell through to the historical
fail+refund even though the auto-requeue machinery (PR #203) existed.
"""

from app.controllers.v1.video import _slot_tracking_kwargs
from app.models.schema import TaskVideoRequest


def _body(**kwargs):
    return TaskVideoRequest(video_subject="viagem", **kwargs)


class TestSlotIdSchema:
    def test_task_video_request_accepts_slot_id(self):
        body = _body(slot_id="slot-123")
        assert body.slot_id == "slot-123"

    def test_task_video_request_slot_id_defaults_to_none(self):
        body = _body()
        assert body.slot_id is None


class TestSlotTrackingKwargs:
    def test_returns_slot_id_when_present(self):
        assert _slot_tracking_kwargs(_body(slot_id="slot-123")) == {
            "slot_id": "slot-123"
        }

    def test_omits_when_absent(self):
        assert _slot_tracking_kwargs(_body()) == {}

    def test_omits_when_empty(self):
        assert _slot_tracking_kwargs(_body(slot_id="")) == {}

"""slot_id on web-created tasks: accepted by the schema and persisted to
the task row so boot orphan triage can requeue them.

Before this change, only fill-schedule tasks carried slot_id, so a web
task orphaned by an engine restart fell through to the historical
fail+refund even though the auto-requeue machinery (PR #203) existed.
"""

from app.models.schema import TaskVideoRequest
from app.services.tracking_props import tracking_kwargs


def _body(**kwargs):
    return TaskVideoRequest(
        video_title="viagem", video_description="Test description.", video_type="faceless", **kwargs
    )


class TestSlotIdSchema:
    def test_task_video_request_accepts_slot_id(self):
        body = _body(slot_id="slot-123")
        assert body.slot_id == "slot-123"

    def test_task_video_request_slot_id_defaults_to_none(self):
        body = _body()
        assert body.slot_id is None


class TestSlotTrackingKwargs:
    def test_returns_slot_id_when_present(self):
        assert tracking_kwargs(_body(slot_id="slot-123")) == {
            "slot_id": "slot-123",
            "video_clip_duration": 2,
        }

    def test_returns_both_ids_when_present(self):
        assert tracking_kwargs(_body(slot_id="slot-123", generation_id="gen-456")) == {
            "slot_id": "slot-123",
            "generation_id": "gen-456",
            "video_clip_duration": 2,
        }

    def test_omits_ids_when_absent(self):
        assert tracking_kwargs(_body()) == {"video_clip_duration": 2}

    def test_omits_empty_ids(self):
        assert tracking_kwargs(_body(slot_id="")) == {"video_clip_duration": 2}

    def test_records_explicit_pacing_values(self):
        body = _body(
            video_clip_duration=4,
            video_transition_mode="Crossfade",
            video_variation_seed=7,
        )
        assert tracking_kwargs(body) == {
            "video_clip_duration": 4,
            "video_transition_mode": "Crossfade",
            "video_variation_seed": 7,
        }

"""Tests that fill_schedule lifecycle stages emit PostHog analytics events.

The analytics helper itself is tested in test_analytics.py; these tests pin
the wiring so a refactor cannot silently drop an event.
"""

from __future__ import annotations

from app.services.fill_schedule import generate as gen_module
from app.services.fill_schedule import publish as pub_module
from app.services.fill_schedule import reconcile as rec_module


def test_generate_module_wires_track_event():
    """BatchGenerator imports track_event for video_generation_started/failed."""
    assert hasattr(gen_module, "track_event")
    assert callable(gen_module.track_event)


def test_reconcile_module_wires_track_event():
    """BatchReconciler imports track_event for video_generated."""
    assert hasattr(rec_module, "track_event")
    assert callable(rec_module.track_event)


def test_publish_module_wires_track_event():
    """BatchPublisher imports track_event for publish lifecycle events."""
    assert hasattr(pub_module, "track_event")
    assert callable(pub_module.track_event)


def test_generate_emits_requested_and_failed_event_names():
    """Verify the expected event names are used in generate.py.

    The batch funnel entry is video_generation_requested (fired before
    dispatch); the pipeline itself reports video_generation_started.
    """
    import inspect

    source = inspect.getsource(gen_module)
    # The event name itself lives in task.track_generation_requested;
    # generate.py pins the call site.
    assert "track_generation_requested" in source
    assert "video_generation_failed" in source


def test_reconcile_emits_generated_event_name():
    """Verify the expected event name is used in reconcile.py."""
    import inspect

    source = inspect.getsource(rec_module)
    assert "video_generated" in source


def test_publish_emits_lifecycle_event_names():
    """Verify the expected event names are used in publish.py."""
    import inspect

    source = inspect.getsource(pub_module)
    assert "video_publish_started" in source
    assert "video_published" in source
    assert "video_publish_failed" in source


def test_publish_tracking_context_carries_identity_props():
    """The publish lifecycle events attribute per task/user/schedule/persona."""
    context = pub_module._publish_tracking_context(
        {"id": "slot-1", "task_id": "task-9", "user_id": "user-1"},
        {"id": "sched-2", "user_id": "user-1", "persona_id": "persona-3"},
    )
    assert context["slotId"] == "slot-1"
    assert context["task_id"] == "task-9"
    assert context["user_id"] == "user-1"
    assert context["schedule_id"] == "sched-2"
    assert context["persona_id"] == "persona-3"


def test_publish_tracking_context_omits_blank_props():
    """Blank identity props are omitted, never blank strings in PostHog."""
    context = pub_module._publish_tracking_context(
        {"id": "slot-1", "task_id": ""},
        {"id": "", "user_id": "", "persona_id": None},
    )
    assert context == {"slotId": "slot-1"}


def test_publish_tracking_context_prefers_slot_user_id():
    """The slot row's user_id wins over the schedule embed (slot_user_id)."""
    context = pub_module._publish_tracking_context(
        {"id": "slot-1", "user_id": "user-slot"},
        {"id": "sched-2", "user_id": "user-sched"},
    )
    assert context["user_id"] == "user-slot"


class _FakeReconcileStore:
    """Minimal ScheduleStore double: one canned slot list, records updates."""

    def __init__(self, slots):
        self._slots = slots
        self.updated = []

    def generating_slots(self):
        return self._slots

    def update_slot(self, slot_id, **fields):
        self.updated.append((slot_id, fields))


class _FakeTaskState:
    def __init__(self, tasks):
        self._tasks = tasks

    def get_task(self, task_id):
        return self._tasks.get(task_id)


def _run_reconciler(slot, task_row):
    """Run one BatchReconciler tick; return the tracked video_generated props."""
    from datetime import datetime
    from unittest.mock import patch

    from app.models import const

    store = _FakeReconcileStore([slot])
    reconciler = rec_module.BatchReconciler(store, _FakeTaskState({"task-1": task_row}))
    with patch.object(rec_module, "track_event") as track:
        reconciler.run(datetime.now())
    assert track.call_count == 1, "expected one video_generated event"
    name, props = track.call_args[0]
    assert name == "video_generated"
    assert const.TASK_STATE_COMPLETE == task_row["state"]
    return props


def test_reconcile_attaches_cost_missing_reason_for_batch():
    """Batch video_generated carries cost_missing_reason when the row has no cost."""
    from app.models import const

    slot = {"id": "slot-1", "task_id": "task-1", "schedules": {}}
    task_row = {
        "state": const.TASK_STATE_COMPLETE,
        "cost_missing_reason": "intro_no_cost_reported",
    }
    props = _run_reconciler(slot, task_row)
    assert props["cost_missing_reason"] == "intro_no_cost_reported"
    assert "cost_usd" not in props


def test_reconcile_prefers_cost_usd_over_reason_for_batch():
    """When the row has a real cost, the reason stays off the batch event."""
    from app.models import const

    slot = {"id": "slot-1", "task_id": "task-1", "schedules": {}}
    task_row = {"state": const.TASK_STATE_COMPLETE, "cost_usd": 0.05}
    props = _run_reconciler(slot, task_row)
    assert props["cost_usd"] == 0.05
    assert "cost_missing_reason" not in props

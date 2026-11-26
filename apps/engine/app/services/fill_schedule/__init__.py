"""Publishing scheduler for uploaded media.

Slots are created by POST /api/media/publish-existing with a video or image
the user uploaded. The scheduler publishes each one at its time.

Components:
- store: Supabase read/write client (ScheduleStore).
- publish: BatchPublisher — publishes ready slots whose time has come.
- scheduler: FillScheduleScheduler — runs the publish stage one tick at a
  time; start_fill_schedule_thread runs the tick loop.
- support: shared helpers (slot_user_id, notify_safe).
- metadata: provider metadata mapping + publish-plan validation.
- constants: shared constants.
"""

from app.services.fill_schedule.constants import (
    SLOT_FAILED,
    SLOT_PUBLISHED,
    SLOT_PUBLISHING,
    SLOT_READY,
    TICK_SECONDS,
)
from app.services.fill_schedule.metadata import metadata_for, validate_publish_plan
from app.services.fill_schedule.publish import BatchPublisher
from app.services.fill_schedule.scheduler import (
    FillScheduleScheduler,
    start_fill_schedule_thread,
)
from app.services.fill_schedule.store import ScheduleStore, SupabaseAuthError
from app.services.fill_schedule.support import notify_safe, slot_user_id

__all__ = [
    "SLOT_FAILED",
    "SLOT_PUBLISHED",
    "SLOT_PUBLISHING",
    "SLOT_READY",
    "TICK_SECONDS",
    "BatchPublisher",
    "FillScheduleScheduler",
    "ScheduleStore",
    "SupabaseAuthError",
    "metadata_for",
    "notify_safe",
    "slot_user_id",
    "start_fill_schedule_thread",
    "validate_publish_plan",
]

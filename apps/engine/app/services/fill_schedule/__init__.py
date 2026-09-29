"""Batch scheduling pipeline (formerly "fill schedule").

Only manual batch schedules (created by POST /api/schedule/batch) are
processed: the user requests N videos, the pipeline generates them and
publishes each at its scheduled time. There is no automatic recurring
scheduling.

Components:
- store: Supabase read/write client (ScheduleStore).
- generate: BatchGenerator — dispatches video generation for pending slots.
- reconcile: BatchReconciler — advances generating slots whose tasks finished.
- publish: BatchPublisher — publishes ready slots whose time has come.
- scheduler: FillScheduleScheduler — orchestrates the three stages, one tick
  at a time; start_fill_schedule_thread runs the tick loop.
- support: shared helpers (token_cost, persona_for, slot_user_id,
  notify_safe, build_persona_params).
- metadata: provider metadata mapping + publish-plan validation.
- constants: shared constants.
"""

from app.services.fill_schedule.constants import (
    GENERATION_HORIZON_HOURS,
    SIGNED_URL_EXPIRES_SECONDS,
    SLOT_FAILED,
    SLOT_GENERATING,
    SLOT_PENDING,
    SLOT_PUBLISHED,
    SLOT_PUBLISHING,
    SLOT_READY,
    TICK_SECONDS,
)
from app.services.fill_schedule.generate import BatchGenerator, new_task_id
from app.services.fill_schedule.metadata import metadata_for, validate_publish_plan
from app.services.fill_schedule.publish import BatchPublisher
from app.services.fill_schedule.reconcile import BatchReconciler
from app.services.fill_schedule.scheduler import (
    FillScheduleScheduler,
    start_fill_schedule_thread,
)
from app.services.fill_schedule.store import ScheduleStore, SupabaseAuthError
from app.services.fill_schedule.support import (
    build_persona_params,
    notify_safe,
    persona_for,
    slot_user_id,
    token_cost,
)

__all__ = [
    "GENERATION_HORIZON_HOURS",
    "SIGNED_URL_EXPIRES_SECONDS",
    "SLOT_FAILED",
    "SLOT_GENERATING",
    "SLOT_PENDING",
    "SLOT_PUBLISHED",
    "SLOT_PUBLISHING",
    "SLOT_READY",
    "TICK_SECONDS",
    "BatchGenerator",
    "BatchPublisher",
    "BatchReconciler",
    "FillScheduleScheduler",
    "ScheduleStore",
    "SupabaseAuthError",
    "build_persona_params",
    "metadata_for",
    "new_task_id",
    "notify_safe",
    "persona_for",
    "slot_user_id",
    "start_fill_schedule_thread",
    "token_cost",
    "validate_publish_plan",
]

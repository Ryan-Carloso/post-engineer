"""Automatic Fill Schedule — the only scheduling feature.

Pipeline (100% agentic once the user enables the schedule):
1. Daily planning: for each active schedule, creates the slots for the next
   N days (weekdays + time window + posts/day, in the user's timezone).
   Idempotent: unique (schedule_id, slot_at). Batch schedules (kind='batch')
   are skipped — their slots are pre-materialized with exact datetimes by
   POST /api/schedule/batch.
2. Immediate generation: ``pending`` slots inside the horizon are dispatched
   right away — each due slot spawns its own pipeline thread via
   ``_dispatch_generation`` (the same immediate path as POST
   /persona-videos), so there is no batch queue and no 06h UTC cutoff.
   Batch schedules (kind='batch') are user-requested and prepaid at
   schedule creation (``batch:{scheduleId}``); they generate with the
   slot's stored topic and no LLM call. Recurring slots spend
   ``scheduled:{slotId}`` at dispatch and only generate when automatic
   video creation is explicitly enabled via ``fill_schedule_auto_generate``
   in config.toml [app] (default off).
3. Reconciliation: ``generating`` slots whose task finished become ``ready``
   (or ``failed``).
4. Publish tick: ``ready`` slots whose ``slot_at`` arrived are published via
   ``/api/upload-content`` (own pipeline — same contract as
   ``upload_publisher``, authenticated by ``MONEYPRINT_API_SECRET``).

Runs in-process in the engine (daemon thread). Generation starts
immediately when a slot becomes due — there is no batch queue; each due
slot spawns its own pipeline thread. The VPS needs no external cron.
"""

from __future__ import annotations

import hashlib
import os
import threading
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from loguru import logger

from app.models.schema import TaskVideoRequest
from app.services import notify as notify_module
from app.services import upload_publisher

DAYS_AHEAD = 7
GENERATION_HORIZON_HOURS = 24
TICK_SECONDS = 60
SIGNED_URL_EXPIRES_SECONDS = 24 * 3600  # max gap until generation

SLOT_PENDING = "pending"
SLOT_GENERATING = "generating"
SLOT_READY = "ready"
SLOT_PUBLISHING = "publishing"
SLOT_PUBLISHED = "published"
SLOT_FAILED = "failed"

# Manual video batches (POST /api/schedule/batch): finite, user-requested,
# prepaid at request time. Their slots carry the topic chosen by the user.
SCHEDULE_KIND_BATCH = "batch"


# ---------------------------------------------------------------------------
# Slots — pure function, testable without network
# ---------------------------------------------------------------------------
def compute_slots(
    days_of_week: list[int],
    start_hour: int,
    end_hour: int,
    posts_per_day: int,
    tz_name: str,
    now: datetime,
    days_ahead: int = DAYS_AHEAD,
    times: list[str] | None = None,
) -> list[datetime]:
    """UTC slots for the next ``days_ahead`` days of a schedule.

    Days are interpreted in the schedule's timezone (0 = Sunday). Within the
    [start_hour, end_hour] window the slots are evenly spaced, with a
    deterministic per-day jitter (date hash) so they don't look robotic.
    """
    tz = ZoneInfo(tz_name)
    local_now = now.astimezone(tz)
    slots: list[datetime] = []
    window = max(end_hour - start_hour, 0)

    for day_offset in range(1, days_ahead + 1):
        local_day = (local_now + timedelta(days=day_offset)).date()
        # isoweekday(): 1=Monday…7=Sunday → %7 maps Sunday to 0
        if (local_day.isoweekday() % 7) not in days_of_week:
            continue
        day_seed = int(hashlib.sha256(local_day.isoformat().encode()).hexdigest(), 16)
        jitter_minutes = day_seed % 60  # 0-59 min, deterministic per day

        selected_times = times or []
        count = len(selected_times) if selected_times else posts_per_day
        for index in range(count):
            # spread the slots across the window; jitter applies only to the first
            if selected_times:
                hour, minute = (int(part) for part in selected_times[index].split(':'))
                total_minutes = hour * 60 + minute + (5 + day_seed % 11)
                base_hour = 0
            else:
                fraction = (index + 0.5) / posts_per_day
                total_minutes = round(window * 60 * fraction) + (jitter_minutes if index == 0 else 0)
                total_minutes = min(total_minutes, window * 60)
                base_hour = start_hour
            slot_local = datetime(
                local_day.year,
                local_day.month,
                local_day.day,
                base_hour,
                tzinfo=tz,
            ) + timedelta(minutes=total_minutes)
            slots.append(slot_local.astimezone(timezone.utc))

    return sorted(slots)


# ---------------------------------------------------------------------------
# Store — PostgREST with the service role (same pattern as the old SupabaseState).
# The engine runs as a daemon (no user session), so it uses the service key
# which bypasses RLS; per-user isolation comes from the user_id stored on each
# schedule/slot row.
# ---------------------------------------------------------------------------
class SupabaseAuthError(RuntimeError):
    """Supabase rejected the service key (HTTP 401).

    Raised by ScheduleStore when PostgREST answers 401 so the tick log
    names the exact env var to fix instead of a raw "401 Client Error".
    """


class ScheduleStore:
    """Read/write ``schedules`` and ``scheduled_posts`` in Supabase."""

    SCHEDULE_SELECT = (
        "id,user_id,persona_id,kind,providers,youtube_account_ids,"
        "instagram_account_ids,linkedin_account_ids,"
        "days_of_week,start_hour,end_hour,posts_per_day,times,timezone,scheduled_at,"
        "personas(name,niche,script_prompt,language,video_aspect,"
        "photo_path,avatar_url,voice_id,voice_audio_path,paragraph_number,face_mix_percent,face_quality)"
    )
    SLOT_SELECT = (
        "*,schedules!inner("
        "id,user_id,kind,providers,youtube_account_ids,"
        "instagram_account_ids,linkedin_account_ids,"
        "personas(name,niche,script_prompt,language,video_aspect,"
        "photo_path,avatar_url,voice_id,voice_audio_path,paragraph_number,face_mix_percent,face_quality)"
        ")"
    )

    def __init__(
        self,
        url: str | None = None,
        service_key: str | None = None,
        requests_module: Any | None = None,
    ) -> None:
        import requests

        base_url = url or os.getenv("SUPABASE_URL")
        key = service_key or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not base_url:
            raise RuntimeError("SUPABASE_URL is required for fill_schedule")
        if not key:
            raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required for fill_schedule")
        self._requests = requests_module if requests_module is not None else requests
        self._base_url = base_url.rstrip("/")
        self._key = key
        self._headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        response = self._requests.request(
            method,
            f"{self._base_url}/rest/v1/{path}",
            headers=kwargs.pop("headers", self._headers),
            timeout=30,
            **kwargs,
        )
        try:
            response.raise_for_status()
        except Exception as exc:  # noqa: BLE001 - translated below when 401
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status == 401:
                raise SupabaseAuthError(
                    "Supabase rejected the request with 401 Unauthorized: "
                    "SUPABASE_SERVICE_ROLE_KEY in the engine environment is "
                    "invalid or has been rotated. Update the key and restart "
                    "the engine."
                ) from exc
            raise
        if response.status_code == 204 or not response.content:
            return None
        return response.json()

    def active_schedules(self) -> list[dict[str, Any]]:
        rows = self._request(
            "GET",
            "schedules",
            params={"active": "eq.true", "select": self.SCHEDULE_SELECT},
        )
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def insert_slots_ignore_duplicates(self, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        self._request(
            "POST",
            "scheduled_posts",
            json=rows,
            params={"on_conflict": "schedule_id,slot_at"},
            headers={**self._headers, "Prefer": "resolution=ignore-duplicates,return=minimal"},
        )

    def pending_slots(self, now_utc: datetime) -> list[dict[str, Any]]:
        horizon = (now_utc + timedelta(hours=self.generation_horizon_hours())).isoformat()
        rows = self._request(
            "GET",
            "scheduled_posts",
            params={
                "status": f"eq.{SLOT_PENDING}",
                "slot_at": f"lte.{horizon}",
                "select": self.SLOT_SELECT,
                "order": "slot_at.asc",
            },
        )
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def generating_slots(self) -> list[dict[str, Any]]:
        rows = self._request(
            "GET",
            "scheduled_posts",
            params={
                "status": f"eq.{SLOT_GENERATING}",
                "task_id": "not.is.null",
                "select": "*",
            },
        )
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def ready_due_slots(self, now_utc: datetime) -> list[dict[str, Any]]:
        rows = self._request(
            "GET",
            "scheduled_posts",
            params={
                "status": f"eq.{SLOT_READY}",
                "slot_at": f"lte.{now_utc.isoformat()}",
                "select": self.SLOT_SELECT,
                "order": "slot_at.asc",
            },
        )
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def update_slot(self, slot_id: str, **fields: Any) -> None:
        self._request(
            "PATCH",
            "scheduled_posts",
            json=fields,
            params={"id": f"eq.{slot_id}"},
        )

    def deactivate_schedule(self, schedule_id: str) -> None:
        self._request(
            "PATCH",
            "schedules",
            json={"active": False},
            params={"id": f"eq.{schedule_id}"},
        )

    def spend_tokens(self, user_id: str, generation_id: str, amount: int, reason: str) -> bool:
        result = self._request(
            "POST",
            "rpc/spend_tokens",
            json={
                "p_user_id": user_id,
                "p_amount": amount,
                "p_generation_id": generation_id,
                "p_reason": reason,
            },
            headers=self._headers,
        )
        return isinstance(result, dict) and result.get("spent") is True

    def refund_tokens(self, user_id: str, generation_id: str, reason: str) -> bool:
        result = self._request(
            "POST",
            "rpc/refund_generation_tokens",
            json={
                "p_user_id": user_id,
                "p_generation_id": generation_id,
                "p_reason": reason,
            },
            headers=self._headers,
        )
        return isinstance(result, dict) and result.get("refunded") is True

    def refund_batch_tokens(
        self,
        user_id: str,
        batch_generation_id: str,
        refund_key: str,
        amount: int,
        reason: str,
    ) -> bool:
        """Refund one prepaid video of a batch (see rpc/refund_batch_tokens)."""
        result = self._request(
            "POST",
            "rpc/refund_batch_tokens",
            json={
                "p_user_id": user_id,
                "p_batch_generation_id": batch_generation_id,
                "p_refund_key": refund_key,
                "p_amount": amount,
                "p_reason": reason,
            },
            headers=self._headers,
        )
        return isinstance(result, dict) and result.get("refunded") is True

    def claim_ready_slot(self, slot_id: str) -> bool:
        """Atomic ready→publishing claim (C2: avoids duplicate posts).

        Conditional PATCH: only transitions if the slot is STILL 'ready'.
        PostgREST returns the row when it wins the race, [] when another
        tick/process already claimed (or published) the slot.
        """
        rows = self._request(
            "PATCH",
            "scheduled_posts",
            json={"status": SLOT_PUBLISHING},
            params={"id": f"eq.{slot_id}", "status": f"eq.{SLOT_READY}"},
            headers={
                **self._headers,
                "Prefer": "return=representation",
            },
        )
        return bool(rows)

    def publishing_slots(self) -> list[dict[str, Any]]:
        rows = self._request(
            "GET",
            "scheduled_posts",
            params={
                "status": f"eq.{SLOT_PUBLISHING}",
                "select": "id,task_id,updated_at",
            },
        )
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def recover_stale_publishing(self, older_than_minutes: int = 120) -> int:
        """Stuck 'publishing' slots (crash mid-publish) → ready.

        Only acts on old slots (>120min): a legitimate multi-provider
        publish can take several minutes (video upload on a slow network).
        Returns the PostgREST count.
        """
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=older_than_minutes)).isoformat()
        self._request(
            "PATCH",
            "scheduled_posts",
            json={"status": SLOT_READY},
            params={
                "status": f"eq.{SLOT_PUBLISHING}",
                "updated_at": f"lt.{cutoff}",
            },
        )
        return 0

    def signed_url(self, bucket: str, path: str) -> str:
        """Signed URL valid long enough to reach the cutoff."""
        response = self._requests.post(
            f"{self._base_url}/storage/v1/object/sign/{bucket}/{path}",
            headers=self._headers,
            json={"expiresIn": SIGNED_URL_EXPIRES_SECONDS},
            timeout=30,
        )
        response.raise_for_status()
        signed: str = response.json()["signedURL"]
        return f"{self._base_url}/storage/v1{signed}"

    @staticmethod
    def generation_horizon_hours() -> int:
        """Generation horizon (hours ahead), configurable in config.toml.

        M1 — invalid/non-positive falls back to the default (24h) instead of
        breaking the whole pipeline every tick; cap of 168h (7 days = DAYS_AHEAD).
        """
        from app.config import config

        raw = config.app.get("fill_schedule_generation_horizon_hours", GENERATION_HORIZON_HOURS)
        try:
            horizon = int(raw)
        except (TypeError, ValueError):
            logger.warning(
                f"fill_schedule: invalid horizon {raw!r}, using default {GENERATION_HORIZON_HOURS}h"
            )
            return GENERATION_HORIZON_HOURS
        if horizon <= 0 or horizon > 168:
            logger.warning(
                f"fill_schedule: horizon {horizon}h outside 1..168, using default {GENERATION_HORIZON_HOURS}h"
            )
            return GENERATION_HORIZON_HOURS
        return horizon


# ---------------------------------------------------------------------------
# Topic — LLM with the persona's niche/prompt
# ---------------------------------------------------------------------------
def build_topic_prompt(niche: str, script_prompt: str, language: str) -> str:
    lang = {"pt": "português", "es": "espanhol", "en": "inglês"}.get((language or "en").lower(), "inglês")
    niche_line = f'The channel niche is: "{niche}". ' if niche else ""
    extra = f" {script_prompt}" if script_prompt else ""
    return (
        f"{niche_line}Propose ONE short video topic (max 12 words) for a social media "
        f"video. Reply with ONLY the topic text, no quotes, in {lang}.{extra}"
    )


def generate_topic(niche: str, script_prompt: str, language: str) -> str:
    from app.services import llm

    response = llm._generate_response_with_fallback(
        build_topic_prompt(niche, script_prompt, language)
    )
    lines = response.strip().strip('"').splitlines()
    topic = lines[0].strip() if lines else ""
    if not topic or topic.startswith("Error:"):
        raise RuntimeError(f"topic generation failed: {response[:200]}")
    return topic


# ---------------------------------------------------------------------------
# Payload — inline persona (same contract as the Next proxy)
# ---------------------------------------------------------------------------
def build_persona_params(persona: dict[str, Any], store: ScheduleStore) -> dict[str, Any]:
    params: dict[str, Any] = {"name": persona.get("name") or "Persona"}
    if persona.get("avatar_url"):
        params["avatar_url"] = persona["avatar_url"]
    elif persona.get("photo_path"):
        params["photo_url"] = store.signed_url("personas", persona["photo_path"])
    if persona.get("voice_id"):
        params["voice_id"] = persona["voice_id"]
    elif persona.get("voice_audio_path"):
        params["voice_audio_url"] = store.signed_url("personas", persona["voice_audio_path"])
    return params


# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------
class FillScheduleScheduler:
    """Orchestrates planning → generation → publishing, one tick at a time."""

    def __init__(
        self,
        store: ScheduleStore,
        task_state: Any,
        publish_video: Any = upload_publisher.publish_video,
        generate_topic_fn: Any = generate_topic,
        days_ahead: int = DAYS_AHEAD,
        notify: Any = notify_module.send_discord,
        auto_generate: bool | None = None,
    ) -> None:
        self.store = store
        self.task_state = task_state
        self.publish_video = publish_video
        self.generate_topic_fn = generate_topic_fn
        self.days_ahead = days_ahead
        self.notify = notify
        self.base_url = os.getenv("MPT_UPLOAD_API_BASE_URL", "").rstrip("/")
        self.api_secret = os.getenv("MONEYPRINT_API_SECRET", "")
        # Automatic video creation for RECURRING schedules is opt-in
        # (config.toml [app] fill_schedule_auto_generate). Manual batches
        # (kind='batch') are user-requested and prepaid, so they always
        # generate regardless of this flag.
        self.auto_generate = (
            auto_generate
            if auto_generate is not None
            else self._auto_stage_enabled("fill_schedule_auto_generate")
        )

    @staticmethod
    def _auto_stage_enabled(key: str) -> bool:
        """Read an automation opt-in flag from config.toml [app].

        Only an explicit true-ish value enables the stage; a missing key,
        false, or garbage keeps it disabled — automation must never turn
        itself on by accident.
        """
        from app.config import config

        try:
            value = config.app.get(key)
        except Exception:  # noqa: BLE001
            return False
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    def _safe_notify(self, message: str) -> None:
        """Discord fire-and-forget — a notification failure never kills the tick."""
        try:
            self.notify(message)
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"fill_schedule: notify failed: {notify_module.safe_reason(exc)}")

    # -- stages -----------------------------------------------------------
    def plan(self, now: datetime) -> int:
        """Create the slots for the coming days (idempotent).

        Batch schedules (kind='batch') are skipped: their slots are
        pre-materialized with exact datetimes by POST /api/schedule/batch.
        """
        created = 0
        for schedule in self.store.active_schedules():
            if schedule.get("kind") == SCHEDULE_KIND_BATCH:
                continue
            scheduled_at = schedule.get("scheduled_at")
            if scheduled_at:
                try:
                    parsed_at = datetime.fromisoformat(str(scheduled_at).replace("Z", "+00:00"))
                    if parsed_at.tzinfo is None:
                        raise ValueError("one-off scheduled_at must include a timezone")
                except ValueError as exc:
                    logger.warning(
                        f"fill_schedule: invalid one-off scheduled_at for {schedule.get('id')}: {exc}"
                    )
                    continue
                slots = [parsed_at.astimezone(timezone.utc)]
            else:
                slots = compute_slots(
                    days_of_week=[int(d) for d in schedule.get("days_of_week", [])],
                    start_hour=int(schedule["start_hour"]),
                    end_hour=int(schedule["end_hour"]),
                    posts_per_day=int(schedule.get("posts_per_day", 1)),
                    times=[str(value) for value in schedule.get("times", [])] or None,
                    tz_name=schedule.get("timezone", "UTC"),
                    now=now,
                    days_ahead=self.days_ahead,
                )
            self.store.insert_slots_ignore_duplicates(
                [
                    {
                        "schedule_id": schedule["id"],
                        "user_id": schedule["user_id"],
                        "slot_at": slot.isoformat(),
                    }
                    for slot in slots
                ]
            )
            if scheduled_at:
                self.store.deactivate_schedule(str(schedule["id"]))
            created += len(slots)
        return created

    def generate(self, now: datetime) -> int:
        """Start video generation immediately for pending slots in the horizon.

        Batch slots (kind='batch') are user-requested and prepaid: they always
        generate, using the slot's stored topic with no LLM call and no token
        spend. Recurring slots only generate when automatic video creation is
        explicitly enabled (``fill_schedule_auto_generate`` in config.toml
        [app]); otherwise they stay pending.
        """
        enqueued = 0
        enqueued_topics: list[str] = []
        for slot in self.store.pending_slots(now):
            schedule = slot.get("schedules") or {}
            is_batch = schedule.get("kind") == SCHEDULE_KIND_BATCH
            if not is_batch and not self.auto_generate:
                continue
            persona = self._persona_for(schedule)
            try:
                if is_batch:
                    # Prepaid at request time: the topic was chosen by the user
                    # and stored on the slot by POST /api/schedule/batch.
                    topic = str(slot.get("topic") or "").strip()
                    if not topic:
                        raise RuntimeError("Batch slot has no topic")
                    self._validate_publish_plan(schedule, topic)
                else:
                    # Pre-flight: validate providers/accounts BEFORE any spend
                    # (not even the topic LLM is spent if the publish plan is
                    # invalid). Caption depends on the topic, but the limits are
                    # revalidated at publish.
                    self._validate_publish_plan(schedule, "")
                    topic = self.generate_topic_fn(
                        persona.get("niche", ""),
                        persona.get("script_prompt") or "",
                        persona.get("language") or "en",
                    )
                request = TaskVideoRequest(
                    video_subject=topic,
                    persona=build_persona_params(persona, self.store),
                    video_aspect=persona.get("video_aspect") or "9:16",
                    video_script_prompt=persona.get("script_prompt") or "",
                    paragraph_number=(
                        int(persona["paragraph_number"])
                        if persona.get("paragraph_number") is not None
                        else None
                    ),
                )
                user_id = self._slot_user_id(slot)
                if user_id is None:
                    raise RuntimeError("Scheduled slot has no user_id")
                face_mix_percent = float(persona.get("face_mix_percent") or 0)
                face_quality = str(persona.get("face_quality") or "ok")
                cost = self._token_cost(face_mix_percent, face_quality)
                if is_batch:
                    # Prepaid by POST /api/schedule/batch under this id.
                    generation_id = f"batch:{schedule['id']}"
                else:
                    generation_id = f"scheduled:{slot['id']}"
                    if not self.store.spend_tokens(
                        user_id,
                        generation_id,
                        cost,
                        f"Scheduled video generation ({face_quality})",
                    ):
                        raise RuntimeError("Insufficient tokens for scheduled video generation")
                task_id = self._new_task_id(slot)
                try:
                    self._dispatch_generation(task_id, request, user_id)
                except Exception:
                    if is_batch:
                        # Refund just this video's prepaid cost; the batch id
                        # keeps the other videos' charges intact.
                        self.store.refund_batch_tokens(
                            user_id,
                            generation_id,
                            f"{generation_id}:slot:{slot['id']}",
                            cost,
                            "Batch generation could not be dispatched",
                        )
                    else:
                        self.store.refund_tokens(
                            user_id,
                            generation_id,
                            "Scheduled generation could not be dispatched",
                        )
                    raise
                self.store.update_slot(
                    slot["id"], status=SLOT_GENERATING, topic=topic, task_id=task_id
                )
                enqueued += 1
                enqueued_topics.append(f"{persona.get('name', 'Persona')}: {topic}")
            except Exception as exc:
                # A failed slot is a real recurring error: log at ERROR so the
                # Bugsink bridge (loguru sink, ERROR+) forwards it.
                logger.error(f"fill_schedule: slot {slot['id']} generation failed: {exc}")
                self.store.update_slot(slot["id"], status=SLOT_FAILED, error=str(exc)[:500])
                self._safe_notify(
                    notify_module.slot_failed_msg(
                        persona.get("name", "Persona"), "", notify_module.safe_reason(exc)
                    )
                )
        if enqueued:
            self._safe_notify(notify_module.generation_batch_msg(enqueued, enqueued_topics))
        return enqueued

    def _dispatch_generation(
        self, task_id: str, request: TaskVideoRequest, user_id: str
    ) -> None:
        """Start the video pipeline immediately for a due slot.

        This is the same immediate path the /persona-videos route uses:
        create the task state first (so ``reconcile()`` can observe it),
        then run the pipeline in a daemon thread so the tick never blocks
        on a long generation.
        """
        from app.services import task as tm

        self.task_state.update_task(task_id, user_id=user_id)
        thread = threading.Thread(
            target=tm.start,
            kwargs={"task_id": task_id, "params": request, "stop_at": "video"},
            name=f"fill-schedule-generate-{task_id}",
            daemon=True,
        )
        thread.start()

    def reconcile(self, now: datetime) -> int:
        """Slots whose generating tasks finished become ready/failed."""
        from app.models import const

        updated = 0
        for slot in self.store.generating_slots():
            task = self.task_state.get_task(str(slot["task_id"]))
            if task is None:
                continue
            if task.get("state") == const.TASK_STATE_COMPLETE:
                self.store.update_slot(slot["id"], status=SLOT_READY)
                updated += 1
            elif task.get("state") == const.TASK_STATE_FAILED:
                schedule = slot.get("schedules") or {}
                user_id = self._slot_user_id(slot)
                if schedule.get("kind") == SCHEDULE_KIND_BATCH:
                    # The batch was prepaid under `batch:{scheduleId}`, not
                    # `scheduled:{slotId}` — refunding the recurring key here
                    # would find no charge and silently keep the user's money.
                    if user_id is not None:
                        persona = self._persona_for(schedule)
                        cost = self._token_cost(
                            float(persona.get("face_mix_percent") or 0),
                            str(persona.get("face_quality") or "ok"),
                        )
                        batch_generation_id = f"batch:{schedule['id']}"
                        self.store.refund_batch_tokens(
                            user_id,
                            batch_generation_id,
                            f"{batch_generation_id}:slot:{slot['id']}",
                            cost,
                            "Batch generation failed",
                        )
                    else:
                        logger.error(
                            "fill_schedule: cannot refund failed batch slot without user_id",
                            slot_id=slot.get("id"),
                        )
                else:
                    generation_id = f"scheduled:{slot['id']}"
                    if user_id is not None:
                        self.store.refund_tokens(
                            user_id,
                            generation_id,
                            "Scheduled generation failed",
                        )
                    else:
                        logger.error(
                            "fill_schedule: cannot refund failed slot without user_id", slot_id=slot.get("id")
                        )
                self.store.update_slot(
                    slot["id"], status=SLOT_FAILED, error=str(task.get("error", ""))[:500]
                )
                updated += 1
        return updated

    @staticmethod
    def _token_cost(face_mix_percent: float, face_quality: str) -> int:
        mix = min(100.0, max(0.0, face_mix_percent)) / 100.0
        quality_price = 3 if face_quality == "very_good" else 2
        return max(1, int((mix * quality_price + (1 - mix)) + 0.999999))

    @staticmethod
    def _slot_user_id(slot: dict[str, Any]) -> str | None:
        user_id = slot.get("user_id")
        if isinstance(user_id, str) and user_id:
            return user_id
        schedule = slot.get("schedules")
        if isinstance(schedule, dict) and isinstance(schedule.get("user_id"), str):
            return str(schedule["user_id"])
        return None

    def publish_due(self, now: datetime) -> int:
        """Publish ready slots whose time has come. Return = published count.

        C2 — atomic claim before publishing: only whoever transitions
        ready→publishing (conditional PATCH) may call publish_video.
        Crash midway? The slot stays 'publishing' and recovery moves it back
        to 'ready' — never 'ready' directly, so it never re-publishes by mistake.
        """
        if not self.base_url or not self.api_secret:
            logger.warning("fill_schedule: publish skipped — MPT_UPLOAD_API_BASE_URL/MONEYPRINT_API_SECRET missing")
            return 0
        try:
            self.store.recover_stale_publishing()
        except Exception as exc:  # noqa: BLE001 — recovery is best-effort
            logger.warning(f"fill_schedule: stale publishing recovery failed: {notify_module.safe_reason(exc)}")

        published = 0
        for slot in self.store.ready_due_slots(now):
            schedule = slot.get("schedules") or {}
            topic = slot.get("topic") or "Scheduled post"
            persona_name = (schedule.get("personas") or {}).get("name", "Persona")
            if not self.store.claim_ready_slot(str(slot["id"])):
                # another tick/process already claimed (or published) this slot
                continue
            task = self.task_state.get_task(str(slot["task_id"]))
            videos = (task or {}).get("videos") or []
            if not videos:
                self.store.update_slot(
                    slot["id"], status=SLOT_FAILED, error="task has no finished videos"
                )
                continue
            try:
                for video_path in videos:
                    with open(video_path, "rb") as video_file:
                        video_bytes = video_file.read()
                    for provider in schedule.get("providers", []):
                        self.publish_video(
                            base_url=self.base_url,
                            api_secret=self.api_secret,
                            owner_user_id=schedule["user_id"],
                            metadata=self._metadata_for(str(provider), topic, schedule),
                            video_path=os.path.basename(video_path),
                            video_bytes=video_bytes,
                            content_type="video/mp4",
                        )
                self.store.update_slot(
                    slot["id"], status=SLOT_PUBLISHED, published_at=now.isoformat()
                )
                published += 1
                self._safe_notify(
                    notify_module.slot_published_msg(
                        persona_name,
                        topic,
                        [str(provider) for provider in schedule.get("providers", [])],
                    )
                )
            except (upload_publisher.PublishError, OSError) as exc:
                # The upstream response body (if any) is logged server-side
                # only — the Discord alert via safe_reason must not carry
                # remote-controlled response text.
                upstream = getattr(exc, "response_body", None)
                logger.warning(
                    f"fill_schedule: slot {slot['id']} publish failed: {exc}"
                    + (f" | upstream response: {upstream}" if upstream else "")
                )
                # back to 'ready' (not 'failed'): may be transient; the atomic
                # claim guarantees only one worker publishes at a time.
                self.store.update_slot(slot["id"], status=SLOT_READY)
                self._safe_notify(
                    notify_module.slot_failed_msg(
                        persona_name,
                        topic,
                        notify_module.safe_reason(exc),
                    )
                )
        return published

    def run_once(self, now: datetime) -> dict[str, int]:
        """One full tick (called by the thread every TICK_SECONDS).

        M1 — each stage isolated: a failure in one doesn't block the others.
        A stage that raises reports -1 in the result.
        """
        results: dict[str, int] = {}
        for stage_name, stage in (
            ("planned", self.plan),
            ("generated", self.generate),
            ("reconciled", self.reconcile),
            ("published", self.publish_due),
        ):
            try:
                results[stage_name] = stage(now)
            except Exception as exc:  # noqa: BLE001
                # A failed tick stage is a real recurring error: log at ERROR
                # so the Bugsink bridge (loguru sink, ERROR+) forwards it.
                logger.error(f"fill_schedule: stage {stage_name} failed: {notify_module.safe_reason(exc)}")
                results[stage_name] = -1
        if any(value != 0 for value in results.values()):
            logger.info(f"fill_schedule tick: {results}")
        return results

    # -- helpers ------------------------------------------------------------
    def _persona_for(self, schedule: dict[str, Any]) -> dict[str, Any]:
        persona = schedule.get("personas")
        if not isinstance(persona, dict):
            raise RuntimeError(f"schedule {schedule.get('id')} has no persona embed")
        return persona

    def _new_task_id(self, slot: dict[str, Any]) -> str:
        """Deterministic task id per slot (uuid5) — M4: if the engine crashes
        between dispatch and update_slot(generating), the next tick's
        re-dispatch generates the SAME id instead of creating a second
        orphan task (duplicate GPU cost)."""
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"fill-schedule:{slot['id']}"))

    def _metadata_for(self, provider: str, topic: str, schedule: dict[str, Any]):
        if provider == upload_publisher.YOUTUBE_PROVIDER:
            return upload_publisher.YouTubeMetadata(
                title=topic[:100],
                description=topic,
                tags=(),
                privacy_status="public",
                account_ids=tuple(str(value) for value in schedule.get("youtube_account_ids", [])),
            )
        if provider == upload_publisher.LINKEDIN_PROVIDER:
            return upload_publisher.LinkedInMetadata(
                caption=topic[: upload_publisher.LINKEDIN_CAPTION_MAX_LENGTH],
                account_ids=tuple(str(value) for value in schedule.get("linkedin_account_ids", [])),
            )
        if provider == upload_publisher.INSTAGRAM_PROVIDER:
            return upload_publisher.InstagramMetadata(
                caption=topic[:2200],
                account_ids=tuple(str(value) for value in schedule.get("instagram_account_ids", [])),
            )
        if provider == upload_publisher.BLUESKY_PROVIDER:
            return upload_publisher.BlueskyMetadata(
                caption=upload_publisher.truncate_bluesky_caption(topic),
                account_ids=tuple(str(value) for value in schedule.get("bluesky_account_ids", [])),
            )
        raise RuntimeError(f"unsupported schedule provider: {provider}")

    def _validate_publish_plan(self, schedule: dict[str, Any], topic: str) -> None:
        """Pre-flight of the publish plan BEFORE generating the video.

        Validates providers, accounts and caption limits with the real topic;
        any problem fails the slot here, without spending tokens/money
        on a generation that could never be published.
        """
        providers = [str(provider) for provider in schedule.get("providers", [])]
        youtube = None
        instagram = None
        bluesky = None
        linkedin = None
        for provider in providers:
            metadata = self._metadata_for(provider, topic, schedule)
            if isinstance(metadata, upload_publisher.YouTubeMetadata):
                youtube = metadata
            elif isinstance(metadata, upload_publisher.InstagramMetadata):
                instagram = metadata
            elif isinstance(metadata, upload_publisher.BlueskyMetadata):
                bluesky = metadata
            elif isinstance(metadata, upload_publisher.LinkedInMetadata):
                linkedin = metadata
        upload_publisher.validate_publish_metadata(
            providers, youtube, instagram, bluesky=bluesky, linkedin=linkedin
        )


def start_fill_schedule_thread(scheduler: FillScheduleScheduler) -> threading.Thread:
    """Daemon thread that runs the tick; same pattern as the persona batch loop."""
    import time

    def loop() -> None:
        while True:
            try:
                scheduler.run_once(datetime.now(timezone.utc))
            except Exception:
                logger.exception("fill_schedule tick failed")
            time.sleep(TICK_SECONDS)

    thread = threading.Thread(target=loop, name="fill-schedule-scheduler", daemon=True)
    thread.start()
    return thread

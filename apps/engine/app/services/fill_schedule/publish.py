"""Publishing: publish ready batch slots whose time has come."""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any

from loguru import logger

from app.services import notify as notify_module
from app.services import upload_publisher
from app.services.analytics import scrub_secret_values, track_event
from app.services.fill_schedule.constants import (
    SLOT_FAILED,
    SLOT_PUBLISHED,
    SLOT_READY,
)
from app.services.fill_schedule.metadata import metadata_for
from app.services.fill_schedule.store import ScheduleStore
from app.services.fill_schedule.support import notify_safe


class BatchPublisher:
    """Publishes due batch slots to their providers."""

    def __init__(
        self,
        store: ScheduleStore,
        task_state: Any,
        publish_video: Any = upload_publisher.publish_video,
        notify: Any = notify_module.send_discord,
    ) -> None:
        self.store = store
        self.task_state = task_state
        self.publish_video = publish_video
        self.notify = notify
        self.base_url = os.getenv("MPT_UPLOAD_API_BASE_URL", "").rstrip("/")
        self.api_secret = os.getenv("MONEYPRINT_API_SECRET", "")

    def run(self, now: datetime) -> int:
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
            track_event("video_publish_started", {"slotId": str(slot["id"])})
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
                            metadata=metadata_for(str(provider), topic, schedule),
                            video_path=os.path.basename(video_path),
                            video_bytes=video_bytes,
                            content_type="video/mp4",
                        )
                self.store.update_slot(
                    slot["id"], status=SLOT_PUBLISHED, published_at=now.isoformat()
                )
                published += 1
                track_event(
                    "video_published",
                    {
                        "slotId": str(slot["id"]),
                        "providers": [str(p) for p in schedule.get("providers", [])],
                    },
                )
                notify_safe(
                    self.notify,
                    notify_module.slot_published_msg(
                        persona_name,
                        topic,
                        [str(provider) for provider in schedule.get("providers", [])],
                    ),
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
                track_event(
                    "video_publish_failed",
                    {
                        "slotId": str(slot["id"]),
                        "reason": scrub_secret_values(str(exc)[:200]),
                        "retryable": True,
                    },
                )
                notify_safe(
                    self.notify,
                    notify_module.slot_failed_msg(
                        persona_name,
                        topic,
                        notify_module.safe_reason(exc),
                    ),
                )
        return published

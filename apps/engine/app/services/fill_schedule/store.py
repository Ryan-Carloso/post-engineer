"""Supabase read/write client for the batch scheduling pipeline."""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any

from loguru import logger

from app.services.fill_schedule.constants import (
    GENERATION_HORIZON_HOURS,
    SIGNED_URL_EXPIRES_SECONDS,
    SLOT_GENERATING,
    SLOT_PENDING,
    SLOT_PUBLISHING,
    SLOT_READY,
)


class SupabaseAuthError(RuntimeError):
    """Supabase rejected the service key (HTTP 401).

    Raised so the tick log names the exact env var to fix instead of a
    raw "401 Client Error".
    """


class ScheduleStore:
    """Read/write ``schedules`` and ``scheduled_posts`` in Supabase."""

    SLOT_SELECT = (
        "*,schedules!inner("
        "id,user_id,persona_id,providers,youtube_account_ids,"
        "instagram_account_ids,linkedin_account_ids,bluesky_account_ids,"
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
        # The reconciler refunds under `batch:{scheduleId}`.
        rows = self._request(
            "GET",
            "scheduled_posts",
            params={
                "status": f"eq.{SLOT_GENERATING}",
                "task_id": "not.is.null",
                "select": "*,schedules(id)",
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

    def spend_tokens(self, user_id: str, generation_id: str, amount: int, reason: str) -> bool:
        # Used by the batch billing flow (video.py); the scheduler itself
        # never spends — batches are prepaid at request time.
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
        # Used by the batch billing flow (video.py).
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
        breaking the whole pipeline every tick; cap of 168h (7 days).
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

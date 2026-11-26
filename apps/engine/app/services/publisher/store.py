"""Supabase read/write client for the batch scheduling pipeline."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import requests
from loguru import logger

from app.services.publisher.constants import (
    SLOT_PUBLISHING,
    SLOT_READY,
)
from app.utils.supabase_retry import (
    CONNECT_RETRIES as CONNECT_RETRIES,
)
from app.utils.supabase_retry import build_retrying_session, set_retry_budget

REQUEST_TIMEOUT_SECONDS = (10, 30)


class SupabaseAuthError(RuntimeError):
    """Supabase rejected the service key (HTTP 401).

    Raised so the tick log names the exact env var to fix instead of a
    raw "401 Client Error".
    """


class ScheduleStore:
    """Read/write ``schedules`` and ``scheduled_posts`` in Supabase."""

    SLOT_IDENTITY_SELECT = (
        "id,user_id,persona_id,providers,youtube_account_ids,"
        "instagram_account_ids,linkedin_account_ids,bluesky_account_ids,threads_account_ids,"
        "facebook_account_ids,pinterest_account_ids,pinterest_board_id,threespeak_account_ids,"
        "rumble_account_ids,fanvue_account_ids,telegram_account_ids,"
        "personas(name,ai_label)"
    )

    SLOT_SELECT = "*,schedules!left(" + SLOT_IDENTITY_SELECT + ")"

    def __init__(
        self,
        url: str | None = None,
        service_key: str | None = None,
        requests_module: Any | None = None,
    ) -> None:
        base_url = url or os.getenv("SUPABASE_URL")
        key = service_key or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not base_url:
            raise RuntimeError("SUPABASE_URL is required for publisher")
        if not key:
            raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required for publisher")
        self._requests = requests_module if requests_module is not None else build_retrying_session()
        self.connect_retries = CONNECT_RETRIES
        self._base_url = base_url.rstrip("/")
        self._key = key
        self._headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def set_connect_retries(self, count: int) -> None:
        """Arm (or disarm) the connect-retry budget for subsequent requests.

        The scheduler calls this with 0 once a stage has failed in the
        current tick: a stage failure means Supabase is already known-bad, and
        re-paying the full connect budget on every later stage would stretch
        the tick past TICK_SECONDS without recovering anything. It re-arms at
        the top of the next tick, so a transient blip costs one tick only.

        Mutates the mounted adapter in place (set_retry_budget), so the
        session, its auth headers and its pooled connections all survive.
        """
        self.connect_retries = count
        if isinstance(self._requests, requests.Session):
            set_retry_budget(self._requests, count)

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        response = self._requests.request(
            method,
            f"{self._base_url}/rest/v1/{path}",
            headers=kwargs.pop("headers", self._headers),
            timeout=REQUEST_TIMEOUT_SECONDS,
            **kwargs,
        )
        try:
            response.raise_for_status()
        except Exception as exc:
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

    def ready_due_slots(self, now_utc: datetime) -> list[dict[str, Any]]:
        rows = self._request(
            "GET",
            "scheduled_posts",
            params={
                "status": f"eq.{SLOT_READY}",
                "slot_at": f"lte.{now_utc.isoformat()}",
                "or": (
                    "(publish_not_before.is.null,"
                    f"publish_not_before.lte.{now_utc.isoformat()})"
                ),
                "select": self.SLOT_SELECT,
                "order": "slot_at.asc",
            },
        )
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def persona_bound_accounts(self, persona_id: str) -> dict[str, list[str]]:
        """The persona's bound publishing accounts (issue #572), grouped per provider.

        Read from persona_default_accounts at publish time: the binding is
        the source of truth, so an account unbound after scheduling never
        publishes. Malformed rows are skipped, never crash the tick.
        """
        rows = self._request(
            "GET",
            "persona_default_accounts",
            params={"persona_id": f"eq.{persona_id}", "select": "provider,provider_account_id"},
        )
        bound: dict[str, list[str]] = {}
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            provider = row.get("provider")
            account_id = row.get("provider_account_id")
            if isinstance(provider, str) and isinstance(account_id, str) and account_id:
                bound.setdefault(provider, []).append(account_id)
        return bound

    def update_slot(self, slot_id: str, **fields: Any) -> None:
        self._request(
            "PATCH",
            "scheduled_posts",
            json=fields,
            params={"id": f"eq.{slot_id}"},
        )

    def claim_ready_slot(self, slot_id: str, now_utc: datetime) -> bool:
        """Atomic ready→publishing claim (C2: avoids duplicate posts).

        Conditional PATCH: only transitions if the slot is STILL 'ready'
        AND still due (slot_at <= now). The due re-check closes the
        reschedule race (issue #555): a ready slot rescheduled to the
        future between the due snapshot and this claim must not publish
        at its old time — the claim loses and the slot is picked up on a
        later tick at its new time. PostgREST returns the row when it
        wins the race, [] when another tick/process already claimed (or
        published) the slot, or when the slot is no longer due.
        """
        rows = self._request(
            "PATCH",
            "scheduled_posts",
            json={"status": SLOT_PUBLISHING},
            params={
                "id": f"eq.{slot_id}",
                "status": f"eq.{SLOT_READY}",
                "slot_at": f"lte.{now_utc.isoformat()}",
            },
            headers={
                **self._headers,
                "Prefer": "return=representation",
            },
        )
        return bool(rows)

    def get_video_upload(self, upload_id: str) -> dict[str, Any] | None:
        """One video_uploads row by id (issue #384)."""
        rows = self._request(
            "GET",
            "video_uploads",
            params={"id": f"eq.{upload_id}", "select": "*", "limit": 1},
        )
        if not rows:
            return None
        row = rows[0]
        return row if isinstance(row, dict) else None

    def claim_video_upload(self, upload_id: str) -> dict[str, Any] | None:
        """Atomic ready→consumed claim for a signed-upload video (issue #384).

        Conditional PATCH: only transitions if the row is STILL 'ready'.
        The web route extended the expiry at schedule time, but a
        concurrent publish (or a sweep) may have consumed it first — the
        claim loses and the slot fails permanently instead of publishing
        twice. PostgREST returns the row when it wins, [] otherwise.
        """
        rows = self._request(
            "PATCH",
            "video_uploads",
            json={
                "status": "consumed",
                "consumed_at": datetime.now(timezone.utc).isoformat(),
            },
            params={"id": f"eq.{upload_id}", "status": "eq.ready"},
            headers={
                **self._headers,
                "Prefer": "return=representation",
            },
        )
        if not rows:
            return None
        row = rows[0]
        return row if isinstance(row, dict) else None

    def download_storage_object(self, bucket: str, path: str) -> bytes:
        """Download one object from Supabase Storage (issue #384).

        The authenticated endpoint serves private buckets with the service
        key. The path comes from a row the engine already verified (a
        claimed upload, or a slot's own scheduled-media path), never from
        caller input.
        """
        response = self._requests.get(
            f"{self._base_url}/storage/v1/object/authenticated/{bucket}/{path}",
            headers=self._headers,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return response.content

    def remove_storage_object(self, bucket: str, path: str) -> bool:
        """Delete one object from Supabase Storage (issue #384).

        Best-effort cleanup for single-use media after a terminal publish
        outcome: False (never an exception) when the object is already
        gone or the delete fails, so a missing object never fails the tick.
        """
        try:
            response = self._requests.delete(
                f"{self._base_url}/storage/v1/object/{bucket}/{path}",
                headers=self._headers,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
        except Exception as exc:
            logger.warning(
                f"publisher: storage object removal failed for {bucket}/{path}: {exc}"
            )
            return False
        return True

    def resumable_publishing_slots(self, now_utc: datetime) -> list[dict[str, Any]]:
        """Publishing slots whose backoff (or crash lease) has elapsed.

        `publish_not_before` null covers a crash that never parked a lease.
        A normal 30s/2min wait stays hidden until that timestamp.
        """
        rows = self._request(
            "GET",
            "scheduled_posts",
            params={
                "status": f"eq.{SLOT_PUBLISHING}",
                "or": (
                    "(publish_not_before.is.null,"
                    f"publish_not_before.lte.{now_utc.isoformat()})"
                ),
                "select": self.SLOT_SELECT,
                "order": "slot_at.asc",
            },
        )
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def claim_resumable_slot(self, slot_id: str, now_iso: str, lease_iso: str) -> bool:
        """One worker resumes a publishing slot and holds it until ``lease_iso``.

        The PATCH matches only while the backoff is still due, then moves
        `publish_not_before` forward. A second worker sees no row.
        """
        rows = self._request(
            "PATCH",
            "scheduled_posts",
            json={"publish_not_before": lease_iso},
            params={
                "id": f"eq.{slot_id}",
                "status": f"eq.{SLOT_PUBLISHING}",
                "or": f"(publish_not_before.is.null,publish_not_before.lte.{now_iso})",
            },
            headers={**self._headers, "Prefer": "return=representation"},
        )
        return bool(rows)

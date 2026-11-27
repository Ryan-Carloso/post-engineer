from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from loguru import logger

from app.services.analytics import scrub_error_text
from app.services.publisher.support import slot_user_id

CHUNK_SIZE = 100


def parse_access_until(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)


def access_states(store: Any, user_ids: list[str], now: datetime) -> dict[str, bool | None]:
    states: dict[str, bool | None] = {}
    unique = [uid for uid in dict.fromkeys(user_ids) if uid]
    if not callable(getattr(store, "access_until_by_user", None)):
        return {uid: None for uid in unique}
    for start in range(0, len(unique), CHUNK_SIZE):
        chunk = unique[start : start + CHUNK_SIZE]
        try:
            rows = store.access_until_by_user(chunk)
        except Exception as exc:
            logger.warning(
                f"publisher: access lookup failed for {len(chunk)} user(s): "
                f"{scrub_error_text(str(exc), max_chars=200)}"
            )
            for uid in chunk:
                states[uid] = None
            continue
        if not isinstance(rows, dict):
            for uid in chunk:
                states[uid] = None
            continue
        for uid in chunk:
            until = parse_access_until(rows.get(uid))
            states[uid] = None if until is None else until > now
    return states


def partition_slots(
    slots: list[dict[str, Any]], states: dict[str, bool | None]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    active: list[dict[str, Any]] = []
    inactive: list[dict[str, Any]] = []
    unknown: list[dict[str, Any]] = []
    for slot in slots:
        uid = slot_user_id(slot)
        state = states.get(uid) if uid is not None else None
        if state is True:
            active.append(slot)
        elif state is False:
            inactive.append(slot)
        else:
            unknown.append(slot)
    return active, inactive, unknown

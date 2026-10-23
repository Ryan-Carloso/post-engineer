"""Job-time checks: user-scoped Chatterbox clone keys must match the caller."""

from __future__ import annotations

import re

# Engine registry keys: u{12 hex of user uuid}_{12 hex of clone uuid}
_USER_CLONE_KEY_RE = re.compile(r"^u([0-9a-f]{12})_([0-9a-f]{12})$", re.IGNORECASE)


def user_id_prefix(user_id: str) -> str:
    return user_id.replace("-", "")[:12].lower()


def is_user_clone_engine_key(engine_key: str) -> bool:
    return bool(_USER_CLONE_KEY_RE.match(engine_key.strip()))


def user_owns_clone_engine_key(user_id: str, engine_key: str) -> bool:
    """True when engine_key is a per-user clone belonging to user_id."""
    match = _USER_CLONE_KEY_RE.match(engine_key.strip())
    if match is None:
        return False
    return match.group(1).lower() == user_id_prefix(user_id)


def chatterbox_voice_allowed_for_user(user_id: str | None, chatterbox_voice: str) -> bool:
    """House voices (en_us_male_01, etc.) are allowed; user clone keys require ownership."""
    name = chatterbox_voice.strip()
    if not is_user_clone_engine_key(name):
        return True
    if not user_id or not user_id.strip():
        return False
    return user_owns_clone_engine_key(user_id.strip(), name)

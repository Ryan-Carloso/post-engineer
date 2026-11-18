"""Per-photo on-screen seconds for a full-frame photo (segment pacing).

A segment photo may carry ``duration``: how many seconds it stays on
screen, so the agent can hold the turning-point photo longer or flash
one briefly instead of every photo ticking at the same 2s pace.
Without it the layout is exactly the old one (at most
MAX_PHOTO_SECONDS per photo, paced to the segment slices).

The bounds are the contract, pinned by a sync test against the shared
TS validator and the MCP tool shape: the validators reject anything
outside them before charging, and the layout falls back to the default
pace for anything that reaches it unchecked, so no photo ever stays on
screen past the maximum.
"""

import math
from typing import Any, Optional

# A requested photo stays on screen at least this long: shorter is a
# flicker, not a beat (the density minimum already gives each photo
# about 1s of speech).
MIN_REQUESTED_PHOTO_SECONDS = 0.5
# ... and at most this long: three times the default cap, long enough
# to hold a turning-point beat while the slow zoom keeps the frame
# alive. Longer stills read as frozen.
MAX_REQUESTED_PHOTO_SECONDS = 6.0


def duration_error(value: Any) -> Optional[tuple[str, str]]:
    """(rule, fix) when value is not a usable requested duration, else None.

    A missing value is usable: it means the default pace. Booleans are
    not numbers here (bool is an int subclass), and NaN/inf never pass
    a range check honestly, so both are rejected outright.
    """
    if value is None:
        return None
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        return (
            "duration must be a number of seconds.",
            "Send a duration in seconds, or omit it for the default 2s pace.",
        )
    if value < MIN_REQUESTED_PHOTO_SECONDS or value > MAX_REQUESTED_PHOTO_SECONDS:
        return (
            f"duration must be between {MIN_REQUESTED_PHOTO_SECONDS:g} and "
            f"{MAX_REQUESTED_PHOTO_SECONDS:g} seconds.",
            "Send a duration in seconds, or omit it for the default 2s pace.",
        )
    return None


def photo_cap(requested: Any, default: float) -> float:
    """On-screen seconds for one photo: the request, or the default pace.

    The layout never trusts a duration it did not validate: an invalid
    value falls back to the default, so a photo that bypassed
    validation still cannot run past the maximum.
    """
    if requested is None or duration_error(requested) is not None:
        return default
    return min(max(float(requested), MIN_REQUESTED_PHOTO_SECONDS), MAX_REQUESTED_PHOTO_SECONDS)

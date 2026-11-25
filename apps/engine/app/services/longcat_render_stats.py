"""Render telemetry from a done LongCat job, shaped for the ai_request event.

The Modal app reports how each clip was rendered (resolution, segment count,
GPU, acceleration flags) and where its GPU time went (audio embedding, each
diffusion segment, encode, normalize). Sending those with the job's cost is
what lets PostHog answer "what does one segment cost on this build" and
compare builds with and without an acceleration.

The payload comes from a remote service, so every field is guarded: a number
must be finite and non-negative (bool excluded), a label must be a short plain
token. A field that fails its guard is left out, never zeroed.
"""

from __future__ import annotations

import math
import re
from typing import Final

_LABEL_RE: Final = re.compile(r"^[A-Za-z0-9_.+\- ]{1,64}$")
_LABEL_FIELDS: Final[tuple[str, ...]] = ("resolution", "gpu", "accel")
_TIMING_FIELDS: Final[tuple[str, ...]] = (
    "inference_s",
    "normalize_s",
    "audio_embed_s",
    "encode_s",
    "peak_vram_gb",
)


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value < 0:
        return None
    return float(value)


def _label(value: object) -> str | None:
    if isinstance(value, str) and _LABEL_RE.match(value):
        return value
    return None


def _segment_seconds(value: object) -> list[float] | None:
    if not isinstance(value, list) or not value:
        return None
    seconds = [_number(item) for item in value]
    if any(item is None for item in seconds):
        return None
    return [item for item in seconds if item is not None]


def render_stats_props(status: dict[str, object]) -> dict[str, object]:
    """ai_request properties describing how a done job was rendered."""
    props: dict[str, object] = {}
    for field in _LABEL_FIELDS:
        label = _label(status.get(field))
        if label is not None:
            props[field] = label
    segments = status.get("num_segments")
    num_segments = (
        segments
        if isinstance(segments, int) and not isinstance(segments, bool) and segments > 0
        else None
    )
    if num_segments is not None:
        props["num_segments"] = num_segments
    timings = status.get("timings")
    if isinstance(timings, dict):
        for field in _TIMING_FIELDS:
            value = _number(timings.get(field))
            if value is not None:
                props[field] = value
        segment_s = _segment_seconds(timings.get("segment_s"))
        if segment_s is not None:
            props["segment_s_avg"] = round(sum(segment_s) / len(segment_s), 3)
            props["segment_s_max"] = max(segment_s)
            if len(segment_s) > 1:
                continuation = segment_s[1:]
                props["continuation_segment_s_avg"] = round(
                    sum(continuation) / len(continuation), 3
                )
    cost = _number(status.get("cost_usd"))
    if cost is not None and num_segments is not None:
        props["cost_per_segment_usd"] = round(cost / num_segments, 4)
    return props

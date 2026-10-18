"""Persona hook measurement and retry helpers.

Extracted from app.services.task so the task module stays under the
file-size ratchet. These helpers only measure where the hook paragraph ends
in the subtitles and clean up a subtitle invalidated by a hook retry.
This module imports nothing from app.services, so there is no import cycle.
"""

import os
import re
from typing import Sequence

from loguru import logger

from app.config import config


# A hook that misses the quality window is only a cosmetic miss: the intro
# runs shorter or longer than ideal, but the video is still watchable.
# Failing the whole generation over it punishes the user for LLM variance,
# so once the retries are exhausted the pipeline ships the best effort
# instead. Past this duration the intro is structurally broken (it eats the
# opening and no retry can salvage it), so the task still fails as before.
PERSONA_HOOK_HARD_FAIL_SECONDS = 15.0


def resolve_exhausted_hook(
    end_seconds: float, window_min: float, window_max: float, attempts: int
) -> None:
    """Terminal decision after the persona hook retries are exhausted.

    Raises only when the hook runs past PERSONA_HOOK_HARD_FAIL_SECONDS.
    Otherwise logs the best-effort shipment and returns, letting the caller
    proceed with the mistimed hook instead of failing the user's video.
    """
    if end_seconds > PERSONA_HOOK_HARD_FAIL_SECONDS:
        raise ValueError(
            f"persona hook must end between {window_min:g} and "
            f"{window_max:g} seconds, got {end_seconds:g}"
        )
    logger.warning(
        f"persona hook ended at {end_seconds:g}s, outside the "
        f"{window_min:g}-{window_max:g}s window after {attempts} attempts; "
        "shipping best effort instead of failing the task"
    )


def _find_hook_end_seconds(
    video_script: str,
    subtitles: Sequence[tuple[int, str, str]],
) -> float:
    """Return the raw subtitle end boundary of the first script paragraph.

    Raises ValueError for structural problems (fewer than two paragraphs,
    hook without terminal punctuation, hook not found in the subtitles).
    The 3-6s window check lives in persona_hook_end_seconds so callers that
    need the raw measurement (e.g. the hook retry) can decide for themselves.
    """
    paragraphs = [
        paragraph.strip()
        for paragraph in re.split(r"\n\s*\n", video_script.strip())
        if paragraph.strip()
    ]
    if len(paragraphs) < 2:
        raise ValueError("persona script must contain at least two paragraphs")
    if not re.search(r"[.!?。！？]$", paragraphs[0]):
        raise ValueError("persona hook must end with terminal punctuation")

    def normalize(text: str) -> str:
        return re.sub(r"[^\w]+", "", text.casefold())

    hook = normalize(paragraphs[0])
    spoken = ""
    for _, timing, text in subtitles:
        match = re.search(
            r"\d+:\d+:\d+[,\.]\d+\s*-->\s*(\d+):(\d+):(\d+)[,\.](\d+)",
            timing,
        )
        if match is None:
            continue
        spoken += normalize(text)
        if hook and hook in spoken:
            return (
                int(match.group(1)) * 3600
                + int(match.group(2)) * 60
                + int(match.group(3))
                + int(match.group(4)) / 1000
            )

    raise ValueError("could not locate hook paragraph in subtitle timestamps")


def persona_hook_end_seconds(
    video_script: str,
    subtitles: Sequence[tuple[int, str, str]],
    minimum_seconds: float = 3.0,
    maximum_seconds: float = 6.0,
) -> float:
    """Return the subtitle boundary that completes the first script paragraph."""
    end_seconds = _find_hook_end_seconds(video_script, subtitles)
    if not minimum_seconds <= end_seconds <= maximum_seconds:
        raise ValueError(
            f"persona hook must end between {minimum_seconds:g} and "
            f"{maximum_seconds:g} seconds, got {end_seconds:g}"
        )
    return end_seconds


def _discard_stale_subtitle(subtitle_path: str) -> None:
    """Delete a subtitle that no longer matches the script it was cut from.

    Best-effort on purpose: a missing file is already the state we want, and a
    locked file must not fail the retry — the regenerated subtitle simply
    overwrites it.
    """
    if not subtitle_path:
        return
    try:
        os.remove(subtitle_path)
    except FileNotFoundError:
        return
    except OSError as exc:
        logger.warning(
            f"could not remove the stale subtitle {subtitle_path}: {exc}; "
            "the regenerated subtitle may be skipped by the whisper fallback"
        )


def _limit_generated_script(script: str) -> str:
    """Keep generated speech inside the configured character budget."""
    limit = int(config.app.get("max_video_script_characters", 700))
    normalized = re.sub(r"[ \t]+", " ", script.strip())
    if len(normalized) <= limit:
        return normalized
    candidate = normalized[:limit]
    sentence_end = max(candidate.rfind(mark) for mark in ".!?。！？")
    if sentence_end >= 0:
        return candidate[: sentence_end + 1].strip()
    word_end = candidate.rfind(" ")
    return candidate[: word_end if word_end > 0 else limit].strip()

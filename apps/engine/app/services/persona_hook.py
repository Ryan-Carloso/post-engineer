"""Persona hook measurement, retry, and telemetry helpers.

Extracted from app.services.task so the task module stays under the
file-size ratchet. The app.services imports here are leaf modules (llm,
analytics) that never import back into the task pipeline, so there is no
import cycle.
"""

import os
import re
from typing import Sequence

from loguru import logger

from app.config import config
from app.models.schema import VideoParams
from app.services import llm
from app.services.analytics import track_event


# Product-fixed hook pacing ("always this way"): deliberately NOT
# config-driven — these values were validated against GPU intro cost and
# lipsync quality windows, and tunable knobs reopen those failure modes
# (hooks over the GPU ceiling). Face-fill pacing stays in
# app/services/task.py.
PERSONA_HOOK_MIN_SECONDS = 8.0
PERSONA_HOOK_MAX_SECONDS = 12.0
PERSONA_HOOK_TARGET_WORDS_MIN = 20
PERSONA_HOOK_TARGET_WORDS_MAX = 30


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


class HookExceedsLipsyncCeiling(ValueError):
    """The hook fits the product rule but not the GPU lipsync renderer.

    A hook in the 12-15s dead zone ships best-effort upstream (under the
    15s hard fail) yet would SIGKILL the Modal container past the LongCat
    segment ceiling. Subclasses ValueError so existing ceiling guards
    keep failing loudly; callers that degrade instead catch this type.
    """

    def __init__(self, hook_end_seconds: float, ceiling_seconds: float):
        self.hook_end_seconds = hook_end_seconds
        self.ceiling_seconds = ceiling_seconds
        super().__init__(
            "persona hook exceeds the lipsync ceiling: hook ends at "
            f"{hook_end_seconds:g}s, max {ceiling_seconds:g}s"
        )


def ensure_hook_within_lipsync_ceiling(hook_end_seconds: float, ceiling_seconds: float) -> None:
    """Fail fast when the hook cannot be rendered by the GPU lipsync pipeline.

    Lets the caller degrade to the normal video (hook still spoken) instead
    of burning GPU on a render the container cannot survive.
    """
    if hook_end_seconds > ceiling_seconds:
        raise HookExceedsLipsyncCeiling(hook_end_seconds, ceiling_seconds)


def report_lipsync_intro_skipped(task_id: str, hook_end_seconds: float) -> None:
    """Log and track a lipsync-intro skip over the GPU ceiling.

    The video still ships (normal layout, hook spoken) — this records why
    the intro is missing. immediate=True: a lone skip event would otherwise
    sit in the analytics queue.
    """
    logger.warning(
        f"persona hook exceeds the lipsync ceiling ({hook_end_seconds:g}s); "
        "skipping lipsync intro, shipping normal video"
    )
    track_event(
        "persona_hook_lipsync_skipped",
        {"task_id": task_id, "hook_end_seconds": round(hook_end_seconds, 2)},
        immediate=True,
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


_SENTENCE_END_RE = re.compile(r"(?<=[.!?。！？])\s+")


def _cut_to_budget(text: str, limit: int) -> str:
    """Cut text to at most `limit` chars, on a sentence end when possible."""
    candidate = text[:limit]
    sentence_end = max(candidate.rfind(mark) for mark in ".!?。！？")
    if sentence_end >= 0:
        return candidate[: sentence_end + 1].strip()
    word_end = candidate.rfind(" ")
    return candidate[: word_end if word_end > 0 else limit].strip()


def _limit_generated_script(script: str) -> str:
    """Keep generated speech inside the configured character budget.

    The call to action is the script's last sentence, so an over-budget
    script is trimmed from the body before it: cutting from the end would
    drop exactly the CTA. Falls back to a plain cut when the last sentence
    alone cannot fit next to any body text.
    """
    limit = int(config.app.get("max_video_script_characters", 700))
    normalized = re.sub(r"[ \t]+", " ", script.strip())
    if len(normalized) <= limit:
        return normalized
    sentences = _SENTENCE_END_RE.split(normalized)
    closing = sentences[-1]
    head = normalized[: len(normalized) - len(closing)].rstrip()
    # Keep the separator that preceded the closing sentence (paragraph
    # break or space) so the hook paragraph boundary survives the trim.
    separator = normalized[len(head) : len(normalized) - len(closing)]
    head_budget = limit - len(separator) - len(closing)
    if len(sentences) > 1 and head_budget > 0:
        trimmed_head = _cut_to_budget(head, head_budget)
        if "\n\n" in head and "\n\n" not in trimmed_head and "\n" not in separator:
            # The trim kept only the hook paragraph: the closing sentence
            # must stay its own paragraph or the hook loses its boundary.
            separator = "\n\n"
            if len(trimmed_head) + len(separator) + len(closing) > limit:
                # Clamp at 0: head_budget can be 1 here, and a negative
                # budget makes _cut_to_budget keep text[:-1] — nearly the
                # whole head — instead of trimming to the limit.
                trimmed_head = _cut_to_budget(head, max(head_budget - 2, 0))
        if trimmed_head:
            return f"{trimmed_head}{separator}{closing}"
    return _cut_to_budget(normalized, limit)


def _regenerate_fitting_hook(
    task_id: str, params: VideoParams, video_script: str, measured_seconds: float
) -> str:
    """Regenerate only the hook paragraph, sized toward the configured window.

    The rest of the script (body paragraphs) is kept verbatim: only the
    hook timing was wrong. Emits a persona_hook_retry event per attempt so a
    retry loop that never converges is diagnosable from PostHog without
    reaching for VPS logs. Only counts and timings are reported — never the
    script text, which is user content.
    """
    window_min = PERSONA_HOOK_MIN_SECONDS
    window_max = PERSONA_HOOK_MAX_SECONDS
    words_min = PERSONA_HOOK_TARGET_WORDS_MIN
    words_max = PERSONA_HOOK_TARGET_WORDS_MAX
    paragraphs = [
        paragraph.strip()
        for paragraph in re.split(r"\n\s*\n", video_script.strip())
        if paragraph.strip()
    ]
    hook_words = len(paragraphs[0].split())
    # Aim for the window center: scale the observed word count by the
    # target/measured ratio, clamped to a sane hook size.
    if measured_seconds > 0:
        word_cap = round(hook_words * (window_min + window_max) / 2 / measured_seconds)
    else:
        word_cap = (words_min + words_max) // 2
    word_cap = max(words_min, min(words_max, word_cap))
    logger.warning(
        f"persona hook ended at {measured_seconds:g}s ({hook_words} words), "
        f"outside the {window_min:g}-{window_max:g}s window; regenerating a hook "
        f"of at most {word_cap} words"
    )
    track_event(
        "persona_hook_retry",
        {
            "task_id": task_id,
            "measured_seconds": round(measured_seconds, 2),
            "hook_words": hook_words,
            "word_cap": word_cap,
        },
    )
    body = "\n\n".join(paragraphs[1:])
    hook = llm.generate_script(
        video_subject=params.video_subject,
        language=params.video_language,
        paragraph_number=1,
        video_script_prompt=(
            f"{params.video_script_prompt} Return only a standalone hook paragraph: "
            f"one complete sentence of at most {word_cap} words ending with terminal "
            f"punctuation, designed to take {window_min:g} to {window_max:g} seconds "
            "when spoken. It must open this exact video, whose remaining "
            f"narration is: {body}"
        ),
        custom_system_prompt=params.custom_system_prompt,
        target_words_min=words_min,
        target_words_max=word_cap,
        include_cta=False,
    )
    return _limit_generated_script(f"{hook.strip()}\n\n{body}")

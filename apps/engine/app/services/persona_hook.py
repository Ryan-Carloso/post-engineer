"""Persona hook measurement, lipsync window, and telemetry helpers.

Extracted from app.services.task so the task module stays under the
file-size ratchet. The app.services import here is a leaf module
(analytics) that never imports back into the task pipeline, so there is
no import cycle.
"""

import re
from typing import Sequence

from loguru import logger

from app.config import config
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


# A hook outside the 8-12s quality window is only a cosmetic miss: the
# intro runs shorter or longer than ideal, but the video is watchable. It
# never fails the task and never regenerates the hook — a regeneration
# re-runs the LLM plus the whole TTS (minutes of CPU for local voices).
# Past the GPU ceiling the intro is capped instead (lipsync_window_seconds).


def report_lipsync_intro_skipped(task_id: str, hook_end_seconds: float) -> None:
    """Log and track a skipped lipsync intro.

    Only when the hook end can be neither measured (no timed subtitles) nor
    estimated (audio length unknown) — a real failure, not a normal branch.
    The video still ships (normal layout, hook spoken). immediate=True: a
    lone skip event would otherwise sit in the analytics queue.
    """
    logger.warning(
        f"persona hook end unknown ({hook_end_seconds:g}s) and audio length "
        "unknown; skipping lipsync intro, shipping normal video"
    )
    track_event(
        "persona_hook_lipsync_skipped",
        {"task_id": task_id, "hook_end_seconds": round(hook_end_seconds, 2)},
        immediate=True,
    )


def report_hook_outside_window(task_id: str, hook_end_seconds: float) -> None:
    """Log and track a hook outside the quality window; the video ships as is."""
    logger.warning(
        f"persona hook ended at {hook_end_seconds:g}s, outside the "
        f"{PERSONA_HOOK_MIN_SECONDS:g}-{PERSONA_HOOK_MAX_SECONDS:g}s window; "
        "shipping it as is (no regeneration)"
    )
    track_event(
        "persona_hook_outside_window",
        {"task_id": task_id, "hook_end_seconds": round(hook_end_seconds, 2)},
    )


def report_hook_clamped(task_id: str, hook_end_seconds: float, window_seconds: float) -> None:
    """Log and track a hook longer than the lipsync ceiling.

    The persona lip-syncs the first `window_seconds`; the rest of the hook
    plays as voice over the material.
    """
    logger.warning(
        f"persona hook ends at {hook_end_seconds:g}s, past the lipsync ceiling; "
        f"lip-syncing the first {window_seconds:g}s only"
    )
    track_event(
        "persona_hook_clamped",
        {
            "task_id": task_id,
            "hook_end_seconds": round(hook_end_seconds, 2),
            "lipsync_seconds": round(window_seconds, 2),
        },
    )


def report_hook_estimated(task_id: str, hook_end_seconds: float) -> None:
    """Log and track a hook end estimated from the audio length.

    Kept apart from the skip event: an estimate still renders the intro.
    """
    logger.warning(
        f"persona hook end not in the subtitles; estimated at {hook_end_seconds:g}s "
        "from the audio length"
    )
    track_event(
        "persona_hook_estimated",
        {"task_id": task_id, "hook_end_seconds": round(hook_end_seconds, 2)},
    )


def _spoken_length(text: str) -> int:
    return len(re.sub(r"[^\w]+", "", text.casefold()))


def estimate_hook_end_seconds(video_script: str, audio_seconds: float) -> float:
    """The hook's share of the audio, by spoken characters; 0.0 when unknown."""
    paragraphs = [p for p in re.split(r"\n\s*\n", video_script.strip()) if p.strip()]
    total = sum(_spoken_length(p) for p in paragraphs)
    if audio_seconds <= 0 or total == 0:
        return 0.0
    return audio_seconds * _spoken_length(paragraphs[0]) / total


def hook_end_from_words(
    video_script: str, words: Sequence[tuple[str, float, float]]
) -> float:
    """End of the hook's last word, from Whisper word boundaries; 0.0 if none.

    Walks the words until their spoken length reaches the hook's (length,
    not exact text, so Whisper rewording still lines up). Speech shorter
    than the hook ends at the last word.
    """
    paragraphs = [p for p in re.split(r"\n\s*\n", video_script.strip()) if p.strip()]
    hook_length = _spoken_length(paragraphs[0]) if paragraphs else 0
    spoken = 0
    for text, _start, end in words:
        spoken += _spoken_length(text)
        if spoken >= hook_length:
            return end
    return words[-1][2] if words else 0.0


def resolve_lipsync_window(
    task_id: str,
    video_script: str,
    subtitles: Sequence[tuple[int, str, str]],
    audio_seconds: float,
    ceiling_seconds: float,
    words: Sequence[tuple[str, float, float]] = (),
) -> float | None:
    """Seconds of lipsync intro to render, or None to ship without one.

    Exact from Whisper word boundaries when they were kept; else measured
    from the subtitle cues when they carry timed speech; otherwise
    estimated from the audio length (subtitles off, or custom audio on a
    provider without timings) — an imprecise cut only moves where the face
    hands over to the material. None only when the audio length is also
    unknown. The result is capped at the GPU ceiling.
    """
    hook_end = hook_end_from_words(video_script, words)
    if hook_end <= 0:
        hook_end = _find_hook_end_seconds(video_script, subtitles)
    if hook_end <= 0:
        hook_end = estimate_hook_end_seconds(video_script, audio_seconds)
        if hook_end <= 0:
            report_lipsync_intro_skipped(task_id, hook_end)
            return None
        report_hook_estimated(task_id, hook_end)
    window = lipsync_window_seconds(hook_end, ceiling_seconds)
    if window < hook_end:
        report_hook_clamped(task_id, hook_end, window)
    return window


def lipsync_window_seconds(hook_end_seconds: float, ceiling_seconds: float) -> float:
    """Seconds of lipsync intro: the hook, capped at the GPU ceiling."""
    return min(hook_end_seconds, ceiling_seconds)


_CUE_TIMING_RE = re.compile(
    r"(\d+):(\d+):(\d+)[,\.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,\.](\d+)"
)


def _timestamp_seconds(hours: str, minutes: str, seconds: str, millis: str) -> float:
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds) + int(millis) / 1000


def _find_hook_end_seconds(
    video_script: str,
    subtitles: Sequence[tuple[int, str, str]],
) -> float:
    """Return where the hook (first script paragraph) ends in the speech.

    Never raises: the hook timing only shapes the lipsync intro, so it must
    never fail the task. Matching is by spoken length, not exact words, so
    it survives Whisper rewording ("90 minute" -> "ninety-minute"). Inside
    the cue that crosses the hook's length the end is interpolated by the
    share of characters: Whisper cues are coarse and one cue can hold the
    hook plus part of the body. A script with one paragraph is all hook;
    speech shorter than the hook ends at the last cue. 0.0 means there is
    no timed speech to measure.
    """
    def normalize(text: str) -> str:
        return re.sub(r"[^\w]+", "", text.casefold())

    paragraphs = [p for p in re.split(r"\n\s*\n", video_script.strip()) if p.strip()]
    hook_length = len(normalize(paragraphs[0])) if paragraphs else 0
    spoken_length = 0
    last_end = 0.0
    for _, timing, text in subtitles:
        match = _CUE_TIMING_RE.search(timing)
        if match is None:
            continue
        start = _timestamp_seconds(*match.groups()[:4])
        end = _timestamp_seconds(*match.groups()[4:])
        cue_length = len(normalize(text))
        last_end = end
        if cue_length and spoken_length + cue_length >= hook_length:
            share = (hook_length - spoken_length) / cue_length
            return start + (end - start) * share
        spoken_length += cue_length
    return last_end


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
    drop exactly the CTA. When no body text fits next to it, the closing
    sentence ships alone; a plain cut is the fallback only when the closing
    sentence cannot fit at all.
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
    if len(sentences) > 1 and len(closing) <= limit:
        # The closing sentence fits on its own: never fall back to a plain
        # cut, which ends before it and drops the CTA this trim exists to
        # preserve — even when no body text fits next to it.
        if head_budget > 0:
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
        return closing
    return _cut_to_budget(normalized, limit)

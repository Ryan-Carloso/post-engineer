"""Post-TTS narration validation for Chatterbox (issue #539).

Chunked synthesis (PR #541) stops Chatterbox losing its place most of
the time, but nothing checks the audio that actually came back: video
3lGceKCJZM4 shipped with a repeated fragment, a skipped sentence, and
14 script words never synthesized, the CTA among them — all silent.
This module transcribes the synthesized file with the faster-whisper
model the subtitle path already uses, compares the transcript against
the script, re-synthesizes once on failure, and fails loudly so the
task dies at stage=audio instead of rendering truncated narration.

Scope notes (issue #539):
- Chatterbox only. ElevenLabs and OpenRouter have no documented
  lose-its-place failure mode, so their paths stay untouched.
- No model swap: Chatterbox is retired, but picking a replacement is
  a product decision for the user. This is a safety net, not a swap.
- The retry is one full re-synthesis, not a chunk-targeted repair:
  re-synthesizing only the missing chunks would need the chunk list
  plumbed through the public TTS entry plus audio surgery to splice
  them back in order. A model that hallucinates the same way twice is
  failing deterministically — fail loudly instead of retrying forever.
- The 90% / tail bars tolerate Whisper mis-hearings (numbers, names);
  they catch the shipped signature — a missing ending — not every
  dropped word. A repeat is heard words, so coverage passes it: it is
  a quality defect, not missing content.
- Preflight and voice previews pass validate=False: they measure or
  sample, they do not ship a video, so they must not pay a Whisper
  transcription (or fail) inside a synchronous endpoint. The gate
  runs in generate_audio, where the video is built.
"""

from __future__ import annotations

import difflib
import re
import unicodedata
from dataclasses import dataclass, field

from loguru import logger

from app.services.analytics import track_event
from app.utils import utils

MIN_COVERAGE = 0.90
TAIL_WORDS = 10
MIN_TAIL_COVERAGE = 0.80
MIN_WORDS_FOR_VALIDATION = 20


@dataclass(frozen=True)
class CoverageReport:
    """How much of the script the transcription actually heard."""

    script_word_count: int
    transcript_word_count: int
    matched_word_count: int
    coverage: float
    missing_words: list[str] = field(default_factory=list)
    tail_coverage: float = 0.0
    tail_missing_words: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        """Whether the narration covers the script well enough to ship."""
        return self.coverage >= MIN_COVERAGE and self.tail_coverage >= MIN_TAIL_COVERAGE


@dataclass(frozen=True)
class ValidationOutcome:
    """Result of validating one synthesized file.

    `status` is "ok", "failed", or "unavailable" (Whisper could not
    transcribe — the model failed to load, not a bad narration).
    """

    status: str
    report: CoverageReport | None = None


def normalize_words(text: str) -> list[str]:
    """Split text into comparable words.

    Same footing as the subtitle matcher (markdown separators and
    emphasis markers are never spoken), then casefolded with accents
    stripped, so Whisper hearing "nao" for script "não" is a match.
    """
    cleaned = utils.normalize_script_for_subtitle_matching(text or "")
    folded = "".join(
        char
        for char in unicodedata.normalize("NFKD", cleaned.casefold())
        if not unicodedata.combining(char)
    )
    return [word for word in re.split(r"[^\w]+", folded) if word]


def validate_transcript(script: str, transcript: str) -> CoverageReport:
    """Compare a transcript against the script, in order.

    Ordered matching (difflib on word lists): a repeated fragment does
    not inflate coverage, and a skipped middle sentence shows up as
    missing words at its position instead of a shuffled match.
    """
    script_words = normalize_words(script)
    transcript_words = normalize_words(transcript)
    matcher = difflib.SequenceMatcher(a=script_words, b=transcript_words, autojunk=False)
    matched: set[int] = set()
    for block in matcher.get_matching_blocks():
        matched.update(range(block.a, block.a + block.size))
    missing_words = [word for index, word in enumerate(script_words) if index not in matched]
    tail_start = max(0, len(script_words) - TAIL_WORDS)
    tail_missing_words = [
        word
        for index, word in enumerate(script_words)
        if index >= tail_start and index not in matched
    ]
    tail_size = len(script_words) - tail_start
    return CoverageReport(
        script_word_count=len(script_words),
        transcript_word_count=len(transcript_words),
        matched_word_count=len(matched),
        coverage=(len(matched) / len(script_words)) if script_words else 0.0,
        missing_words=missing_words,
        tail_coverage=((tail_size - len(tail_missing_words)) / tail_size if tail_size else 0.0),
        tail_missing_words=tail_missing_words,
    )


def validate_audio(script: str, audio_file: str) -> ValidationOutcome:
    """Transcribe `audio_file` and check it against `script`."""
    from app.services.subtitle import transcribe_text

    try:
        transcript = transcribe_text(audio_file)
    except Exception as exc:  # noqa: BLE001
        logger.error(f"tts validation transcription crashed: {type(exc).__name__}")
        return ValidationOutcome(status="unavailable")
    if transcript is None:
        return ValidationOutcome(status="unavailable")
    report = validate_transcript(script, transcript)
    status = "ok" if report.passed else "failed"
    return ValidationOutcome(status=status, report=report)


def _validation_error(report: CoverageReport) -> str:
    """Stored error for a failed check: counts only, never script text.

    The error reaches the task record and the PostHog failure reason,
    so it must stay free of raw script words (see TtsResult's contract).
    """
    ending = "; the ending was not spoken" if report.tail_coverage < MIN_TAIL_COVERAGE else ""
    return (
        "Chatterbox TTS validation failed: only "
        f"{report.coverage:.0%} of the script was heard in the narration "
        f"({len(report.missing_words)} of {report.script_word_count} words missing"
        f"{ending}); the video was not rendered so no truncated narration ships"
    )


def _event_props(
    task_id: str | None,
    report: CoverageReport | None,
    user_id: str | None = None,
) -> dict[str, object]:
    """Telemetry props: ids and counts only, never script text.

    `user_id` is always present, with the "unknown" sentinel when the
    caller has no owner — the same convention as `_task_tracking_context`:
    `_resolve_distinct_id` only attributes an event to the real owner
    when properties["user_id"] is set, so omitting it would attribute
    these per-user task events to the engine pseudo-person.
    """
    props: dict[str, object] = {"user_id": user_id or "unknown"}
    if task_id:
        props["task_id"] = task_id
    if report is not None:
        props["coverage"] = round(report.coverage, 3)
        props["missing_word_count"] = len(report.missing_words)
        props["tail_coverage"] = round(report.tail_coverage, 3)
    return props


def synthesize_chatterbox_with_validation(
    text: str,
    voice: str,
    voice_file: str,
    voice_rate: float = 1.0,
    voice_volume: float = 1.0,
    task_id: str | None = None,
    validate: bool = True,
    user_id: str | None = None,
):
    """Synthesize with Chatterbox, then prove the narration is complete.

    Returns the synthesis result unchanged when the narration covers
    the script, or when the check itself is unavailable (Whisper could
    not transcribe — that miss is tracked, not silent). On a failed
    check the audio is synthesized once more; if it still fails, the
    error fails the task at stage=audio so no truncated narration ever
    renders. Callers get a TtsResult either way, exactly like the
    plain `chatterbox_tts` this wraps.

    `validate=False` skips the check entirely: preflight and voice
    previews use it — they measure or sample, they do not ship a video.
    `user_id` is carried into the telemetry props so the validation
    events attribute to the video's owner, not the engine pseudo-person.
    """
    from app.services.voice_providers import TtsResult, chatterbox_tts

    result = chatterbox_tts(text, voice, voice_file, voice_rate, voice_volume)
    if not result.ok:
        return result
    if not validate or len(normalize_words(text)) < MIN_WORDS_FOR_VALIDATION:
        return result

    outcome = validate_audio(text, voice_file)
    if outcome.status == "ok":
        return result
    if outcome.status == "unavailable":
        logger.warning(
            "chatterbox tts validation unavailable (whisper could not transcribe); "
            "shipping without a coverage check"
        )
        track_event(
            "chatterbox_tts_validation_unavailable",
            _event_props(task_id, None, user_id),
            immediate=True,
        )
        return result

    report = outcome.report
    assert report is not None
    logger.warning(
        "chatterbox tts validation failed: heard "
        f"{report.coverage:.0%} of the script "
        f"({len(report.missing_words)} of {report.script_word_count} words missing, "
        f"tail coverage {report.tail_coverage:.0%}); "
        f"missing words: {report.missing_words[:5]}; re-synthesizing once"
    )
    track_event(
        "chatterbox_tts_validation_failed",
        _event_props(task_id, report, user_id),
        immediate=True,
    )
    retry = chatterbox_tts(text, voice, voice_file, voice_rate, voice_volume)
    if not retry.ok:
        return retry
    second = validate_audio(text, voice_file)
    if second.status == "ok":
        assert second.report is not None
        logger.success(
            "chatterbox tts validation passed after one re-synthesis "
            f"(coverage {second.report.coverage:.0%})"
        )
        track_event(
            "chatterbox_tts_validation_repaired",
            _event_props(task_id, second.report, user_id),
            immediate=True,
        )
        return retry
    if second.status == "unavailable":
        logger.error(
            "chatterbox tts validation unavailable on re-check after a failed "
            "first check; failing instead of shipping unverified audio"
        )
        return TtsResult(error=_validation_error(report))
    failed_report = second.report or report
    logger.error(
        "chatterbox tts validation failed after one re-synthesis: heard "
        f"{failed_report.coverage:.0%} of the script; failing the task"
    )
    return TtsResult(error=_validation_error(failed_report))

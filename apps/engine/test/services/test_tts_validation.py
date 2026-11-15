"""Unit tests for post-TTS narration validation (issue #539).

Chunked synthesis (PR #541) stops Chatterbox losing its place most of
the time, but nothing checks the audio that actually came back: video
3lGceKCJZM4 shipped with a repeated fragment, a skipped sentence, and
14 script words never synthesized, the CTA among them. These tests pin
the safety net: transcribe the synthesized file, compare coverage
against the script, re-synthesize once on failure, and fail loudly
instead of rendering truncated narration.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.services import tts_validation
from app.services.tts_validation import (
    CoverageReport,
    ValidationOutcome,
    normalize_words,
    synthesize_chatterbox_with_validation,
    validate_audio,
    validate_transcript,
)
from app.services.voice_providers import SubMaker, TtsResult

# The incident script (video 3lGceKCJZM4, 504 chars / 98 words),
# reconstructed from the burned-in captions in
# analysis-3lGceKCJZM4/DEEP-ANALYSIS.md section 6. It shipped with a
# repeated fragment, a skipped sentence, and 14 missing words from a
# single 504-char POST.
INCIDENT_SCRIPT = (
    "Finished dinner. Don't sit down yet — walk for 10 minutes. "
    "In a 2016 trial, 41 adults with type 2 diabetes tried two ways to walk "
    "30 minutes a day. One group did it all at once. "
    "The other split it — 10 minutes after each meal. "
    "Same 30 minutes, but their blood sugar after eating was about 12% lower. "
    "After dinner, it was 22% lower. "
    "Your muscles soak up sugar straight from your blood — no gym, no diet change. "
    "Try it tonight. 10 minutes round the block after dinner. "
    "Follow HabitLoom for one habit a day."
)


def test_incident_script_shape() -> None:
    """The fixture is the real incident script, CTA tail included.

    The raw script has 98 whitespace tokens, but three are bare em
    dashes (punctuation, never spoken) and "Don't" is two spoken words,
    so the comparable word count is 96.
    """
    words = normalize_words(INCIDENT_SCRIPT)
    assert len(words) == 96
    assert words[-14:] == [
        "10",
        "minutes",
        "round",
        "the",
        "block",
        "after",
        "dinner",
        "follow",
        "habitloom",
        "for",
        "one",
        "habit",
        "a",
        "day",
    ]


def test_normalize_words_strips_accents_punctuation_and_case() -> None:
    assert normalize_words("Olá, MUNDO! Não — sim.") == [
        "ola",
        "mundo",
        "nao",
        "sim",
    ]


def test_normalize_words_drops_markdown_separators() -> None:
    # TTS never speaks separator lines or emphasis markers; the subtitle
    # matcher already drops them, and the coverage check must agree.
    assert normalize_words("Hello\n---\n_world_ again") == ["hello", "world", "again"]


def test_exact_transcript_passes_with_full_coverage() -> None:
    report = validate_transcript(INCIDENT_SCRIPT, INCIDENT_SCRIPT)
    assert report.coverage == 1.0
    assert report.tail_coverage == 1.0
    assert report.missing_words == []
    assert report.passed


def test_incident_shape_missing_tail_fails() -> None:
    """The #539 video: the last 14 words were never spoken, CTA included."""
    words = normalize_words(INCIDENT_SCRIPT)
    transcript = " ".join(words[:-14])
    report = validate_transcript(INCIDENT_SCRIPT, transcript)
    assert report.coverage == pytest.approx(82 / 96)
    assert report.tail_coverage == 0.0
    assert report.missing_words == words[-14:]
    assert not report.passed


def test_small_middle_skip_is_tolerated() -> None:
    """A few Whisper mis-hearings must not fail a good narration.

    The 90% bar tolerates transcription noise; the tail check is what
    catches the shipped-truncated-CTA signature, not every dropped word.
    """
    script = " ".join(f"word{i}" for i in range(60))
    heard = [f"word{i}" for i in range(60) if i not in (20, 21, 22, 23, 24)]
    report = validate_transcript(script, " ".join(heard))
    assert report.coverage == pytest.approx(55 / 60)
    assert report.passed


def test_repeated_fragment_still_passes_coverage() -> None:
    """A repeat is a quality defect, not missing content: every script
    word is heard, so coverage passes and the video is not failed here."""
    script = "one two three four five six seven eight nine ten"
    transcript = script + " three four five six seven eight nine ten"
    report = validate_transcript(script, transcript)
    assert report.coverage == 1.0
    assert report.passed


def test_empty_transcript_fails() -> None:
    report = validate_transcript(INCIDENT_SCRIPT, "")
    assert report.coverage == 0.0
    assert report.missing_words == normalize_words(INCIDENT_SCRIPT)
    assert not report.passed


def test_coverage_report_thresholds_are_pinned() -> None:
    assert tts_validation.MIN_COVERAGE == 0.90
    assert tts_validation.MIN_TAIL_COVERAGE == 0.80
    assert tts_validation.TAIL_WORDS == 10
    assert tts_validation.MIN_WORDS_FOR_VALIDATION == 20


# --- validate_audio ---


def test_validate_audio_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.subtitle.transcribe_text", lambda _path: INCIDENT_SCRIPT)
    outcome = validate_audio(INCIDENT_SCRIPT, "/tmp/audio.mp3")
    assert outcome.status == "ok"
    assert isinstance(outcome.report, CoverageReport)
    assert outcome.report.coverage == 1.0


def test_validate_audio_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    words = normalize_words(INCIDENT_SCRIPT)
    monkeypatch.setattr(
        "app.services.subtitle.transcribe_text",
        lambda _path: " ".join(words[:-14]),
    )
    outcome = validate_audio(INCIDENT_SCRIPT, "/tmp/audio.mp3")
    assert outcome.status == "failed"
    assert outcome.report is not None
    assert outcome.report.tail_coverage == 0.0


def test_validate_audio_unavailable_when_whisper_returns_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.services.subtitle.transcribe_text", lambda _path: None)
    outcome = validate_audio(INCIDENT_SCRIPT, "/tmp/audio.mp3")
    assert outcome.status == "unavailable"
    assert outcome.report is None


# --- synthesize_chatterbox_with_validation ---


def _ok_result() -> TtsResult:
    return TtsResult(sub_maker=SubMaker())


def _install_fakes(
    monkeypatch: pytest.MonkeyPatch,
    transcripts: list[str | None],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Fake chatterbox_tts + transcribe_text; return (synth calls, events)."""
    synth_calls: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    queue = list(transcripts)

    def fake_synth(text: str, voice: str, voice_file: str, *args: Any, **_kwargs: Any) -> TtsResult:
        synth_calls.append({"text": text, "voice": voice, "voice_file": voice_file})
        return _ok_result()

    def fake_transcribe(_path: str) -> str | None:
        return queue.pop(0) if queue else None

    monkeypatch.setattr("app.services.voice_providers.chatterbox_tts", fake_synth)
    monkeypatch.setattr("app.services.subtitle.transcribe_text", fake_transcribe)
    monkeypatch.setattr(
        tts_validation,
        "track_event",
        lambda name, props=None, **kw: events.append({"event": name, "properties": props or {}}),
    )
    return synth_calls, events


def test_valid_narration_synthesizes_once(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    synth_calls, events = _install_fakes(monkeypatch, [INCIDENT_SCRIPT])
    result = synthesize_chatterbox_with_validation(
        INCIDENT_SCRIPT, "habitloom", str(tmp_path / "audio.mp3")
    )
    assert result.ok
    assert len(synth_calls) == 1
    assert events == []


def test_short_script_skips_validation(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    # Previews and preflight samples are short by design; a few words can
    # never run past Chatterbox's ~30 s stable window.
    synth_calls, events = _install_fakes(monkeypatch, [])
    result = synthesize_chatterbox_with_validation(
        "Hello world, this is a short preview.", "habitloom", str(tmp_path / "audio.mp3")
    )
    assert result.ok
    assert len(synth_calls) == 1
    assert events == []


def test_synthesis_error_passes_through_without_validation(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    def failing_synth(*_args: Any, **_kwargs: Any) -> TtsResult:
        return TtsResult(error="Chatterbox TTS failed after 3 attempts (timeout)")

    monkeypatch.setattr("app.services.voice_providers.chatterbox_tts", failing_synth)
    seen: list[str] = []
    monkeypatch.setattr(
        "app.services.subtitle.transcribe_text",
        lambda _path: seen.append("called") or INCIDENT_SCRIPT,
    )
    result = synthesize_chatterbox_with_validation(
        INCIDENT_SCRIPT, "habitloom", str(tmp_path / "audio.mp3")
    )
    assert not result.ok
    assert result.error == "Chatterbox TTS failed after 3 attempts (timeout)"
    assert seen == []


def test_failed_first_check_is_repaired_by_one_resynthesis(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    words = normalize_words(INCIDENT_SCRIPT)
    synth_calls, events = _install_fakes(monkeypatch, [" ".join(words[:-14]), INCIDENT_SCRIPT])
    result = synthesize_chatterbox_with_validation(
        INCIDENT_SCRIPT, "habitloom", str(tmp_path / "audio.mp3")
    )
    assert result.ok
    assert len(synth_calls) == 2
    assert [e["event"] for e in events] == [
        "chatterbox_tts_validation_failed",
        "chatterbox_tts_validation_repaired",
    ]
    assert events[0]["properties"]["missing_word_count"] == 14


def test_failed_twice_fails_loudly_without_rendering(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    words = normalize_words(INCIDENT_SCRIPT)
    synth_calls, events = _install_fakes(
        monkeypatch, [" ".join(words[:-14]), " ".join(words[:-14])]
    )
    result = synthesize_chatterbox_with_validation(
        INCIDENT_SCRIPT, "habitloom", str(tmp_path / "audio.mp3")
    )
    assert not result.ok
    assert result.error is not None
    assert "validation failed" in result.error
    assert "85%" in result.error  # 82 of 96 words heard
    assert "video was not rendered" in result.error
    assert len(synth_calls) == 2  # one retry only, then fail — never a loop
    assert [e["event"] for e in events] == ["chatterbox_tts_validation_failed"]


def test_whisper_unavailable_ships_with_warning_event(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    # The Whisper model failing to load must not brick every Chatterbox
    # video; the miss is visible in PostHog instead of silent.
    synth_calls, events = _install_fakes(monkeypatch, [None])
    result = synthesize_chatterbox_with_validation(
        INCIDENT_SCRIPT, "habitloom", str(tmp_path / "audio.mp3")
    )
    assert result.ok
    assert len(synth_calls) == 1
    assert [e["event"] for e in events] == ["chatterbox_tts_validation_unavailable"]


def test_unavailable_recheck_after_a_failed_first_check_fails_closed(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    # The first check already proved this narration suspect; a retry whose
    # audio cannot be verified is not shipped on the synthesiser's word.
    words = normalize_words(INCIDENT_SCRIPT)
    synth_calls, events = _install_fakes(monkeypatch, [" ".join(words[:-14]), None])
    result = synthesize_chatterbox_with_validation(
        INCIDENT_SCRIPT, "habitloom", str(tmp_path / "audio.mp3")
    )
    assert not result.ok
    assert result.error is not None
    assert "validation failed" in result.error
    assert len(synth_calls) == 2


def test_validation_error_names_counts_not_script_words(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    # The stored error reaches the task record and the PostHog failure
    # reason: counts only, never raw script text.
    words = normalize_words(INCIDENT_SCRIPT)
    _synth_calls, _events = _install_fakes(
        monkeypatch, [" ".join(words[:-14]), " ".join(words[:-14])]
    )
    result = synthesize_chatterbox_with_validation(
        INCIDENT_SCRIPT, "habitloom", str(tmp_path / "audio.mp3")
    )
    assert result.error is not None
    assert "HabitLoom" not in result.error
    assert "diabetes" not in result.error
    assert "14 of 96 words missing" in result.error


# --- wiring: voice.tts routes Chatterbox through the validation ---


def test_voice_tts_routes_chatterbox_through_validation(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    """The hook lives in voice.tts: removing it must fail this test.

    The wrapper tests above prove the validation logic; this one proves
    the video pipeline actually reaches it (a hook deleted from voice.py
    leaves every other test green while shipping unvalidated audio).
    """
    from app.services import voice as voice_service

    calls: list[tuple[str, str]] = []

    def fake_validated(
        text: str, voice: str, voice_file: str, *args: Any, **_kwargs: Any
    ) -> TtsResult:
        calls.append((text, voice))
        return _ok_result()

    monkeypatch.setattr(
        "app.services.voice.synthesize_chatterbox_with_validation",
        fake_validated,
    )
    monkeypatch.setattr(
        "app.services.cloned_voices.ownership.chatterbox_voice_allowed_for_user",
        lambda *_args: True,
    )
    result = voice_service.tts(
        text=INCIDENT_SCRIPT,
        voice_name="chatterbox:habitloom",
        voice_rate=1.0,
        voice_file=str(tmp_path / "audio.mp3"),
        user_id="user-1",
        task_id="task-1",
    )
    assert result.ok
    assert calls == [(INCIDENT_SCRIPT, "habitloom")]


def test_validate_audio_outcome_is_a_dataclass() -> None:
    outcome = ValidationOutcome(status="ok", report=None)
    assert outcome.status == "ok"
    assert outcome.report is None

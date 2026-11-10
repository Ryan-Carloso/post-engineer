"""Unit tests for Chatterbox chunked synthesis (issue #539).

Chatterbox loses its place on long single-shot scripts (~100 words): it
repeats a fragment, skips a sentence, and stops early. The engine now
splits the script into per-sentence chunks of at most
``CHATTERBOX_MAX_CHUNK_CHARS`` chars, synthesizes one chunk per POST, and
concatenates the chunk audios in order. Short scripts still take the old
single-POST path unchanged.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from pydub import AudioSegment

from app.config import config as app_config
from app.services import voice_providers as vp
from app.services.chatterbox_chunks import (
    CHATTERBOX_MAX_CHUNK_CHARS,
    CHATTERBOX_TIMEOUT_SECONDS,
    concatenate_audio_files,
    split_chatterbox_script,
)

# The incident script (video 3lGceKCJZM4, 504 chars / 98 words), reconstructed
# from the burned-in captions in analysis-3lGceKCJZM4/DEEP-ANALYSIS.md §6.
# It shipped with a repeated fragment, a skipped sentence, and 14 missing
# words from a single 504-char POST.
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


def test_timeout_is_300_seconds() -> None:
    """The 120 s cap sat inside the CPU server's normal latency (RTF 3-10)."""
    assert CHATTERBOX_TIMEOUT_SECONDS == 300


def test_chunk_cap_is_300_chars() -> None:
    """Chatterbox degrades past ~30 s of audio; 300 chars is ~8-10 s."""
    assert CHATTERBOX_MAX_CHUNK_CHARS == 300


def test_short_script_is_a_single_unchanged_chunk() -> None:
    text = "Hello world. Second sentence."
    assert split_chatterbox_script(text) == [text]


def test_incident_script_splits_into_two_ordered_chunks() -> None:
    assert len(INCIDENT_SCRIPT) == 504
    chunks = split_chatterbox_script(INCIDENT_SCRIPT)
    assert len(chunks) == 2
    assert all(len(chunk) <= CHATTERBOX_MAX_CHUNK_CHARS for chunk in chunks)
    # Order preserved, hook first, CTA last, nothing lost or reordered.
    assert " ".join(chunks) == INCIDENT_SCRIPT
    assert chunks[0].startswith("Finished dinner.")
    assert chunks[-1].endswith("Follow HabitLoom for one habit a day.")
    # Every chunk ends on a sentence boundary, never mid-sentence.
    assert all(chunk.endswith((".", "!", "?")) for chunk in chunks)


def test_chunks_never_split_mid_sentence() -> None:
    sentences = [f"Sentence number {n} ends here." for n in range(30)]
    text = " ".join(sentences)
    chunks = split_chatterbox_script(text)
    assert len(chunks) > 1
    assert all(len(chunk) <= CHATTERBOX_MAX_CHUNK_CHARS for chunk in chunks)
    assert " ".join(chunks) == text
    assert all(chunk.endswith((".", "!", "?")) for chunk in chunks)


def test_long_sentence_splits_at_clause_boundaries() -> None:
    text = (
        "This is a very long sentence with many clauses, one after another, "
        "each adding a little more detail, and it keeps going past the chunk "
        "cap, so it must break at a comma, not in the middle of a word, and "
        "the second half must still read as a continuation, with no words "
        "lost, duplicated, or cut in half along the way, for the whole text."
    )
    assert len(text) > CHATTERBOX_MAX_CHUNK_CHARS
    chunks = split_chatterbox_script(text)
    assert len(chunks) > 1
    assert all(len(chunk) <= CHATTERBOX_MAX_CHUNK_CHARS for chunk in chunks)
    assert " ".join(chunks) == text
    # No chunk boundary falls inside a word.
    assert all(not chunk.endswith(("a", "an", "the")) for chunk in chunks)


def test_single_word_longer_than_cap_is_hard_cut() -> None:
    # A single word has no natural boundary, so it is hard-cut and the
    # round trip gains one space per cut (see split_chatterbox_script).
    word = "a" * 350
    chunks = split_chatterbox_script(word)
    assert chunks == ["a" * CHATTERBOX_MAX_CHUNK_CHARS, "a" * 50]
    assert " ".join(chunks) == "a" * CHATTERBOX_MAX_CHUNK_CHARS + " " + "a" * 50
    # A word over twice the cap is cut more than once.
    assert split_chatterbox_script("b" * 650) == [
        "b" * CHATTERBOX_MAX_CHUNK_CHARS,
        "b" * CHATTERBOX_MAX_CHUNK_CHARS,
        "b" * 50,
    ]


def test_abbreviation_does_not_split_a_sentence() -> None:
    text = (
        "Dr. Smith walked for ten minutes after dinner. "
        "He felt better after the walk. "
        "Dr. Smith told his patients to try it too. "
        "A short walk after each meal helps a lot. "
        "Dr. Smith wrote about it in his notes. "
        "Ten minutes is all it takes to start. "
        "Dr. Smith walks after lunch and dinner every day. "
        "His patients feel better within a week."
    )
    assert len(text) > CHATTERBOX_MAX_CHUNK_CHARS
    chunks = split_chatterbox_script(text)
    assert len(chunks) > 1
    assert " ".join(chunks) == text
    assert all(not chunk.endswith("Dr.") for chunk in chunks)
    assert any("Dr. Smith walked" in chunk for chunk in chunks)


def test_empty_text_has_no_chunks() -> None:
    assert split_chatterbox_script("") == []
    assert split_chatterbox_script("   \n  ") == []


def test_concatenate_audio_files_joins_in_order(tmp_path: Path) -> None:
    """Parts are loaded and appended in the order given, then exported."""

    loaded: list[str] = []
    exported: dict[str, object] = {}

    class _FakeSegment:
        def __init__(self, name: str) -> None:
            self.name = name

        def __add__(self, other: _FakeSegment) -> _FakeSegment:
            if not self.name:
                return _FakeSegment(other.name)
            return _FakeSegment(f"{self.name}+{other.name}")

        def export(self, out: str, format: str) -> None:  # noqa: A002
            exported["out"] = out
            exported["format"] = format
            exported["combined"] = self.name

    def _fake_from_file(path: str, format: str) -> _FakeSegment:  # noqa: A002
        loaded.append(path)
        return _FakeSegment(Path(path).name)

    parts = [str(tmp_path / f"chunk-{i}.mp3") for i in range(3)]
    output = str(tmp_path / "voice.mp3")
    with (
        patch(
            "app.services.chatterbox_chunks.AudioSegment.empty",
            return_value=_FakeSegment(""),
        ),
        patch(
            "app.services.chatterbox_chunks.AudioSegment.from_file",
            side_effect=_fake_from_file,
        ),
    ):
        concatenate_audio_files(parts, output)
    assert loaded == parts
    assert exported["out"] == output
    assert exported["format"] == "mp3"
    assert exported["combined"] == "chunk-0.mp3+chunk-1.mp3+chunk-2.mp3"


def test_concatenate_audio_files_rejects_empty_input() -> None:
    with pytest.raises(ValueError, match="no audio parts"):
        concatenate_audio_files([], "/tmp/out.mp3")


def test_concatenate_audio_files_restores_pydub_converter(tmp_path: Path) -> None:
    """pydub has no per-call converter: the class attribute is set for the
    call and restored to its previous value afterwards."""
    seen_during_call: list[str] = []

    class _FakeSegment:
        def __add__(self, other: _FakeSegment) -> _FakeSegment:
            return _FakeSegment()

        def export(self, out: str, format: str) -> None:  # noqa: A002
            pass

    def _fake_from_file(path: str, format: str) -> _FakeSegment:  # noqa: A002
        seen_during_call.append(AudioSegment.converter)
        return _FakeSegment()

    part = str(tmp_path / "chunk-0.mp3")
    output = str(tmp_path / "voice.mp3")
    with (
        patch.object(AudioSegment, "converter", "converter-before"),
        patch(
            "app.services.chatterbox_chunks.utils.get_ffmpeg_binary",
            return_value="/usr/bin/ffmpeg",
        ),
        patch(
            "app.services.chatterbox_chunks.AudioSegment.empty",
            return_value=_FakeSegment(),
        ),
        patch(
            "app.services.chatterbox_chunks.AudioSegment.from_file",
            side_effect=_fake_from_file,
        ),
    ):
        concatenate_audio_files([part], output)
        assert AudioSegment.converter == "converter-before"
    assert seen_during_call == ["/usr/bin/ffmpeg"]


def test_concatenate_audio_files_restores_converter_on_decode_error(
    tmp_path: Path,
) -> None:
    """A decode failure mid-concat must still restore the converter."""

    class _FakeSegment:
        pass

    part = str(tmp_path / "chunk-0.mp3")
    output = str(tmp_path / "voice.mp3")
    with (
        patch.object(AudioSegment, "converter", "converter-before"),
        patch(
            "app.services.chatterbox_chunks.utils.get_ffmpeg_binary",
            return_value="/usr/bin/ffmpeg",
        ),
        patch(
            "app.services.chatterbox_chunks.AudioSegment.empty",
            return_value=_FakeSegment(),
        ),
        patch(
            "app.services.chatterbox_chunks.AudioSegment.from_file",
            side_effect=RuntimeError("boom"),
        ),
    ):
        with pytest.raises(RuntimeError, match="boom"):
            concatenate_audio_files([part], output)
        assert AudioSegment.converter == "converter-before"


class _FakeResponse:
    def __init__(self, content: bytes, status_code: int = 200, text: str = "") -> None:
        self.status_code = status_code
        self.content = content
        self.text = text


class _FakeClip:
    duration = 5.0

    def close(self) -> None:
        pass


def _run_chatterbox(
    text: str, tmp_path: Path, responses: list[_FakeResponse]
) -> tuple[object, list[dict[str, object]], list[list[str]], list[list[bytes]]]:
    """Run chatterbox_tts against fake POSTs.

    Returns (result, calls, concats, concat_bytes): the concat part bytes are
    captured inside the fake concat, because the part files live in a
    TemporaryDirectory that is deleted when chatterbox_tts returns.
    """
    calls: list[dict[str, object]] = []
    concats: list[list[str]] = []
    concat_bytes: list[list[bytes]] = []
    response_iter = iter(responses)

    def _fake_post(
        url: str, json: dict | None = None, headers: dict | None = None, timeout: int | None = None
    ):  # noqa: A002
        calls.append({"url": url, "json": json, "headers": headers, "timeout": timeout})
        return next(response_iter)

    def _fake_concat(part_files: list[str], output_file: str) -> None:
        concats.append(list(part_files))
        # Part files live in a TemporaryDirectory that is deleted on return,
        # so capture their bytes here, while they still exist.
        concat_bytes.append([Path(part).read_bytes() for part in part_files])
        Path(output_file).write_bytes(b"joined-audio")

    voice_file = str(tmp_path / "voice.mp3")
    with (
        patch.object(
            app_config,
            "chatterbox",
            {
                "base_url": "http://localhost:4123/v1/",
                "api_key": "secret",
                "model_id": "chatterbox",
            },
        ),
        patch.object(vp.requests, "post", side_effect=_fake_post),
        patch("app.services.voice_providers.AudioFileClip", return_value=_FakeClip()),
        patch("app.services.voice_providers.concatenate_audio_files", side_effect=_fake_concat),
    ):
        result = vp.chatterbox_tts(text=text, voice="default", voice_file=voice_file)
    return result, calls, concats, concat_bytes


def test_chatterbox_tts_short_script_posts_once_with_300s_timeout(tmp_path: Path) -> None:
    """Single-chunk scripts keep the old path: one POST, file written directly."""
    result, calls, concats, _ = _run_chatterbox(
        "Hello world. Second sentence.",
        tmp_path,
        [_FakeResponse(b"RIFF-fake-wav")],
    )
    assert len(calls) == 1
    assert calls[0]["timeout"] == 300
    assert calls[0]["json"]["input"] == "Hello world. Second sentence."
    assert concats == []
    assert Path(tmp_path / "voice.mp3").read_bytes() == b"RIFF-fake-wav"
    assert result.error is None
    assert result.sub_maker is not None


def test_chatterbox_tts_long_script_posts_one_chunk_at_a_time_in_order(
    tmp_path: Path,
) -> None:
    """The incident script becomes 2 POSTs, in script order, then one concat."""
    expected_chunks = split_chatterbox_script(INCIDENT_SCRIPT)
    assert len(expected_chunks) == 2
    result, calls, concats, concat_bytes = _run_chatterbox(
        INCIDENT_SCRIPT,
        tmp_path,
        [_FakeResponse(b"audio-0"), _FakeResponse(b"audio-1")],
    )
    assert [call["json"]["input"] for call in calls] == expected_chunks
    assert all(call["timeout"] == 300 for call in calls)
    assert all(call["json"]["voice"] == "default" for call in calls)
    assert len(concats) == 1
    assert len(concats[0]) == 2
    # The part files hold the chunk audios in script order.
    assert concat_bytes == [[b"audio-0", b"audio-1"]]
    assert Path(tmp_path / "voice.mp3").read_bytes() == b"joined-audio"
    assert result.error is None
    assert result.sub_maker is not None


def test_chatterbox_tts_chunk_failure_aborts_before_concat(tmp_path: Path) -> None:
    """A chunk that fails all 3 attempts fails the task; nothing is joined."""
    result, calls, concats, _ = _run_chatterbox(
        INCIDENT_SCRIPT,
        tmp_path,
        [
            _FakeResponse(b"audio-0"),
            _FakeResponse(b"", status_code=500, text="boom"),
            _FakeResponse(b"", status_code=500, text="boom"),
            _FakeResponse(b"", status_code=500, text="boom"),
        ],
    )
    assert len(calls) == 4  # chunk 1 once, chunk 2 three attempts
    assert concats == []
    assert result.error is not None
    assert "after 3 attempts" in result.error
    assert not Path(tmp_path / "voice.mp3").exists()

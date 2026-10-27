"""subtitle.correct retimes coarse Whisper cues by character share.

Voices without word-level timestamps (Chatterbox) fall back to Whisper,
whose cues can hold several script lines ("[0.08s -> 11.02s] i ate five
... the rest total structural collapse here is why ..."). The old
line-by-line correction paired each script line with one whole cue, ran
out of cues and wrote the remaining lines as 00:00:00 --> 00:00:00: the
on-screen subtitles were wrong and the persona hook measured 0s or 25s.

Contract: when the cues do not match the script line for line, every
script line gets its own cue, placed on the spoken timeline by its share
of characters inside the cue(s) it falls in — ordered, non-empty, spanning
exactly the spoken range. A file that already matches is left untouched.
"""

import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import subtitle
from app.services.persona_hook import _find_hook_end_seconds

_SCRIPT = (
    "I ate five legendary franzinhas until number three held its bread together. "
    "The rest? Total structural collapse.\n\n"
    "Here is why that one actually works. Brother José. "
    "If the bread dissolves before you finish, you are suffering in silence.\n\n"
    "My top five tasted great, but the structural integrity at number three "
    "actually held together so I could eat with my hands like a human being."
)

# Real Whisper output for that script (task 8ddff83c, Chatterbox voice).
_WHISPER_SRT = (
    "1\n00:00:00,080 --> 00:00:11,020\n"
    "i ate five legendary franzenhus until number three held its bread together the rest "
    "total structural collapse here is why that one actually works brother jose\n\n"
    "2\n00:00:11,390 --> 00:00:24,800\n"
    "if the bread dissolves before you finish you are suffering in silence my top five "
    "tasted great but the structural integrity at number three actually held together so "
    "i could eat with my hands like a human being\n\n"
)


def _seconds(timing: str, side: int) -> float:
    stamp = timing.split(" --> ")[side]
    hours, minutes, rest = stamp.split(":")
    seconds, millis = rest.split(",")
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds) + int(millis) / 1000


def _correct(srt: str, script: str):
    with tempfile.TemporaryDirectory() as tmp_dir:
        path = Path(tmp_dir) / "subtitle.srt"
        path.write_text(srt, encoding="utf-8")
        subtitle.correct(str(path), script)
        return path.read_text(encoding="utf-8"), subtitle.file_to_subtitles(str(path))


def test_coarse_cues_give_every_script_line_its_own_ordered_cue():
    text, items = _correct(_WHISPER_SRT, _SCRIPT)
    assert "00:00:00,000 --> 00:00:00,000" not in text
    assert len(items) == 9
    assert items[0][2].startswith("I ate five legendary")
    previous_end = 0.0
    for _, timing, _ in items:
        start, end = _seconds(timing, 0), _seconds(timing, 1)
        assert end > start
        assert start >= previous_end - 1e-6
        previous_end = end
    assert _seconds(items[0][1], 0) == pytest.approx(0.08)
    assert _seconds(items[-1][1], 1) == pytest.approx(24.8)


def test_hook_measured_on_the_corrected_file_lands_inside_the_first_cue():
    _, items = _correct(_WHISPER_SRT, _SCRIPT)
    # "I ate ... collapse." is the first ~half of the 0.08-11.02s cue.
    assert 3.0 < _find_hook_end_seconds(_SCRIPT, items) < 9.0


def test_line_for_line_match_is_left_untouched():
    srt = (
        "1\n00:00:00,100 --> 00:00:01,000\nHello there\n\n"
        "2\n00:00:01,100 --> 00:00:02,000\nGeneral Kenobi\n\n"
    )
    text, _ = _correct(srt, "Hello there. General Kenobi.")
    assert text == srt


class _Word:
    def __init__(self, word, start, end):
        self.word, self.start, self.end = word, start, end


class _Segment:
    def __init__(self, words):
        self.words = words
        self.start = words[0].start
        self.end = words[-1].end


class _Info:
    language = "en"
    language_probability = 1.0


class _FakeModel:
    def __init__(self, segments):
        self._segments = segments

    def transcribe(self, *args, **kwargs):
        return iter(self._segments), _Info()


def test_whisper_word_boundaries_are_kept_next_to_the_srt(tmp_path, monkeypatch):
    words = [_Word(" Stop", 0.1, 0.4), _Word(" here.", 0.4, 0.9), _Word(" Body", 1.2, 1.6), _Word(" text.", 1.6, 2.0)]
    monkeypatch.setattr(subtitle, "WhisperModel", object)
    monkeypatch.setattr(subtitle, "model", _FakeModel([_Segment(words)]))
    srt = tmp_path / "subtitle.srt"
    subtitle.create("audio.mp3", str(srt))
    assert subtitle.file_to_words(str(srt)) == [
        ("Stop", 0.1, 0.4),
        ("here.", 0.4, 0.9),
        ("Body", 1.2, 1.6),
        ("text.", 1.6, 2.0),
    ]


def test_missing_or_malformed_word_file_reads_as_no_words(tmp_path):
    srt = tmp_path / "subtitle.srt"
    assert subtitle.file_to_words(str(srt)) == []
    assert subtitle.file_to_words("") == []
    Path(subtitle.words_path(str(srt))).write_text("not json", encoding="utf-8")
    assert subtitle.file_to_words(str(srt)) == []

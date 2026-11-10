"""Subtitle cue splitting: punctuation first, then a hard word cap."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import subtitle_cues


def test_max_cue_words_is_six():
    assert subtitle_cues.MAX_CUE_WORDS == 6


def test_a_short_line_is_kept_whole():
    assert subtitle_cues.split_cue("Go to bed earlier") == ["Go to bed earlier"]


def test_a_line_at_the_cap_is_kept_whole():
    line = "one two three four five six"
    assert subtitle_cues.split_cue(line) == [line]


def test_a_fourteen_word_line_splits_into_balanced_cues_of_at_most_six_words():
    line = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen"
    cues = subtitle_cues.split_cue(line)
    assert [len(cue.split()) for cue in cues] == [5, 5, 4]
    assert " ".join(cues) == line


def test_a_seven_word_line_does_not_leave_a_one_word_orphan():
    cues = subtitle_cues.split_cue("one two three four five six seven")
    assert [len(cue.split()) for cue in cues] == [4, 3]


def test_blank_input_yields_no_cues():
    assert subtitle_cues.split_cue("   ") == []
    assert subtitle_cues.split_script_lines("") == []


def test_script_lines_split_at_punctuation_before_the_word_cap():
    lines = subtitle_cues.split_script_lines("Try this tonight, lights out one hour earlier.")
    assert lines == ["Try this tonight", "lights out one hour earlier"]


def test_script_lines_cap_a_long_sentence_without_punctuation():
    text = "each hour earlier to sleep was linked with about half a kilo more weight loss"
    lines = subtitle_cues.split_script_lines(text)
    assert len(lines) > 1
    assert all(len(line.split()) <= subtitle_cues.MAX_CUE_WORDS for line in lines)
    assert " ".join(lines) == text


def test_split_timed_keeps_a_short_line_as_one_cue_over_the_whole_span():
    assert subtitle_cues.split_timed("Go to bed", 100, 900) == [("Go to bed", 100, 900)]


def test_split_timed_spreads_the_span_by_character_share_and_ends_on_the_span_end():
    cues = subtitle_cues.split_timed("one two three four five six seven", 0, 700)
    assert [cue for cue, _, _ in cues] == ["one two three four", "five six seven"]
    assert cues[0][1] == 0
    assert cues[0][2] == int(700 * 18 / 32)
    assert cues[1][1] == cues[0][2]
    assert cues[-1][2] == 700


def test_split_timed_of_blank_text_has_no_cues():
    assert subtitle_cues.split_timed("   ", 0, 10) == []

"""Word-level cue timing: each cue starts when its first word is really spoken."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import subtitle_words

# Whisper boundaries for "Go to bed earlier. Lose more weight tonight."
_WORDS = [
    ("Go", 0.10, 0.30), ("to", 0.30, 0.45), ("bed", 0.45, 0.80), ("earlier.", 0.80, 1.40),
    ("Lose", 2.20, 2.50), ("more", 2.50, 2.80), ("weight", 2.80, 3.20), ("tonight.", 3.20, 3.90),
]


def test_each_line_spans_its_first_to_its_last_spoken_word():
    timed = subtitle_words.retime_by_words(["Go to bed earlier", "Lose more weight tonight"], _WORDS)
    assert timed == [
        ("Go to bed earlier", 0.10, 1.40),
        ("Lose more weight tonight", 2.20, 3.90),
    ]


def test_capped_cues_inside_a_sentence_start_at_their_own_first_word():
    lines = ["Go to bed", "earlier", "Lose more", "weight tonight"]
    timed = subtitle_words.retime_by_words(lines, _WORDS)
    assert [round(start, 2) for _, start, _ in timed] == [0.10, 0.80, 2.20, 2.80]
    assert [round(end, 2) for _, _, end in timed] == [0.80, 1.40, 2.80, 3.90]


def test_a_number_heard_as_digits_is_interpolated_between_its_neighbours():
    words = [
        ("Study", 0.0, 0.5), ("2026", 0.5, 1.5), ("shows", 1.5, 2.0), ("gains.", 2.0, 2.6),
    ]
    timed = subtitle_words.retime_by_words(
        ["Study twenty twenty six", "shows gains"], words
    )
    assert timed[0][1] == 0.0
    assert timed[1][1] == 1.5
    # The spelled-out number fills the time the digits were heard in.
    assert timed[0][2] <= timed[1][1]


def test_times_never_go_backwards_and_every_cue_has_length():
    timed = subtitle_words.retime_by_words(["Go to bed earlier", "Lose more weight tonight"], _WORDS)
    previous_end = 0.0
    for _, start, end in timed:
        assert end > start
        assert start >= previous_end
        previous_end = end


def test_no_words_means_no_word_timing():
    assert subtitle_words.retime_by_words(["Go to bed"], []) == []


def test_a_transcript_that_barely_matches_the_script_is_rejected():
    garbage = [("completely", 0.0, 1.0), ("different", 1.0, 2.0), ("words", 2.0, 3.0), ("here", 3.0, 4.0)]
    assert subtitle_words.retime_by_words(["Go to bed earlier", "Lose more weight tonight"], garbage) == []


def test_the_minimum_match_share_is_half_of_the_script_words():
    assert subtitle_words.MIN_MATCHED_SHARE == 0.5


def test_overlapping_word_boundaries_never_start_a_cue_before_the_previous_one_ends():
    words = [("Go", 0.0, 1.0), ("to", 0.9, 1.2), ("bed", 1.1, 1.5), ("now", 1.5, 2.0)]
    timed = subtitle_words.retime_by_words(["Go to", "bed now"], words)
    assert timed == [("Go to", 0.0, 1.2), ("bed now", 1.2, 2.0)]


def test_a_transcript_that_stops_before_the_script_ends_is_rejected():
    # Half of the words match, but nothing was heard for the last line: its cue
    # would have no time at all (a stack of instants at the end of the video).
    timed = subtitle_words.retime_by_words(["Go to bed earlier", "Lose more weight tonight"], _WORDS[:4])
    assert timed == []


def test_instantaneous_words_cannot_time_a_readable_cue():
    words = [("Go", 1.0, 1.0), ("now", 1.0, 1.0)]
    assert subtitle_words.retime_by_words(["Go", "now"], words) == []


def test_a_mis_heard_last_word_still_gets_the_time_it_was_heard_in():
    # "HabitLoom" heard as "Habit loom": the script token has no match, but the
    # transcript does cover the end of the script.
    words = [("Follow", 0.0, 0.5), ("Habit", 0.5, 0.9), ("loom.", 0.9, 1.4)]
    assert subtitle_words.retime_by_words(["Follow HabitLoom"], words) == [("Follow HabitLoom", 0.0, 1.4)]


def test_the_shortest_readable_cue_is_a_tenth_of_a_second():
    assert subtitle_words.MIN_CUE_SECONDS == 0.1


def test_a_line_without_any_word_of_its_own_cannot_be_timed():
    assert subtitle_words.retime_by_words(["Go to bed earlier", "..."], _WORDS) == []

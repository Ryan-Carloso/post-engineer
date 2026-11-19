"""segment_intervals: spoken interval per segment, from Whisper word times.

Moved verbatim from test_user_media.py with the extraction: the interval
walk is pure timing logic, and the mutmut shard for the new module needs
its tests written against it, not against user_media.
"""

import json

import pytest

from app.services import segment_intervals

WORDS = [
    ("Welcome", 0.0, 0.5),
    ("to", 0.5, 0.7),
    ("Porto", 0.7, 1.2),
    ("where", 2.0, 2.3),
    ("the", 2.3, 2.5),
    ("river", 2.5, 3.0),
    ("meets", 3.0, 3.4),
    ("the", 3.4, 3.6),
    ("sea", 3.6, 4.0),
    ("Visit", 5.0, 5.4),
    ("Porto", 5.4, 5.9),
    ("soon", 5.9, 6.3),
]

SEGMENTS = [
    {"kind": "hook", "text": "Welcome to Porto."},
    {"kind": "content", "text": "Where the river meets the sea."},
    {"kind": "content", "text": "Visit Porto soon."},
]


def _write_words(tmp_path, words):
    subtitle = str(tmp_path / "subtitle.srt")
    with open(subtitle, "w", encoding="utf-8") as handle:
        handle.write("1\n00:00:00,000 --> 00:00:06,300\nPorto\n\n")
    with open(f"{subtitle}.words.json", "w", encoding="utf-8") as handle:
        json.dump([[text, start, end] for text, start, end in words], handle)
    return subtitle


def test_exact_word_walk_gives_each_segment_its_spoken_interval():
    intervals, fallback = segment_intervals.segment_intervals(SEGMENTS, WORDS, 6.3)
    assert fallback is False
    assert intervals == [(0.0, 1.2), (2.0, 4.0), (5.0, 6.3)]


def test_zero_token_segment_inherits_the_previous_boundary_instead_of_crashing():
    words = [("Porto", 0.0, 1.0), ("walks", 1.0, 2.0), ("now", 2.0, 3.0)]
    segments = [
        {"kind": "hook", "text": "Porto walks."},
        {"kind": "content", "text": "!!! ???"},
        {"kind": "content", "text": "now."},
    ]
    intervals, fallback = segment_intervals.segment_intervals(segments, words, 3.0)
    assert fallback is False
    assert intervals == [(0.0, 2.0), (2.0, 2.0), (2.0, 3.0)]


def test_word_list_shorter_than_segments_falls_back_to_proportional_timing():
    words = [("I", 0.0, 0.3), ("don't", 0.3, 0.8), ("know", 0.8, 1.2)]
    segments = [
        {"kind": "hook", "text": "I don't know."},
        {"kind": "content", "text": "Visit Porto soon."},
    ]
    intervals, fallback = segment_intervals.segment_intervals(segments, words, 10.0)
    assert fallback is True
    assert intervals[0][0] == 0.0
    assert intervals[0][1] == pytest.approx(10.0 * 4 / 7)
    assert intervals[1] == (pytest.approx(10.0 * 4 / 7), 10.0)


def test_no_word_times_means_proportional_intervals():
    intervals, fallback = segment_intervals.segment_intervals(SEGMENTS, [], 12.0)
    assert fallback is True
    assert intervals == [(0.0, 3.0), (3.0, 9.0), (9.0, 12.0)]


def test_intervals_read_from_the_subtitle_word_file():
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        from pathlib import Path

        subtitle = _write_words(Path(tmp), WORDS)
        intervals, fallback = segment_intervals.segment_intervals_from_subtitle(
            SEGMENTS, subtitle, 6.3
        )
        assert fallback is False
        assert intervals == [(0.0, 1.2), (2.0, 4.0), (5.0, 6.3)]

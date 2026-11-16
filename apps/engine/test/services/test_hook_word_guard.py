"""The hook word guard floor (issue #563).

At the fastest measured pace (0.330 s/word, 182 wpm on the HabitLoom
cloned voice) a 24-word hook lasts 7.9s, under the 8s floor of the
8-12s lip-sync window, so 24 words cannot always fill the window and
the guard rejects it. 25 words is the smallest count that always fills
the window; the target range is 25-35 words (middle 30 -> ~10s, the
window centre).
"""

import pytest

from app.services import script_segments
from app.services.script_segments import SegmentValidationError


def _segments(hook_words):
    return [
        {"kind": "hook", "text": " ".join(["word"] * hook_words) + "."},
        {"kind": "content", "text": " ".join(["word"] * 30) + "."},
        {"kind": "content", "text": "Save this video before your next trip to Porto."},
    ]


def test_hook_with_24_words_is_rejected():
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(_segments(24), video_type="full_lipsync")
    assert exc_info.value.field == "segments.0.text"
    assert "25 to 40" in exc_info.value.rule


def test_hook_with_25_words_passes_the_guard():
    result = script_segments.validate_segments(_segments(25), video_type="full_lipsync")
    assert result["hook_words"] == 25

"""Tests for the mechanical script-segments contract (no LLM).

The contract is one call = one video: segments is a list whose first
segment is the hook, whose last segment is the CTA, and whose middle
segments are the body. Validation is mechanical only: word counts,
forbidden content, and shape. It never calls an LLM and never fixes
the input silently.
"""

from unittest.mock import MagicMock

import pytest

from app.models.schema import VideoParams
from app.services import script_segments
from app.services import task as task_service
from app.services.script_segments import SegmentValidationError


def _hook(words=24):
    base = (
        "Stop wasting your trip stuck in a ninety minute line for the "
        "original dish when a better table is waiting nearby for you today."
    )
    assert len(base.split()) == words
    return base


def _body():
    return (
        "Locals skip the famous house and walk two minutes to a smaller "
        "kitchen where the sauce recipe has not changed since nineteen "
        "fifty three and the cook still greets every table by name "
        "before the first plate arrives at your table tonight."
    )


def _cta():
    return "Save this video before your next trip to Porto."


def _valid_segments():
    return [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": _body()},
        {"kind": "cta", "text": _cta()},
    ]


def _word_count(text):
    return len(text.split())


def test_valid_segments_pass_and_join_to_script():
    result = script_segments.validate_segments(_valid_segments())
    assert result["hook_text"] == _hook()
    assert result["cta_text"] == _cta()
    assert result["total_words"] == _word_count(_hook()) + _word_count(_body()) + _word_count(_cta())
    assert result["body_words"] >= 30
    joined = script_segments.segments_to_script(_valid_segments())
    assert joined == f"{_hook()}\n\n{_body()}\n\n{_cta()}"


def test_empty_segments_is_400():
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments([])
    assert exc_info.value.field == "segments"
    assert exc_info.value.fix


def test_non_list_segments_is_400():
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments("not a list")
    assert exc_info.value.field == "segments"


def test_hook_must_be_first():
    segments = [
        {"kind": "body", "text": _body()},
        {"kind": "hook", "text": _hook()},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.0.kind"


def test_cta_must_be_last():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "cta", "text": _cta()},
        {"kind": "body", "text": _body()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.2.kind"


def test_exactly_one_hook_and_one_cta():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "hook", "text": _hook()},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments"


def test_empty_segment_text_is_400():
    segments = [
        {"kind": "hook", "text": "   "},
        {"kind": "body", "text": _body()},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.0.text"


def test_placeholder_is_400():
    for bad in ("[insira o texto aqui]", "TODO write this", "lorem ipsum dolor"):
        segments = [
            {"kind": "hook", "text": _hook()},
            {"kind": "body", "text": bad + " " + _body()},
            {"kind": "cta", "text": _cta()},
        ]
        with pytest.raises(SegmentValidationError) as exc_info:
            script_segments.validate_segments(segments)
        assert exc_info.value.field == "segments.1.text"


def test_link_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": _body() + " See https://example.com for more."},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.1.text"


def test_markdown_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": "**Bold claim** " + _body()},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.1.text"


def test_emoji_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": _body() + " \U0001f600"},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.1.text"


def test_stage_direction_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": "[pausa] " + _body()},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.1.text"


def test_hook_must_end_with_terminal_punctuation():
    segments = [
        {"kind": "hook", "text": _hook().rstrip(".")},
        {"kind": "body", "text": _body()},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.0.text"


def test_repeated_segment_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": _body()},
        {"kind": "body", "text": _body()},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.2.text"


def test_total_below_minimum_is_400():
    segments = [
        {"kind": "hook", "text": " ".join(["word"] * 20) + "."},
        {"kind": "body", "text": " ".join(["word"] * 30) + "."},
        {"kind": "cta", "text": "Save this video now please."},
    ]
    # Total is 55 words: below the 60-word minimum.
    assert _word_count(segments[0]["text"]) + _word_count(segments[1]["text"]) + _word_count(segments[2]["text"]) == 55
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments"


def test_total_above_maximum_is_400():
    long_body = " ".join(["word"] * 170) + "."
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": long_body},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments"


def test_body_below_minimum_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": "Short body text here."},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.1.text"


def test_cta_word_range_is_400():
    short_cta = [{"kind": "hook", "text": _hook()}, {"kind": "body", "text": _body()}, {"kind": "cta", "text": "Save it."}]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(short_cta)
    assert exc_info.value.field == "segments.2.text"
    long_cta = [{"kind": "hook", "text": _hook()}, {"kind": "body", "text": _body()}, {"kind": "cta", "text": " ".join(["word"] * 21) + "."}]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(long_cta)
    assert exc_info.value.field == "segments.2.text"


def test_max_segments_is_400():
    # 20 + 11*14 + 5 = 179 words: inside the 60-200 total, so the segment
    # cap rule is what fires, not the total rule.
    segments = [{"kind": "hook", "text": " ".join(["word"] * 20) + "."}]
    for i in range(11):
        segments.append({"kind": "body", "text": " ".join(["body"] * 12) + f" number {i}."})
    segments.append({"kind": "cta", "text": "Save this video now please."})
    assert len(segments) == 13
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments"
    assert exc_info.value.rule == f"At most {script_segments.MAX_SEGMENTS} segments are allowed."


def test_max_medias_is_400():
    # 20 + 7*14 + 5 = 123 words and 9 segments: inside the total and the
    # segment cap, so the media cap rule is what fires.
    segments = [{"kind": "hook", "text": " ".join(["word"] * 20) + "."}]
    for i in range(7):
        segments.append(
            {
                "kind": "body",
                "text": " ".join(["body"] * 12) + f" number {i}.",
                "media": {"url": f"https://example.com/{i}.jpg"},
            }
        )
    segments.append({"kind": "cta", "text": "Save this video now please."})
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments"
    assert exc_info.value.rule == f"At most {script_segments.MAX_MEDIAS} medias are allowed."


def test_media_id_and_url_together_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": _body(), "media": {"mediaId": "abc", "url": "https://example.com/x.jpg"}},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.1.media"


def test_media_with_neither_id_nor_url_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": _body(), "media": {}},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.1.media"


def test_valid_media_shape_passes():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": _body(), "media": {"mediaId": "abc"}},
        {"kind": "body", "text": _body() + " Second part.", "media": {"url": "https://example.com/x.jpg"}, "terms": ["restaurant kitchen"]},
        {"kind": "cta", "text": _cta()},
    ]
    result = script_segments.validate_segments(segments)
    assert result["media_count"] == 2


def test_hook_word_guard_below_15_is_400():
    segments = [
        {"kind": "hook", "text": "Short hook here today."},
        {"kind": "body", "text": _body()},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.0.text"


def test_hook_word_guard_above_40_is_400():
    long_hook = " ".join(["word"] * 41) + "."
    segments = [
        {"kind": "hook", "text": long_hook},
        {"kind": "body", "text": _body()},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.0.text"


def test_hook_duration_window():
    assert script_segments.check_hook_duration(_hook(), 8.0)["measured_seconds"] == 8.0
    assert script_segments.check_hook_duration(_hook(), 12.0)["measured_seconds"] == 12.0
    for bad in (7.9, 12.1, 0.0):
        with pytest.raises(SegmentValidationError) as exc_info:
            script_segments.check_hook_duration(_hook(), bad)
        assert exc_info.value.field == "segments.0.text"
        assert "8" in exc_info.value.fix and "12" in exc_info.value.fix


def test_measure_hook_duration_skips_tts_when_word_guard_fails():
    synthesizer = MagicMock(return_value=10.0)
    with pytest.raises(SegmentValidationError):
        script_segments.measure_hook_duration("Short hook.", synthesizer)
    synthesizer.assert_not_called()


def test_measure_hook_duration_calls_synthesizer_once_and_checks_window():
    synthesizer = MagicMock(return_value=10.0)
    result = script_segments.measure_hook_duration(_hook(), synthesizer)
    assert result["measured_seconds"] == 10.0
    assert synthesizer.call_count == 1
    synthesizer.return_value = 20.0
    with pytest.raises(SegmentValidationError):
        script_segments.measure_hook_duration(_hook(), synthesizer)


def test_supplied_segments_script_calls_no_llm():
    joined = script_segments.segments_to_script(_valid_segments())
    params = VideoParams(video_script=joined, video_subject="Porto", video_language="en-US")
    original = task_service.llm.generate_script
    calls = []

    def _recording_generate_script(*args, **kwargs):
        calls.append((args, kwargs))
        return "should not be called"

    try:
        task_service.llm.generate_script = _recording_generate_script  # type: ignore[attr-defined]
        result = task_service.generate_script("test-task", params)
    finally:
        task_service.llm.generate_script = original  # type: ignore[attr-defined]
    assert result == joined
    assert calls == []

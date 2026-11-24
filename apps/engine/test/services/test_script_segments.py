"""Tests for the mechanical script-segments contract (no LLM).

The contract is one call = one video: segments is an ordered list of
takes whose first segment is the hook and whose later segments are all
content. A CTA is just a content take, placed anywhere — there is no
cta kind, no CTA count rule, and no CTA position rule. Validation is
mechanical only: word counts, forbidden content, and shape. It never
calls an LLM and never fixes the input silently.
"""

from unittest.mock import MagicMock

import pytest

from app.models.schema import VideoParams
from app.services import script_segments
from app.services import task as task_service
from app.services.script_segments import SegmentValidationError


def _hook(words=25):
    base = (
        "Stop wasting your trip stuck in a ninety minute line for the "
        "original dish when a better table is still waiting nearby for you today."
    )
    assert len(base.split()) == words
    return base


def _content():
    return (
        "Locals skip the famous house and walk two minutes to a smaller "
        "kitchen where the sauce recipe has not changed since nineteen "
        "fifty three and the cook still greets every table by name "
        "before the first plate arrives at your table tonight."
    )


def _cta_take():
    return "Save this video before your next trip to Porto."


def _valid_segments():
    return [
        {"kind": "hook", "text": _hook()},
        {"kind": "content", "text": _content()},
        {"kind": "content", "text": _cta_take()},
    ]


def _word_count(text):
    return len(text.split())


def test_valid_segments_pass_and_join_to_script():
    result = script_segments.validate_segments(_valid_segments(), video_type="full_lipsync")
    assert result["hook_text"] == _hook()
    assert result["content_texts"] == [_content(), _cta_take()]
    assert "cta_text" not in result
    assert "cta_words" not in result
    assert result["total_words"] == _word_count(_hook()) + _word_count(_content()) + _word_count(
        _cta_take()
    )
    assert result["content_words"] >= 30
    joined = script_segments.segments_to_script(_valid_segments(), video_type="full_lipsync")
    assert joined == f"{_hook()}\n\n{_content()}\n\n{_cta_take()}"


def test_empty_segments_is_400():
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments([], video_type="full_lipsync")
    assert exc_info.value.field == "segments"
    assert exc_info.value.fix


def test_non_list_segments_is_400():
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments("not a list", video_type="full_lipsync")
    assert exc_info.value.field == "segments"


def test_hook_must_be_first():
    segments = [
        {"kind": "content", "text": _content()},
        {"kind": "hook", "text": _hook()},
        {"kind": "content", "text": _cta_take()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.0.kind"


def test_cta_take_may_sit_mid_video():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "content", "text": _cta_take()},
        {"kind": "content", "text": _content()},
    ]
    result = script_segments.validate_segments(segments, video_type="full_lipsync")
    assert result["content_texts"] == [_cta_take(), _content()]
    joined = script_segments.segments_to_script(segments, video_type="full_lipsync")
    assert joined == f"{_hook()}\n\n{_cta_take()}\n\n{_content()}"


def test_exactly_one_hook():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "hook", "text": _hook()},
        {"kind": "content", "text": _cta_take()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments"


def test_empty_segment_text_is_400():
    segments = [
        {"kind": "hook", "text": "   "},
        {"kind": "content", "text": _content()},
        {"kind": "content", "text": _cta_take()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.0.text"


def test_placeholder_is_400():
    for bad in ("[insira o texto aqui]", "TODO write this", "lorem ipsum dolor"):
        segments = [
            {"kind": "hook", "text": _hook()},
            {"kind": "content", "text": bad + " " + _content()},
            {"kind": "content", "text": _cta_take()},
        ]
        with pytest.raises(SegmentValidationError) as exc_info:
            script_segments.validate_segments(segments, video_type="full_lipsync")
        assert exc_info.value.field == "segments.1.text"


def test_link_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "content", "text": _content() + " See https://example.com for more."},
        {"kind": "content", "text": _cta_take()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.text"


def test_markdown_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "content", "text": "**Bold claim** " + _content()},
        {"kind": "content", "text": _cta_take()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.text"


def test_emoji_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "content", "text": _content() + " \U0001f600"},
        {"kind": "content", "text": _cta_take()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.text"


@pytest.mark.parametrize(
    "emoji",
    [
        "\U0001f600",
        "\U0001f300",
        "\U0001faff",
        "\U00002600",
        "\U000027bf",
        "\U0001f000",
        "\U0001f2ff",
        "\ufe0f",
    ],
)
def test_emoji_rejected_across_all_ranges(emoji):
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "content", "text": _content() + " " + emoji},
        {"kind": "content", "text": _cta_take()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.text"
    assert "emoji" in str(exc_info.value).lower()


@pytest.mark.parametrize(
    "char",
    [
        "\u25ff",
        "\u27c0",
        "\u1eff",
        "\U0001fb00",
    ],
)
def test_boundary_chars_outside_emoji_ranges_pass(char):
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "content", "text": _content() + " " + char},
        {"kind": "content", "text": _cta_take()},
    ]
    script_segments.validate_segments(segments, video_type="full_lipsync")


def test_stage_direction_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "content", "text": "[pausa] " + _content()},
        {"kind": "content", "text": _cta_take()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.text"


def test_hook_must_end_with_terminal_punctuation():
    segments = [
        {"kind": "hook", "text": _hook().rstrip(".")},
        {"kind": "content", "text": _content()},
        {"kind": "content", "text": _cta_take()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.0.text"


def test_repeated_segment_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "content", "text": _content()},
        {"kind": "content", "text": _content()},
        {"kind": "content", "text": _cta_take()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.2.text"


def test_total_below_minimum_is_400():
    segments = [
        {"kind": "hook", "text": " ".join(["word"] * 25) + "."},
        {"kind": "content", "text": " ".join(["word"] * 30) + "."},
        {"kind": "content", "text": "Save this video now."},
    ]
    assert (
        _word_count(segments[0]["text"])
        + _word_count(segments[1]["text"])
        + _word_count(segments[2]["text"])
        == 59
    )
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments"


def test_total_above_maximum_is_400():
    long_content = " ".join(["word"] * 170) + "."
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "content", "text": long_content},
        {"kind": "content", "text": _cta_take()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments"


def test_content_below_minimum_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "content", "text": "Short content text here."},
        {"kind": "content", "text": _cta_take()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.text"


def test_short_content_take_is_allowed():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "content", "text": " ".join(["word"] * 35) + "."},
        {"kind": "content", "text": "Save it."},
    ]
    result = script_segments.validate_segments(segments, video_type="full_lipsync")
    assert result["content_words"] == 37
    assert result["total_words"] == 62


def test_long_content_take_is_allowed():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "content", "text": _content()},
        {"kind": "content", "text": " ".join(["word"] * 21) + "."},
    ]
    result = script_segments.validate_segments(segments, video_type="full_lipsync")
    assert result["content_words"] == _word_count(_content()) + 21


def test_max_segments_is_400():
    segments = [{"kind": "hook", "text": " ".join(["word"] * 25) + "."}]
    for i in range(11):
        segments.append({"kind": "content", "text": " ".join(["body"] * 12) + f" number {i}."})
    segments.append({"kind": "content", "text": "Save this video now please."})
    assert len(segments) == 13
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments"
    assert exc_info.value.rule == f"At most {script_segments.MAX_SEGMENTS} segments are allowed."


def test_max_medias_is_400():
    segments = [{"kind": "hook", "text": " ".join(["word"] * 25) + "."}]
    for i in range(7):
        segments.append(
            {
                "kind": "content",
                "text": " ".join(["body"] * 12) + f" number {i}.",
                "media": [{"url": f"https://example.com/{i}.jpg"}],
            }
        )
    segments.append({"kind": "content", "text": "Save this video now please."})
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments"
    assert exc_info.value.rule == f"At most {script_segments.MAX_MEDIAS} medias are allowed."


def test_media_id_and_url_together_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {
            "kind": "content",
            "text": _content(),
            "media": [{"mediaId": "abc", "url": "https://example.com/x.jpg"}],
        },
        {"kind": "content", "text": _cta_take()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.media.0"


def test_media_with_neither_id_nor_url_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "content", "text": _content(), "media": [{}]},
        {"kind": "content", "text": _cta_take()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.media.0"


def test_media_with_unknown_key_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "content", "text": _content(), "media": [{"mediaId": "abc", "alt": "kitchen"}]},
        {"kind": "content", "text": _cta_take()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.media.0"


def test_media_shape_error_precedes_media_cap():
    segments = [{"kind": "hook", "text": _hook()}]
    for i in range(7):
        media = {"url": f"https://example.com/{i}.jpg"}
        if i == 1:
            media = {"mediaId": "abc", "alt": "kitchen"}
        segments.append(
            {
                "kind": "content",
                "text": " ".join(["body"] * 12) + f" number {i}.",
                "media": [media],
            }
        )
    segments.append({"kind": "content", "text": _cta_take()})
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.2.media.0"


def test_a_segment_terms_field_is_rejected_as_unknown():
    segments = [
        {"kind": "hook", "text": _hook()},
        {
            "kind": "content",
            "text": _content(),
            "media": [{"url": "https://example.com/x.jpg"}],
            "terms": ["restaurant kitchen"],
        },
        {"kind": "content", "text": _cta_take()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1"
    assert "terms" in exc_info.value.rule


def test_valid_media_shape_passes():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "content", "text": _content(), "media": [{"mediaId": "abc"}]},
        {
            "kind": "content",
            "text": _content() + " Second part.",
            "media": [{"url": "https://example.com/x.jpg"}],
        },
        {"kind": "content", "text": _cta_take()},
    ]
    result = script_segments.validate_segments(segments, video_type="full_lipsync")
    assert result["media_count"] == 2


def _with_overlay(overlay):
    return [
        {"kind": "hook", "text": _hook()},
        {
            "kind": "content",
            "text": _content(),
            "media": [{"url": "https://example.com/x.jpg", "overlay": overlay}],
        },
        {"kind": "content", "text": _cta_take()},
    ]


def test_media_overlay_with_every_field_passes_and_counts_as_one_media():
    result = script_segments.validate_segments(
        _with_overlay(
            {
                "title": "Sushi Kinoshita",
                "subtitle": "Rua das Flores 12, Porto",
                "badge": "about 35 EUR",
            }
        ),
        video_type="full_lipsync",
    )
    assert result["media_count"] == 1


def test_media_overlay_with_only_a_title_passes():
    assert (
        script_segments.validate_segments(
            _with_overlay({"title": "Sushi Kinoshita"}), video_type="full_lipsync"
        )["media_count"]
        == 1
    )


@pytest.mark.parametrize(
    "overlay",
    [
        "Sushi Kinoshita",
        {"subtitle": "no title"},
        {"title": "   "},
        {"title": 5},
        {"title": "Sushi", "subtitle": ""},
        {"title": "Sushi", "subtitle": 3},
        {"title": "Sushi", "badge": "  "},
        {"title": "Sushi", "price": "10"},
    ],
)
def test_media_overlay_with_a_bad_shape_is_400_on_the_overlay_field(overlay):
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(_with_overlay(overlay), video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.media.0.overlay"


@pytest.mark.parametrize(
    ("key", "limit"),
    [
        ("title", script_segments.MAX_OVERLAY_TITLE_CHARS),
        ("subtitle", script_segments.MAX_OVERLAY_SUBTITLE_CHARS),
        ("badge", script_segments.MAX_OVERLAY_BADGE_CHARS),
    ],
)
def test_media_overlay_text_at_the_limit_passes_and_one_over_is_400(key, limit):
    at_limit = {"title": "Sushi", key: "x" * limit}
    assert (
        script_segments.validate_segments(_with_overlay(at_limit), video_type="full_lipsync")["media_count"]
        == 1
    )
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(
            _with_overlay({"title": "Sushi", key: "x" * (limit + 1)}), video_type="full_lipsync"
        )
    assert exc_info.value.field == "segments.1.media.0.overlay"
    assert str(limit) in exc_info.value.rule


def test_media_overlay_needs_a_photo_to_sit_on():
    segments = _with_overlay({"title": "Sushi"})
    del segments[1]["media"][0]["url"]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.media.0"


def test_hook_word_guard_below_15_is_400():
    segments = [
        {"kind": "hook", "text": "Short hook here today."},
        {"kind": "content", "text": _content()},
        {"kind": "content", "text": _cta_take()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.0.text"


def test_hook_word_guard_above_40_is_400():
    long_hook = " ".join(["word"] * 41) + "."
    segments = [
        {"kind": "hook", "text": long_hook},
        {"kind": "content", "text": _content()},
        {"kind": "content", "text": _cta_take()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
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
    assert not hasattr(task_service, "llm")
    joined = script_segments.segments_to_script(_valid_segments(), video_type="full_lipsync")
    params = VideoParams(
        video_title="Porto",
        video_description="Test description.",
        video_type="voiceover",
        video_script=joined,
        video_language="en-US",
    )
    assert task_service.generate_script("test-task", params) == joined


def _photos(count, prefix):
    return [{"url": f"https://example.com/{prefix}{i}.jpg"} for i in range(count)]


def _images_segments(media=True):
    segments = [
        {"kind": "hook", "text": _hook(), "media": _photos(4, "h")},
        {"kind": "content", "text": _content(), "media": _photos(8, "b")},
        {
            "kind": "content",
            "text": _cta_take(),
            "media": [{"mediaId": "a" * 32 + ".jpg"}, {"url": "https://example.com/c.jpg"}],
        },
    ]
    if not media:
        del segments[1]["media"]
    return segments


def test_images_material_accepts_media_on_every_segment():
    result = script_segments.validate_segments(_images_segments())
    assert result["media_count"] == 14


def test_images_material_rejects_a_segment_without_media_on_that_segment():
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(_images_segments(media=False))
    assert exc_info.value.field == "segments.1.media"
    assert exc_info.value.rule == "The images material needs media on every segment."


def test_images_material_rejects_a_null_media_like_a_missing_one():
    segments = _images_segments()
    segments[2]["media"] = None
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.2.media"


def test_full_lipsync_still_allows_segments_without_media():
    assert (
        script_segments.validate_segments(_images_segments(media=False), video_type="full_lipsync")[
            "media_count"
        ]
        == 6
    )


def _many_media_segments(count):
    segments = [
        {
            "kind": "hook",
            "text": " ".join(["word"] * 25) + ".",
            "media": [{"url": "https://example.com/h.jpg"}],
        }
    ]
    for i in range(count):
        segments.append(
            {
                "kind": "content",
                "text": " ".join(["body"] * 12) + f" number {i}.",
                "media": [{"url": f"https://example.com/{i}.jpg"}],
            }
        )
    segments.append(
        {
            "kind": "content",
            "text": "Save this video now please.",
            "media": [{"url": "https://example.com/c.jpg"}],
        }
    )
    return segments


def test_images_density_names_how_many_photos_a_segment_is_missing():
    segments = _images_segments()
    segments[1]["text"] = " ".join(["word"] * 32)
    segments[1]["media"] = _photos(1, "few")
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.1.media"
    assert exc_info.value.rule == (
        "segment has 32 words (~12s) and needs at least 6 images (one per 2s); it has 1."
    )
    assert exc_info.value.fix == "Add 5 more images to this segment's media array."


def test_a_punctuation_only_segment_with_a_photo_is_rejected_before_charging():
    segments = _images_segments()
    segments[2]["text"] = "... ... ... ... ..."
    segments[2]["media"] = _photos(1, "c")
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.2.text"
    assert exc_info.value.rule == (
        "The images material needs spoken words on every segment that carries media."
    )
    assert exc_info.value.fix == (
        "Write real words for this segment, or move its photo to another segment."
    )


def test_a_punctuation_only_segment_is_still_allowed_in_full_lip_sync():
    segments = _images_segments()
    segments[0]["media"] = _photos(1, "h")
    segments[1]["media"] = _photos(1, "b")
    segments[2]["text"] = "... ... ... ... ..."
    segments[2]["media"] = _photos(1, "c")
    script_segments.validate_segments(segments, video_type="full_lipsync")


def test_the_six_media_cap_still_holds_for_full_lipsync():
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(_many_media_segments(5), video_type="full_lipsync")
    assert exc_info.value.rule == "At most 6 medias are allowed."
    assert exc_info.value.fix == "Remove medias until there are at most 6."


def test_images_cap_fix_names_shortening_when_minimums_exceed_the_cap():
    segments = [
        {"kind": "hook", "text": " ".join(["hook"] * 25) + ".", "media": _photos(4, "h")},
        *[
            {"kind": "content", "text": " ".join([f"body{i}"] * 25), "media": _photos(5, f"b{i}")}
            for i in range(6)
        ],
        {"kind": "content", "text": " ".join(["cta"] * 20), "media": _photos(4, "c")},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments"
    assert exc_info.value.rule == "At most 30 medias are allowed."
    assert "shorten the script" in exc_info.value.fix


def test_legacy_media_list_wraps_a_single_object_media():
    segments = [
        {"kind": "hook", "text": "Hook text."},
        {"kind": "content", "text": "Body text.", "media": {"mediaId": "abc.jpg"}},
        {"kind": "content", "text": "Cta text.", "media": [{"url": "https://example.com/x.jpg"}]},
        {"kind": "content", "text": "No media here."},
        {"kind": "content", "text": "Null media.", "media": None},
    ]
    wrapped = script_segments.legacy_media_list(segments)
    assert wrapped[1]["media"] == [{"mediaId": "abc.jpg"}]
    assert wrapped[2]["media"] == [{"url": "https://example.com/x.jpg"}]
    assert "media" not in wrapped[3]
    assert wrapped[4]["media"] is None
    assert script_segments.legacy_media_list("not a list") == "not a list"


def test_legacy_media_list_maps_old_kinds_to_content():
    segments = [
        {"kind": "hook", "text": "Hook text."},
        {"kind": "body", "text": "Body text."},
        {"kind": "cta", "text": "Cta text."},
    ]
    wrapped = script_segments.legacy_media_list(segments)
    assert [segment["kind"] for segment in wrapped] == ["hook", "content", "content"]
    assert wrapped[1]["text"] == "Body text."
    assert wrapped[2]["text"] == "Cta text."


def test_fresh_single_object_media_is_still_rejected():
    segments = _images_segments()
    segments[1]["media"] = {"mediaId": "abc.jpg"}
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.1.media"
    assert exc_info.value.rule == "Media must be an array."


def test_segments_to_script_forwards_full_lipsync_to_validation():
    sparse = [
        {"kind": "hook", "text": _hook()},
        {"kind": "content", "text": _content(), "media": _photos(1, "b")},
        {"kind": "content", "text": _cta_take(), "media": _photos(1, "c")},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.segments_to_script(sparse)
    assert exc_info.value.field == "segments.0.media"
    assert script_segments.segments_to_script(sparse, video_type="full_lipsync") == "\n\n".join(
        [_hook(), _content(), _cta_take()]
    )


def _clip_segments():
    return [
        {"kind": "hook", "text": _hook(), "media": [{"url": "https://example.com/h.jpg"}]},
        {"kind": "content", "text": _content(),
         "media": [{"url": "https://example.com/b1.mp4"}, {"url": "https://example.com/b2.mp4"}]},
        {"kind": "content", "text": "Save this video now please.",
         "media": [{"url": "https://example.com/c.jpg"}]},
    ]


def test_one_clip_per_content_take_passes_the_density_minimum():
    result = script_segments.validate_segments(_clip_segments())
    assert result["media_count"] == 4


def test_one_photo_in_a_long_take_still_fails_the_density_minimum():
    segments = _clip_segments()
    segments[0]["text"] = " ".join(["word"] * 40) + "."
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="voiceover")
    assert exc_info.value.field == "segments.0.media"
    assert exc_info.value.rule == (
        "segment has 40 words (~15s) and needs at least 8 images (one per 2s); it has 1."
    )
    assert exc_info.value.fix == "Add 7 more images to this segment's media array."


def test_the_density_maximum_counts_clips_one_for_one():
    segments = _clip_segments()
    segments[2]["media"] = [
        {"url": "https://example.com/c.mp4"},
        {"url": "https://example.com/c1.jpg"},
        {"url": "https://example.com/c2.jpg"},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.2.media"
    assert exc_info.value.rule == (
        "segment has 5 words (~2s) and allows at most 1 image "
        "(each image needs ~1s); it has 3."
    )


def test_a_repeated_clip_reference_is_rejected_before_charging():
    segments = _clip_segments()
    segments[1]["media"] = [
        {"url": "https://example.com/h.mp4"}, {"url": "https://example.com/h.mp4"},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.1.media.1"
    assert exc_info.value.rule == "the same video clip must not repeat"
    assert exc_info.value.fix == "Use a different video clip for each media item."


def test_a_repeated_photo_reference_keeps_its_message():
    segments = _images_segments()
    segments[1]["media"] = [{"url": "https://example.com/h0.jpg"}]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.rule == "the same photo must not repeat"
def _with_duration(duration):
    return [
        {"kind": "hook", "text": _hook()},
        {
            "kind": "content",
            "text": _content(),
            "media": [{"url": "https://example.com/x.jpg", "duration": duration}],
        },
        {"kind": "content", "text": _cta_take()},
    ]


@pytest.mark.parametrize("duration", [0.5, 1, 2.0, 3, 6.0])
def test_media_duration_in_range_passes(duration):
    result = script_segments.validate_segments(_with_duration(duration), video_type="full_lipsync")
    assert result["media_count"] == 1


@pytest.mark.parametrize("duration", [None])
def test_media_duration_may_be_omitted(duration):
    assert (
        script_segments.validate_segments(_with_duration(duration), video_type="full_lipsync")[
            "media_count"
        ]
        == 1
    )


@pytest.mark.parametrize("duration", [0, -1, 0.49, 6.01, 60, "3", True, float("nan"), float("inf")])
def test_media_duration_out_of_range_or_not_a_number_is_400(duration):
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(_with_duration(duration), video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.media.0.duration"
    assert exc_info.value.fix

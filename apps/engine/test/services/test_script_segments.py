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
    result = script_segments.validate_segments(_valid_segments(), video_type="full_lipsync")
    assert result["hook_text"] == _hook()
    assert result["cta_text"] == _cta()
    assert result["total_words"] == _word_count(_hook()) + _word_count(_body()) + _word_count(
        _cta()
    )
    assert result["body_words"] >= 30
    joined = script_segments.segments_to_script(_valid_segments(), video_type="full_lipsync")
    assert joined == f"{_hook()}\n\n{_body()}\n\n{_cta()}"


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
        {"kind": "body", "text": _body()},
        {"kind": "hook", "text": _hook()},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.0.kind"


def test_cta_must_be_last():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "cta", "text": _cta()},
        {"kind": "body", "text": _body()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.2.kind"


def test_exactly_one_hook_and_one_cta():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "hook", "text": _hook()},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments"


def test_empty_segment_text_is_400():
    segments = [
        {"kind": "hook", "text": "   "},
        {"kind": "body", "text": _body()},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.0.text"


def test_placeholder_is_400():
    for bad in ("[insira o texto aqui]", "TODO write this", "lorem ipsum dolor"):
        segments = [
            {"kind": "hook", "text": _hook()},
            {"kind": "body", "text": bad + " " + _body()},
            {"kind": "cta", "text": _cta()},
        ]
        with pytest.raises(SegmentValidationError) as exc_info:
            script_segments.validate_segments(segments, video_type="full_lipsync")
        assert exc_info.value.field == "segments.1.text"


def test_link_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": _body() + " See https://example.com for more."},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.text"


def test_markdown_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": "**Bold claim** " + _body()},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.text"


def test_emoji_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": _body() + " \U0001f600"},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.text"


@pytest.mark.parametrize(
    "emoji",
    [
        "\U0001f600",  # emoticons, inside 1F300-1FAFF
        "\U0001f300",  # start of 1F300-1FAFF
        "\U0001faff",  # end of 1F300-1FAFF
        "\U00002600",  # start of 2600-27BF
        "\U000027bf",  # end of 2600-27BF
        "\U0001f000",  # start of 1F000-1F2FF
        "\U0001f2ff",  # end of 1F000-1F2FF
        "\ufe0f",  # variation selector
    ],
)
def test_emoji_rejected_across_all_ranges(emoji):
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": _body() + " " + emoji},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.text"
    assert "emoji" in str(exc_info.value).lower()


@pytest.mark.parametrize(
    "char",
    [
        "\u25ff",  # just below 2600
        "\u27c0",  # just above 27BF
        "\u1eff",  # just below 1F000
        "\U0001fb00",  # just above 1FAFF
    ],
)
def test_boundary_chars_outside_emoji_ranges_pass(char):
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": _body() + " " + char},
        {"kind": "cta", "text": _cta()},
    ]
    script_segments.validate_segments(segments, video_type="full_lipsync")


def test_stage_direction_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": "[pausa] " + _body()},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.text"


def test_hook_must_end_with_terminal_punctuation():
    segments = [
        {"kind": "hook", "text": _hook().rstrip(".")},
        {"kind": "body", "text": _body()},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.0.text"


def test_repeated_segment_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": _body()},
        {"kind": "body", "text": _body()},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.2.text"


def test_total_below_minimum_is_400():
    segments = [
        {"kind": "hook", "text": " ".join(["word"] * 20) + "."},
        {"kind": "body", "text": " ".join(["word"] * 30) + "."},
        {"kind": "cta", "text": "Save this video now please."},
    ]
    # Total is 55 words: below the 60-word minimum.
    assert (
        _word_count(segments[0]["text"])
        + _word_count(segments[1]["text"])
        + _word_count(segments[2]["text"])
        == 55
    )
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments"


def test_total_above_maximum_is_400():
    long_body = " ".join(["word"] * 170) + "."
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": long_body},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments"


def test_body_below_minimum_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": "Short body text here."},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.text"


def test_cta_word_range_is_400():
    short_cta = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": _body()},
        {"kind": "cta", "text": "Save it."},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(short_cta, video_type="full_lipsync")
    assert exc_info.value.field == "segments.2.text"
    long_cta = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": _body()},
        {"kind": "cta", "text": " ".join(["word"] * 21) + "."},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(long_cta, video_type="full_lipsync")
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
        script_segments.validate_segments(segments, video_type="full_lipsync")
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
                "media": [{"url": f"https://example.com/{i}.jpg"}],
            }
        )
    segments.append({"kind": "cta", "text": "Save this video now please."})
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments"
    assert exc_info.value.rule == f"At most {script_segments.MAX_MEDIAS} medias are allowed."


def test_media_id_and_url_together_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {
            "kind": "body",
            "text": _body(),
            "media": [{"mediaId": "abc", "url": "https://example.com/x.jpg"}],
        },
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.media.0"


def test_media_with_neither_id_nor_url_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": _body(), "media": [{}]},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.media.0"


def test_media_with_unknown_key_is_400():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": _body(), "media": [{"mediaId": "abc", "alt": "kitchen"}]},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.media.0"


def test_media_shape_error_precedes_media_cap():
    # Pins the documented rule order: the media shape loop runs before
    # the media cap, so a shape violation in an over-cap request fires
    # first instead of the cap error.
    segments = [{"kind": "hook", "text": _hook()}]
    for i in range(7):
        media = {"url": f"https://example.com/{i}.jpg"}
        if i == 1:
            media = {"mediaId": "abc", "alt": "kitchen"}
        segments.append(
            {
                "kind": "body",
                "text": " ".join(["body"] * 12) + f" number {i}.",
                "media": [media],
            }
        )
    segments.append({"kind": "cta", "text": _cta()})
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.2.media.0"


def test_a_segment_terms_field_is_rejected_as_unknown():
    # Per-segment search terms died with the stock path (issue #542):
    # "terms" is no longer a known segment field.
    segments = [
        {"kind": "hook", "text": _hook()},
        {
            "kind": "body",
            "text": _body(),
            "media": [{"url": "https://example.com/x.jpg"}],
            "terms": ["restaurant kitchen"],
        },
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1"
    assert "terms" in exc_info.value.rule


def test_valid_media_shape_passes():
    segments = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": _body(), "media": [{"mediaId": "abc"}]},
        {
            "kind": "body",
            "text": _body() + " Second part.",
            "media": [{"url": "https://example.com/x.jpg"}],
        },
        {"kind": "cta", "text": _cta()},
    ]
    result = script_segments.validate_segments(segments, video_type="full_lipsync")
    assert result["media_count"] == 2


def _with_overlay(overlay):
    return [
        {"kind": "hook", "text": _hook()},
        {
            "kind": "body",
            "text": _body(),
            "media": [{"url": "https://example.com/x.jpg", "overlay": overlay}],
        },
        {"kind": "cta", "text": _cta()},
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
        {"kind": "body", "text": _body()},
        {"kind": "cta", "text": _cta()},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.0.text"


def test_hook_word_guard_above_40_is_400():
    long_hook = " ".join(["word"] * 41) + "."
    segments = [
        {"kind": "hook", "text": long_hook},
        {"kind": "body", "text": _body()},
        {"kind": "cta", "text": _cta()},
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
    # The LLM core is deleted: there is no generate_script to patch
    # anymore, only the mechanical pass-through in task.generate_script.
    assert not hasattr(task_service, "llm")
    joined = script_segments.segments_to_script(_valid_segments(), video_type="full_lipsync")
    params = VideoParams(
        video_title="Porto",
        video_description="Test description.",
        video_type="faceless",
        video_script=joined,
        video_language="en-US",
    )
    assert task_service.generate_script("test-task", params) == joined


# ---- images material: a list of photos, about one per 3 seconds


def _photos(count, prefix):
    return [{"url": f"https://example.com/{prefix}{i}.jpg"} for i in range(count)]


def _images_segments(media=True):
    segments = [
        {"kind": "hook", "text": _hook(), "media": _photos(3, "h")},
        {"kind": "body", "text": _body(), "media": _photos(6, "b")},
        {
            "kind": "cta",
            "text": _cta(),
            "media": [{"mediaId": "a" * 32 + ".jpg"}, {"url": "https://example.com/c.jpg"}],
        },
    ]
    if not media:
        del segments[1]["media"]
    return segments


def test_images_material_accepts_media_on_every_segment():
    result = script_segments.validate_segments(_images_segments())
    assert result["media_count"] == 11


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
        == 5
    )


def _many_media_segments(count):
    # 20 + count*14 + 5 words: inside the total and the segment cap for count <= 10.
    segments = [
        {
            "kind": "hook",
            "text": " ".join(["word"] * 20) + ".",
            "media": [{"url": "https://example.com/h.jpg"}],
        }
    ]
    for i in range(count):
        segments.append(
            {
                "kind": "body",
                "text": " ".join(["body"] * 12) + f" number {i}.",
                "media": [{"url": f"https://example.com/{i}.jpg"}],
            }
        )
    segments.append(
        {
            "kind": "cta",
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
        "segment has 32 words (~12s) and needs at least 4 images (one per ~3s); it has 1."
    )
    assert exc_info.value.fix == "Add 3 more images to this segment's media array."


def test_a_punctuation_only_segment_with_a_photo_is_rejected_before_charging():
    # "..." counts as words for the density rule but has no spoken
    # words, so at render its photo gets no seconds and the
    # all-must-survive rule would fail the task after charging.
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
    # Full lip sync only warns on a skipped photo, so validation does
    # not need to reject it there. (One photo per segment: full mode
    # caps the video at 6 medias.)
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


def test_images_cap_fix_names_merging_when_minimums_exceed_the_cap():  # Hook 25 words + six 25-word body segments + a 20-word CTA = 195
    # words: every segment meets its density minimum (4, 4 x 6, 3 = 31
    # photos) yet the 30-photo cap fires, and removing any photo
    # re-triggers density. The cap fix must name the escape (merge
    # segments) so fix-and-resubmit converges instead of bouncing
    # between the two errors.
    segments = [
        {"kind": "hook", "text": " ".join(["hook"] * 25) + ".", "media": _photos(4, "h")},
        *[
            {"kind": "body", "text": " ".join([f"body{i}"] * 25), "media": _photos(4, f"b{i}")}
            for i in range(6)
        ],
        {"kind": "cta", "text": " ".join(["cta"] * 20), "media": _photos(3, "c")},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments"
    assert exc_info.value.rule == "At most 30 medias are allowed."
    assert "merge segments" in exc_info.value.fix


def test_legacy_media_list_wraps_a_single_object_media():
    segments = [
        {"kind": "hook", "text": "Hook text."},
        {"kind": "body", "text": "Body text.", "media": {"mediaId": "abc.jpg"}},
        {"kind": "cta", "text": "Cta text.", "media": [{"url": "https://example.com/x.jpg"}]},
        {"kind": "body", "text": "No media here."},
        {"kind": "body", "text": "Null media.", "media": None},
    ]
    wrapped = script_segments.legacy_media_list(segments)
    assert wrapped[1]["media"] == [{"mediaId": "abc.jpg"}]
    assert wrapped[2]["media"] == [{"url": "https://example.com/x.jpg"}]
    assert "media" not in wrapped[3]
    assert wrapped[4]["media"] is None
    assert script_segments.legacy_media_list("not a list") == "not a list"


def test_fresh_single_object_media_is_still_rejected():
    # Only persisted-row dispatch normalizes the legacy shape; a fresh
    # request still sends media as a list, and a single object is a 400.
    segments = _images_segments()
    segments[1]["media"] = {"mediaId": "abc.jpg"}
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.1.media"
    assert exc_info.value.rule == "Media must be an array."


def test_segments_to_script_forwards_full_lipsync_to_validation():
    # Sparse on purpose: the hook carries no media, which the default
    # images rules reject but full lip-sync allows.
    sparse = [
        {"kind": "hook", "text": _hook()},
        {"kind": "body", "text": _body(), "media": _photos(1, "b")},
        {"kind": "cta", "text": _cta(), "media": _photos(1, "c")},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.segments_to_script(sparse)
    assert exc_info.value.field == "segments.0.media"
    assert script_segments.segments_to_script(sparse, video_type="full_lipsync") == "\n\n".join(
        [_hook(), _body(), _cta()]
    )

"""media_aspect: one ratio rule for every agent image shown full-frame.

The rule is the stock rule from material_verification: a photo narrower
than the canvas (pillarbox) is always rejected; a wider photo is
accepted only while the horizontal bars stay within MAX_LETTERBOX_BARS.
"""

import pytest

from app.models.schema import VideoAspect
from app.services import media_aspect
from app.services.image_material import MIN_MATERIAL_EDGE


def test_label_simplifies_dimensions_to_a_ratio():
    assert media_aspect.ratio_label(1920, 1080) == "16:9"
    assert media_aspect.ratio_label(1080, 1920) == "9:16"
    assert media_aspect.ratio_label(1200, 800) == "3:2"
    assert media_aspect.ratio_label(100, 100) == "1:1"


def test_matching_ratio_has_no_mismatch():
    assert media_aspect.mismatch_detail(1920, 1080, VideoAspect.landscape) is None
    assert media_aspect.mismatch_detail(1080, 1920, VideoAspect.portrait) is None
    assert media_aspect.mismatch_detail(1080, 1080, VideoAspect.square) is None
    # Slightly wider than the canvas, bars inside the 35% ceiling.
    assert media_aspect.mismatch_detail(1200, 1600, VideoAspect.portrait) is None


@pytest.mark.parametrize(
    "width,height,aspect",
    [
        (1080, 1920, VideoAspect.landscape),  # pillarbox: narrower than the canvas
        (1920, 1080, VideoAspect.portrait),  # 68% bars, over the 35% ceiling
        (1080, 1080, VideoAspect.portrait),  # square in a 9:16 frame: 44% bars
        (1080, 1080, VideoAspect.landscape),  # square in a 16:9 frame: pillarbox
        (1920, 1080, VideoAspect.square),  # 44% bars in a 1:1 frame
    ],
)
def test_mismatched_ratio_names_both_sides(width, height, aspect):
    detail = media_aspect.mismatch_detail(width, height, aspect)
    assert detail is not None
    assert f"{width}x{height}" in detail
    assert media_aspect.ratio_label(width, height) in detail
    assert aspect.value in detail
    target_w, target_h = aspect.to_resolution()
    assert f"{target_w}x{target_h}" in detail


def test_rejection_reason_prefers_low_resolution_over_aspect():
    reason = media_aspect.rejection_reason(100, 100, VideoAspect.portrait)
    assert (
        reason
        == f"low resolution material: 100x100, minimum {MIN_MATERIAL_EDGE}x{MIN_MATERIAL_EDGE} required"
    )


def test_rejection_reason_names_the_wrong_aspect():
    reason = media_aspect.rejection_reason(1920, 1080, VideoAspect.portrait)
    assert reason is not None
    assert reason.startswith("wrong aspect ratio: 1920x1080 (16:9); expected 9:16 (1080x1920)")


def test_rejection_reason_is_none_when_everything_fits():
    assert media_aspect.rejection_reason(1080, 1920, VideoAspect.portrait) is None
    # No aspect to check against: only the size floor applies.
    assert media_aspect.rejection_reason(1920, 1080, None) is None
    assert media_aspect.rejection_reason(1920, 1080) is None


def test_coerce_aspect_accepts_the_enum_its_value_and_none():
    assert media_aspect.coerce_aspect(None) is None
    assert media_aspect.coerce_aspect(VideoAspect.portrait) is VideoAspect.portrait
    assert media_aspect.coerce_aspect("9:16") is VideoAspect.portrait
    assert media_aspect.coerce_aspect("16:9") is VideoAspect.landscape


def test_coerce_aspect_rejects_an_unknown_value():
    with pytest.raises(ValueError, match="unsupported video aspect"):
        media_aspect.coerce_aspect("4:3")

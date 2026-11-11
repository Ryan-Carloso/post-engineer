"""Direct tests for the letterbox ratio rule (moved from material_verification).

The rule is shared by the aspect gate (media_aspect) and video.py's fit
check; these tests pin it at the source so the mutmut shard attributes
coverage to this module.
"""

from app.models.schema import VideoAspect
from app.services.letterbox import MAX_LETTERBOX_BARS, ratio_matches


def test_letterbox_ceiling_is_35_percent():
    assert MAX_LETTERBOX_BARS == 0.35


def test_exact_ratio_matches():
    assert ratio_matches(1920, 1080, VideoAspect.landscape) is True
    assert ratio_matches(1080, 1920, VideoAspect.portrait) is True


def test_wider_photo_matches_while_bars_stay_within_the_ceiling():
    # 2.4:1 against 16:9 needs bars of 1 - 1.78/2.4 = 26% of the frame.
    assert ratio_matches(2400, 1000, VideoAspect.landscape) is True


def test_wider_photo_rejects_once_bars_exceed_the_ceiling():
    # 3:1 against 16:9 needs bars of 1 - 1.78/3 = 41% of the frame.
    assert ratio_matches(3000, 1000, VideoAspect.landscape) is False


def test_narrower_photo_rejects_immediately():
    # A portrait photo on a landscape canvas needs side bars, not top/bottom.
    assert ratio_matches(1000, 1920, VideoAspect.landscape) is False


def test_missing_or_zero_dimensions_reject():
    assert ratio_matches(0, 1080, VideoAspect.landscape) is False
    assert ratio_matches(1920, 0, VideoAspect.landscape) is False
    assert ratio_matches(-1920, 1080, VideoAspect.landscape) is False

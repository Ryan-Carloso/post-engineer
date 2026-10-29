"""svg_terms: catalog search terms with alternatives, hold cap and coverage.

The catalog only knows concrete things (hens, waiters, plates), while the
script talks about "franzinhas" and "structural collapse". Each svg term
carries up to three alternatives, specific to generic ("francesinha |
sandwich plate | food"), tried in order; the persona niche closes the list
so a sparse catalog still shows something on topic. A drawing never holds
the screen for SVG_CLIP_MIN_SECONDS to SVG_CLIP_MAX_SECONDS, and low coverage is reported,
never fatal.
"""

from unittest.mock import patch

import pytest

from app.models.schema import VideoParams
from app.services import svg_terms


def _params(**overrides):
    params = VideoParams(video_subject="francesinha spots in porto", faceless_material="svg")
    for key, value in overrides.items():
        setattr(params, key, value)
    return params


class _Persona:
    def __init__(self, niche):
        self.niche = niche


def test_no_llm_terms_are_generated_without_user_terms():
    # Without user-supplied terms there is no generated list any more: only
    # the niche/subject fallback remains, and the module has no LLM to call.
    assert not hasattr(svg_terms, "llm")
    assert not hasattr(svg_terms, "_generate")
    params = _params(persona=_Persona("food reviews"))
    assert svg_terms.resolve_svg_terms(params, "script") == [
        "food reviews | francesinha spots in porto"
    ]


def test_alternatives_split_on_the_separator_trimmed_and_capped():
    assert svg_terms.parse_alternatives(" francesinha | sandwich plate |food ") == [
        "francesinha",
        "sandwich plate",
        "food",
    ]
    assert svg_terms.parse_alternatives("a | b | c | d") == ["a", "b", "c"]


def test_term_without_separator_is_one_alternative_and_empties_drop():
    assert svg_terms.parse_alternatives("waiter") == ["waiter"]
    assert svg_terms.parse_alternatives(" | waiter |  ") == ["waiter"]
    assert svg_terms.parse_alternatives("  ") == []


@pytest.fixture(autouse=True)
def _no_pin():
    # The first-match picker has its own tests (test_svg_pick.py).
    with patch.object(
        svg_terms.svg_pick, "pin_relevant", side_effect=lambda subject, script, terms: terms
    ):
        yield


def test_user_terms_are_kept_and_still_get_the_fallback():
    params = _params(video_terms="hen, waiter")
    terms = svg_terms.resolve_svg_terms(params, "script")
    assert terms == ["hen", "waiter", "francesinha spots in porto"]


def test_user_terms_as_a_list_are_kept_and_still_get_the_fallback():
    params = _params(video_terms=["hen", "waiter"])
    terms = svg_terms.resolve_svg_terms(params, "script")
    assert terms == ["hen", "waiter", "francesinha spots in porto"]


def test_no_user_terms_and_no_persona_leaves_only_the_subject_fallback():
    params = _params()
    assert svg_terms.resolve_svg_terms(params, "script") == ["francesinha spots in porto"]


def test_svg_clips_last_four_to_six_seconds_by_drawing_count():
    # Fewer good drawings hold longer (and draw slower), never past 6s;
    # many drawings never drop below 4s.
    assert (svg_terms.SVG_CLIP_MIN_SECONDS, svg_terms.SVG_CLIP_MAX_SECONDS) == (4, 6)
    svg = _params(video_clip_duration=2)
    assert svg_terms.clip_seconds(svg, drawings=10, audio_seconds=26.0) == 4
    assert svg_terms.clip_seconds(svg, drawings=5, audio_seconds=26.0) == 6
    assert svg_terms.clip_seconds(svg, drawings=5, audio_seconds=24.0) == 5
    assert svg_terms.clip_seconds(svg, drawings=2, audio_seconds=30.0) == 6
    assert svg_terms.clip_seconds(svg) == 4


def test_stock_clip_duration_is_untouched():
    params = _params(video_clip_duration=6, faceless_material="broll")
    assert svg_terms.clip_seconds(params) == 6


def test_low_coverage_is_reported_without_raising():
    with patch.object(svg_terms, "track_event") as track:
        svg_terms.report_coverage("t1", drawings=2, clip_seconds=4, audio_seconds=30.0)
    track.assert_called_once()
    name, props = track.call_args.args
    assert name == "svg_coverage_low"
    assert props == {"task_id": "t1", "drawings": 2, "coverage": 0.27}


def test_full_coverage_reports_nothing():
    with patch.object(svg_terms, "track_event") as track:
        svg_terms.report_coverage("t1", drawings=8, clip_seconds=4, audio_seconds=30.0)
    track.assert_not_called()


def test_too_many_drawings_are_thinned_evenly_keeping_both_ends():
    # 12 drawings x 4s = 48s for 36s of voice: the last ones (the map for
    # "your next Porto trip") were cut and every later drawing ran late.
    terms = [f"path:{n}.svg" for n in range(12)]
    kept = svg_terms.fit_to_audio(terms, audio_seconds=36.0)
    assert len(kept) == 9
    assert kept[0] == "path:0.svg" and kept[-1] == "path:11.svg"
    assert kept == sorted(set(kept), key=terms.index)


def test_drawings_that_fit_are_untouched():
    terms = ["path:a.svg", "path:b.svg"]
    assert svg_terms.fit_to_audio(terms, audio_seconds=36.0) == terms
    assert svg_terms.fit_to_audio(terms, audio_seconds=0.0) == terms




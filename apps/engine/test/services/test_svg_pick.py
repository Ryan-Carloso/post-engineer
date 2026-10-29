"""svg_pick: first catalog match per script moment, no LLM picker.

The LLM picker rated each moment's candidate drawings and kept only the
clear ones; without it every moment keeps its first title match. That is a
documented quality regression: a wrong first match (a guard at a door, a
traffic light) can reach the video again. What stays mechanical: a moment
with no candidates is skipped, the same drawing is never pinned twice, and
a disabled catalog returns the terms untouched.
"""

from unittest.mock import patch

from app.services import svg_pick
from app.services.svg_catalog import SvgAsset


def _asset(title):
    return SvgAsset(asset_id=title, title=title, relative_path=f"Pack/{title}.svg")


_CANDIDATES = {
    "francesinha | sandwich": [_asset("Sandwich"), _asset("Tree")],
    "queue | waiting": [_asset("Road"), _asset("Armoured Man")],
    "clock": [_asset("Wall Clock")],
}


def _pin(candidates=None):
    candidates = _CANDIDATES if candidates is None else candidates
    with (
        patch.object(svg_pick.svg_catalog, "is_enabled", return_value=True),
        patch.object(
            svg_pick.svg_catalog,
            "search_candidates",
            side_effect=lambda alternatives: candidates[" | ".join(alternatives)],
        ),
    ):
        return svg_pick.pin_relevant("francesinha", "script", list(candidates))


def test_each_moment_keeps_its_first_match_in_script_order():
    assert _pin() == ["path:Pack/Sandwich.svg", "path:Pack/Road.svg", "path:Pack/Wall Clock.svg"]


def test_a_moment_with_no_candidates_is_skipped():
    candidates = {**_CANDIDATES, "queue | waiting": []}
    assert _pin(candidates) == ["path:Pack/Sandwich.svg", "path:Pack/Wall Clock.svg"]


def test_a_drawing_picked_twice_is_pinned_once():
    candidates = {
        "francesinha | sandwich": [_asset("Sandwich")],
        "queue | waiting": [_asset("Sandwich")],
    }
    assert _pin(candidates) == ["path:Pack/Sandwich.svg"]


def test_disabled_catalog_returns_terms_untouched():
    with patch.object(svg_pick.svg_catalog, "is_enabled", return_value=False):
        assert svg_pick.pin_relevant("x", "s", ["a | b"]) == ["a | b"]


def test_no_candidates_at_all_returns_terms_untouched():
    with (
        patch.object(svg_pick.svg_catalog, "is_enabled", return_value=True),
        patch.object(svg_pick.svg_catalog, "search_candidates", return_value=[]),
    ):
        assert svg_pick.pin_relevant("x", "s", ["a | b"]) == ["a | b"]


def test_the_picker_has_no_llm_call_left():
    # The picker module must not import the LLM at all: any score-based
    # helper left behind would be dead code the next reader trusts.
    assert not hasattr(svg_pick, "llm")
    assert not hasattr(svg_pick, "_ask_picker")
    assert not hasattr(svg_pick, "_choose")
    assert not hasattr(svg_pick, "_prompt")


def test_pinned_path_parses_back():
    assert svg_pick.pinned_path("path:Pack/Sandwich.svg") == "Pack/Sandwich.svg"
    assert svg_pick.pinned_path("sandwich") is None

"""svg_pick: one LLM call rates the drawings of each script moment.

Title matches alone showed a tree, a road, an armoured man, a guard at a door
and a traffic light in a francesinha video. The picker rates each candidate
(3 exactly what the moment says, 2 clearly shows it, 1 loosely related); only
clear drawings (2 and 3) are chosen, loose ones only top the list up to the
floor of distinct drawings, and a drawing nobody rated is never used to fill a
gap. A moment with no clear drawing is dropped: its neighbours hold longer.
"""

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services import svg_pick
from app.services.svg_catalog import SvgAsset


def _asset(title):
    return SvgAsset(asset_id=title, title=title, relative_path=f"Pack/{title}.svg")


_CANDIDATES = {
    "francesinha | sandwich": [_asset("Sandwich"), _asset("Tree")],
    "queue | waiting": [_asset("Road"), _asset("Armoured Man")],
    "clock": [_asset("Wall Clock")],
}


def _reply(*moments):
    """A picker reply: a flat list of [moment, candidate_number, score] triples."""
    return json.dumps(
        [[moment, number, score] for moment, ratings in enumerate(moments) for number, score in ratings]
    )


def _pin(*replies, candidates=None):
    candidates = _CANDIDATES if candidates is None else candidates
    side_effect = list(replies) if len(replies) > 1 else None
    with (
        patch.object(svg_pick.svg_catalog, "is_enabled", return_value=True),
        patch.object(
            svg_pick.svg_catalog,
            "search_candidates",
            side_effect=lambda alternatives: candidates[" | ".join(alternatives)],
        ),
        patch.object(
            svg_pick.llm,
            "_generate_response_with_fallback",
            side_effect=side_effect,
            return_value=replies[0],
        ) as llm,
    ):
        return svg_pick.pin_relevant("francesinha", "script", list(candidates)), llm


@pytest.fixture(autouse=True)
def _no_floor(monkeypatch):
    # The floor has its own tests below; the rest pin the picker alone.
    monkeypatch.setattr(svg_pick, "MIN_DRAWINGS", 0)


# ---- choosing


def test_only_clear_drawings_are_chosen():
    pinned, llm = _pin(_reply([(0, 3)], [(0, 1)], [(0, 2)]))
    assert pinned == ["path:Pack/Sandwich.svg", "path:Pack/Wall Clock.svg"]
    assert llm.call_count == 1


def test_up_to_two_clear_drawings_per_moment_best_score_first():
    assert svg_pick.MAX_PICKS_PER_MOMENT == 2
    pinned, _ = _pin(_reply([(1, 2), (0, 3)], [], [(0, 2)]))
    assert pinned == ["path:Pack/Sandwich.svg", "path:Pack/Tree.svg", "path:Pack/Wall Clock.svg"]


def test_more_than_two_clear_drawings_keep_the_best_two():
    candidates = {**_CANDIDATES, "francesinha | sandwich": [_asset("Sandwich"), _asset("Tree"), _asset("Plate")]}
    pinned, _ = _pin(_reply([(0, 2), (1, 2), (2, 3)], [], []), candidates=candidates)
    assert pinned == ["path:Pack/Plate.svg", "path:Pack/Sandwich.svg"]


def test_with_nothing_clear_the_loose_drawings_beat_an_empty_video():
    pinned, _ = _pin(_reply([(0, 1)], [], [(0, 1)]))
    assert pinned == ["path:Pack/Sandwich.svg", "path:Pack/Wall Clock.svg"]


def test_nothing_related_at_all_keeps_each_moments_first_match():
    pinned, _ = _pin(_reply([], [], []))
    assert pinned == ["path:Pack/Sandwich.svg", "path:Pack/Road.svg", "path:Pack/Wall Clock.svg"]


def test_one_bad_entry_skips_only_that_entry():
    # out-of-range moment, out-of-range candidate, score 0, a non-number, a short entry.
    reply = json.dumps([[0, 0, 3], [7, 0, 2], [0, 9, 2], [1, 1, 0], [1, "x", 2], [2, 0]])
    pinned, _ = _pin(reply)
    assert pinned == ["path:Pack/Sandwich.svg"]


def test_a_reply_wrapped_in_commentary_is_still_read():
    # The model often explains itself; stray brackets must not hide the list.
    reply = "Here you go [as requested]: " + _reply([(0, 3)], [], [(0, 2)]) + " Hope this helps!"
    pinned, llm = _pin(reply)
    assert pinned == ["path:Pack/Sandwich.svg", "path:Pack/Wall Clock.svg"]
    assert llm.call_count == 1


# ---- unusable replies


def test_an_unusable_reply_gets_one_retry_restating_the_format():
    pinned, llm = _pin("no json here", _reply([(0, 3)], [], [(0, 2)]))
    assert pinned == ["path:Pack/Sandwich.svg", "path:Pack/Wall Clock.svg"]
    assert llm.call_count == 2
    assert "[moment, candidate_number, score] triples" in llm.call_args_list[1].args[0]


def test_two_unusable_replies_keep_each_moments_first_match():
    pinned, llm = _pin("no json here", "still no json")
    assert llm.call_count == 2
    assert pinned == ["path:Pack/Sandwich.svg", "path:Pack/Road.svg", "path:Pack/Wall Clock.svg"]


def test_a_reply_is_never_judged_by_how_many_moments_it_covers():
    # Counting arrays was the fragile part: models drop or add one. Triples
    # name their moment, so a short reply simply rates fewer moments.
    pinned, llm = _pin(_reply([(0, 3)]))
    assert llm.call_count == 1
    assert pinned == ["path:Pack/Sandwich.svg"]


def test_a_failing_model_call_is_retried_then_falls_back():
    with (
        patch.object(svg_pick.svg_catalog, "is_enabled", return_value=True),
        patch.object(
            svg_pick.svg_catalog,
            "search_candidates",
            side_effect=lambda alternatives: _CANDIDATES[" | ".join(alternatives)],
        ),
        patch.object(svg_pick.llm, "_generate_response_with_fallback", side_effect=RuntimeError("down")) as llm,
    ):
        pinned = svg_pick.pin_relevant("francesinha", "script", list(_CANDIDATES))
    assert llm.call_count == 2
    assert len(pinned) == 3


def test_disabled_catalog_returns_terms_untouched():
    with patch.object(svg_pick.svg_catalog, "is_enabled", return_value=False):
        assert svg_pick.pin_relevant("x", "s", ["a | b"]) == ["a | b"]


def test_pinned_path_parses_back():
    assert svg_pick.pinned_path("path:Pack/Sandwich.svg") == "Pack/Sandwich.svg"
    assert svg_pick.pinned_path("sandwich") is None


# ---- the prompt


def test_each_moment_shows_its_own_topic_to_the_picker():
    # The picker saw only titles per moment and guessed the topic by order:
    # a world map got through for "standing in a queue".
    _, llm = _pin(_reply([(0, 3)], [], [(0, 2)]))
    prompt = llm.call_args.args[0]
    assert "moment 0 (about: francesinha | sandwich):" in prompt
    assert "moment 1 (about: queue | waiting):" in prompt
    assert "moment 2 (about: clock):" in prompt
    assert "Armoured Man" in prompt and "script" in prompt


def test_topics_stay_paired_when_a_moment_has_no_candidates():
    candidates = {**_CANDIDATES, "queue | waiting": []}
    pinned, llm = _pin(_reply([(0, 3)], [(0, 2)]), candidates=candidates)
    prompt = llm.call_args.args[0]
    assert "moment 1 (about: clock):" in prompt
    assert "queue | waiting" not in prompt
    assert pinned == ["path:Pack/Sandwich.svg", "path:Pack/Wall Clock.svg"]


def test_the_prompt_asks_for_flat_triples_not_nested_arrays():
    # Nested arrays failed on real replies: wrong counts, flattened pairs.
    _, llm = _pin(_reply([(0, 3)], [], [(0, 2)]))
    prompt = llm.call_args.args[0]
    assert "json-array of [moment, candidate_number, score] triples" in prompt
    assert "at most 2 per moment" in prompt


def test_the_prompt_defines_the_scores_and_the_limits():
    _, llm = _pin(_reply([(0, 3)], [], [(0, 2)]))
    prompt = llm.call_args.args[0]
    assert "score 3 = exactly what the moment says" in prompt
    assert "2 = clearly shows it" in prompt
    assert "1 = only loosely related" in prompt
    # Metaphors and containers: a road was a queue, a guard at a door was a cafe.
    assert "a metaphor scores 1 at most" in prompt
    assert "a road is not a queue" in prompt
    assert "a generic building, sign, street or book is not the specific place, opinion or story" in prompt
    assert "when in doubt, score lower" in prompt
    assert "a repeated good drawing beats a weak new one" in prompt


# ---- the floor of distinct drawings


def _moments():
    return {
        "t0": [_asset("A0"), _asset("B0")],
        "t1": [_asset("A1"), _asset("B1")],
        "t2": [_asset("A2")],
        "t3": [_asset("A3")],
        "t4": [_asset("A4")],
    }


def _floor_run(reply, candidates, floor, monkeypatch):
    monkeypatch.setattr(svg_pick, "MIN_DRAWINGS", floor)
    pinned, _ = _pin(reply, candidates=candidates)
    return pinned


def test_the_floor_is_eight_distinct_drawings():
    # A strict picker kept 3 drawings for 14 moments and the timeline looped
    # them over a 50s voice; 8 drawings of up to 6s cover a 48s voice. Read
    # from the file: the autouse fixture above patches the live value.
    source = Path(svg_pick.__file__).read_text(encoding="utf-8")
    assert "\nMIN_DRAWINGS = 8\n" in source


def test_loose_drawings_top_the_list_up_in_script_order_until_the_floor(monkeypatch):
    reply = _reply([(0, 3)], [(0, 1)], [(0, 1)], [], [(0, 1)])
    pinned = _floor_run(reply, _moments(), 3, monkeypatch)
    assert pinned == ["path:Pack/A0.svg", "path:Pack/A1.svg", "path:Pack/A2.svg"]


def test_a_drawing_nobody_rated_never_fills_a_gap(monkeypatch):
    # The floor used to take the first match of an empty moment: that is how a
    # guard at a door and a traffic light reached the video.
    reply = _reply([(0, 3)], [], [], [], [])
    pinned = _floor_run(reply, _moments(), 5, monkeypatch)
    assert pinned == ["path:Pack/A0.svg"]


def test_a_picker_that_met_the_floor_gets_nothing_added(monkeypatch):
    reply = _reply([(0, 3)], [(0, 2)], [(0, 2)], [(0, 1)], [(0, 1)])
    pinned = _floor_run(reply, _moments(), 3, monkeypatch)
    assert pinned == ["path:Pack/A0.svg", "path:Pack/A1.svg", "path:Pack/A2.svg"]


def test_a_loose_drawing_already_chosen_is_not_added_twice(monkeypatch):
    moments = _moments()
    moments["t1"] = [_asset("A0"), _asset("B1")]
    reply = _reply([(0, 3)], [(0, 1), (1, 1)], [], [], [])
    pinned = _floor_run(reply, moments, 2, monkeypatch)
    assert pinned == ["path:Pack/A0.svg", "path:Pack/B1.svg"]


def test_a_score_of_zero_never_fills_the_floor(monkeypatch):
    # Score 0 means unrelated: the floor only takes ratings of 1 and up.
    reply = json.dumps([[0, 0, 3], [1, 0, 0], [2, 0, 0]])
    pinned = _floor_run(reply, _moments(), 3, monkeypatch)
    assert pinned == ["path:Pack/A0.svg"]

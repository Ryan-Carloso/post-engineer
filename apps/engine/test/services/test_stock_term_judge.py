"""stock_term_judge: an LLM keeps the stock terms that belong to the video's world.

Counting words shared with the subject and the script was the wrong test for
concrete scenes: "chopped hamburger meat", "melting cheese sauce" and "thick
bread slice" are exactly what a francesinha video films, and none of them
repeats a word of the subject or the script, so the overlap filter dropped 6 of
8 terms and the b-roll dug deep into a few searches. One cheap call asks which
terms show footage that belongs to the video. Terms with abstract or meta words
never reach it (stock_terms.is_filmable), and the word-overlap filter stays as
the fallback when the model cannot be used. Terms the user wrote skip it.
"""

import inspect
from unittest.mock import patch

import pytest

from app.models.schema import VideoParams
from app.services import stock_term_judge, stock_terms
from app.services import task as tm

pytestmark = pytest.mark.real_stock_judge

SUBJECT = "Where to eat the best francesinha in Porto"
SCRIPT = "Locals queue at the small cafe for the sandwich plate."
TERMS = ["francesinha sandwich", "chopped hamburger meat", "melting cheese sauce", "gato selado"]


def _params(**overrides):
    return VideoParams(video_subject=SUBJECT, faceless_material="broll", **overrides)


def _select(replies, terms=TERMS, params=None):
    side_effect = list(replies) if len(replies) > 1 else None
    with patch.object(
        stock_term_judge.llm,
        "_generate_response_with_fallback",
        side_effect=side_effect,
        return_value=replies[0],
    ) as llm:
        return stock_term_judge.select_terms(params or _params(), list(terms), SCRIPT), llm


def test_the_terms_the_judge_lists_are_kept_in_their_original_order():
    kept, llm = _select(["[2, 0]"])
    assert kept == ["francesinha sandwich", "melting cheese sauce"]
    assert llm.call_count == 1


def test_concrete_terms_that_share_no_word_with_the_script_survive():
    # The overlap filter dropped both of these.
    kept, _ = _select(["[0, 1, 2]"])
    assert "chopped hamburger meat" in kept and "melting cheese sauce" in kept
    offline = stock_terms.filter_weak_stock_terms(_params(), TERMS, SCRIPT)
    assert "chopped hamburger meat" not in offline


def test_unfilmable_terms_never_reach_the_judge_or_the_result():
    terms = ["Porto Save Video", "francesinha sandwich", "melting cheese sauce"]
    kept, llm = _select(["[0, 1]"], terms=terms)
    assert "Save Video" not in llm.call_args.args[0]
    assert kept == ["francesinha sandwich", "melting cheese sauce"]


def test_a_judge_that_keeps_nothing_leaves_the_filmable_terms():
    kept, _ = _select(["[]"], terms=["francesinha sandwich", "melting cheese sauce"])
    assert kept == ["francesinha sandwich", "melting cheese sauce"]


def test_out_of_range_and_repeated_entries_are_skipped():
    kept, _ = _select(['[1, 1, 9, "x", -1, 3]'])
    assert kept == ["chopped hamburger meat", "gato selado"]


def test_an_answer_wrapped_in_commentary_is_still_read():
    kept, llm = _select(["Sure [as asked]: [0, 2] Done!"])
    assert kept == ["francesinha sandwich", "melting cheese sauce"]
    assert llm.call_count == 1


def test_an_unusable_answer_is_retried_once():
    kept, llm = _select(["no list", "[0]"])
    assert kept == ["francesinha sandwich"]
    assert llm.call_count == 2


def test_two_unusable_answers_fall_back_to_the_word_overlap_filter():
    kept, llm = _select(["no list", "still no list"], terms=["Porto street", "gato selado"])
    assert llm.call_count == 2
    assert kept == ["Porto street"]


def test_a_failing_model_call_falls_back_without_raising():
    with patch.object(stock_term_judge.llm, "_generate_response_with_fallback", side_effect=RuntimeError("down")):
        kept = stock_term_judge.select_terms(_params(), ["Porto street", "gato selado"], SCRIPT)
    assert kept == ["Porto street"]


def test_terms_the_user_wrote_skip_the_judge():
    params = _params(video_terms="porto street, gato selado")
    kept, llm = _select(["[0]"], terms=["porto street", "gato selado"], params=params)
    llm.assert_not_called()
    assert kept == ["porto street"]


def test_drawing_videos_and_single_terms_are_not_judged():
    drawing = VideoParams(video_subject=SUBJECT, faceless_material="svg")
    with patch.object(stock_term_judge.llm, "_generate_response_with_fallback") as llm:
        assert stock_term_judge.select_terms(drawing, ["a | b", "c | d"], SCRIPT) == ["a | b", "c | d"]
        assert stock_term_judge.select_terms(_params(), ["francesinha sandwich"], SCRIPT) == ["francesinha sandwich"]
    llm.assert_not_called()


def test_the_prompt_carries_the_video_and_numbers_the_terms():
    _, llm = _select(["[0]"])
    prompt = llm.call_args.args[0]
    assert SUBJECT in prompt and SCRIPT in prompt
    assert "0: francesinha sandwich" in prompt and "1: chopped hamburger meat" in prompt
    assert "json-array of the numbers of the terms to keep" in prompt
    assert "belongs to the video's world" in prompt


def test_the_task_filters_its_terms_through_the_judge():
    assert "stock_term_judge.select_terms(params, video_terms, video_script)" in inspect.getsource(tm.generate_terms)

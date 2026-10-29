"""Tests never reach a paid search API or the LLM term judge.

The pre-script fact lookup is deleted (Phase 5 PR 5); what remains here is
the term-filtering guard: task.generate_terms filters stock terms
mechanically, so a test that only patches llm.generate_terms can no
longer spend real tokens on a judge call.
"""

from unittest.mock import patch


def test_term_filtering_never_reaches_the_llm_in_tests():
    # The LLM term judge is gone: task.generate_terms filters stock terms
    # mechanically, so a test that only patches llm.generate_terms can no
    # longer spend real tokens on a judge call.
    from app.models.schema import VideoParams
    from app.services import llm, stock_terms
    from app.services import task as tm

    assert not hasattr(tm, "stock_term_judge")
    params = VideoParams(video_subject="Where to eat the best francesinha in Porto", faceless_material="broll")
    with patch.object(llm, "_generate_response_with_fallback", side_effect=AssertionError("a real LLM call")) as call:
        kept = stock_terms.filter_weak_stock_terms(params, ["Porto street", "gato selado"], "script")
    call.assert_not_called()
    assert kept == ["Porto street"]

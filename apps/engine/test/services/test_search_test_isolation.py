"""Tests never reach a paid search API.

A developer machine has TAVILY_API_KEY / EXA_API_KEY in .env and may have
[search] enabled = true in config.toml; every test that runs generate_script
then made a real search call: credits spent, results varying run to run,
network needed to pass. conftest switches the lookup off for every test; the
web_search_facts tests opt in by patching the section explicitly.
"""

import os
from unittest.mock import patch

from app.services import web_search_facts


def test_search_is_off_for_every_test_even_with_keys_in_the_environment():
    assert web_search_facts._search_section.get("enabled") is False
    with patch.dict(os.environ, {"TAVILY_API_KEY": "k", "EXA_API_KEY": "k"}), patch.object(
        web_search_facts.httpx, "Client", side_effect=AssertionError("a real search was attempted")
    ):
        assert web_search_facts.fetch_facts("any subject", language="en") == []


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

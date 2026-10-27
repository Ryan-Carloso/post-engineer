"""generate_script runs the claims check against the sources it was given."""

from unittest.mock import patch

from app.services import llm

FACTS = [{"text": "Regaleira opened in 1953.", "url": "https://example.com/a"}]


def _generate(replies, facts=FACTS):
    with patch.object(llm, "_generate_response_with_fallback", side_effect=replies) as gen:
        script = llm.generate_script("francesinha in porto", language="en", facts=facts)
    return script, gen


def test_unsupported_name_is_rewritten_once_with_the_note():
    script, gen = _generate(["Go to Casa Bill, open since 1932.", "Go to Regaleira, open since 1953."])
    assert script == "Go to Regaleira, open since 1953."
    assert gen.call_count == 2
    assert "Casa Bill" not in gen.call_args_list[0].kwargs["prompt"]
    assert "Casa Bill" in gen.call_args_list[1].kwargs["prompt"]


def test_search_results_count_as_sources():
    script, gen = _generate(["Go to Regaleira, open since 1953."])
    assert script == "Go to Regaleira, open since 1953."
    assert gen.call_count == 1


def test_without_search_results_there_is_nothing_to_judge_against():
    _, gen = _generate(["Go to Casa Bill since 1932."], facts=[])
    assert gen.call_count == 1


def test_a_provider_error_reply_is_not_checked():
    _, gen = _generate(["Error: all providers down"])
    assert gen.call_count == 1

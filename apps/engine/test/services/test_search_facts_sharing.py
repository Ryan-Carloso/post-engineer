"""One web search per video, shared by the angle and every script call.

The angle used to be written before the search, from the bare topic, so it
invented a place ("Casa Bill, since 1932") that then overrode the search
results inside the script prompt. The task now searches once, up front, and
hands the same results to the angle prompt and to every generate_script call
(main script, regenerated hook, regenerated body): one search, no invented
names, no repeated paid calls.
"""

from unittest.mock import patch

from app.models.schema import VideoParams
from app.services import llm, script_angle
from app.services import task as tm
from test.services.test_script_angle_cta import _persona_params

FACTS = [
    {"text": "Café Santiago serves a classic francesinha.", "url": "https://example.com/a"},
    {"text": "Regaleira has served it since the 1950s.", "url": "https://example.com/b"},
]


def test_script_step_searches_once_and_shares_the_results():
    params = VideoParams(video_subject="francesinha in porto", video_script="", video_language="en-US")
    with (
        patch.object(tm.web_search_facts, "fetch_facts", return_value=FACTS) as fetch,
        patch.object(tm.llm, "generate_script_angle", return_value="an angle") as angle,
        patch.object(tm.llm, "generate_script", return_value="A script.") as generate,
    ):
        tm.generate_script("share-task", params)

    fetch.assert_called_once_with("francesinha in porto", language="en-US")
    assert angle.call_args.kwargs["facts"] == FACTS
    assert generate.call_args.kwargs["facts"] == FACTS


def test_regenerated_hook_and_body_reuse_the_same_search():
    params = _persona_params()
    with (
        patch.object(tm.web_search_facts, "fetch_facts", return_value=FACTS) as fetch,
        patch.object(tm.llm, "generate_script_angle", return_value="an angle"),
        patch.object(
            tm.llm,
            "generate_script",
            side_effect=["One paragraph only.", "Hook is complete.", "Details follow."],
        ) as generate,
    ):
        tm.generate_script("share-persona-task", params)

    assert fetch.call_count == 1
    assert [c.kwargs["facts"] for c in generate.call_args_list] == [FACTS] * 3


def test_an_empty_search_is_still_shared_so_nobody_searches_again():
    params = VideoParams(video_subject="coffee", video_script="")
    with (
        patch.object(tm.web_search_facts, "fetch_facts", return_value=[]),
        patch.object(tm.llm, "generate_script_angle", return_value="an angle") as angle,
        patch.object(tm.llm, "generate_script", return_value="A script.") as generate,
    ):
        tm.generate_script("share-empty-task", params)

    assert angle.call_args.kwargs["facts"] == []
    assert generate.call_args.kwargs["facts"] == []


def test_a_ready_script_needs_no_search():
    params = VideoParams(video_subject="coffee", video_script="My own script.")
    with (
        patch.object(tm.web_search_facts, "fetch_facts") as fetch,
        patch.object(tm.llm, "generate_script") as generate,
    ):
        tm.generate_script("share-ready-task", params)

    fetch.assert_not_called()
    generate.assert_not_called()


def test_generate_script_given_facts_does_not_search_again():
    with (
        patch.object(llm, "_generate_response_with_fallback", return_value="clean script") as gen,
        patch.object(llm.web_search_facts, "fetch_facts") as fetch,
    ):
        llm.generate_script(video_subject="coffee", language="en", facts=FACTS)
        llm.generate_script(video_subject="coffee", language="en", facts=[])

    fetch.assert_not_called()
    assert "Café Santiago serves a classic francesinha." in gen.call_args_list[0].kwargs["prompt"]


def test_generate_script_without_facts_searches_for_itself():
    # Direct callers (the /scripts endpoint) pass no facts and keep working.
    with (
        patch.object(llm, "_generate_response_with_fallback", return_value="clean script"),
        patch.object(llm.web_search_facts, "fetch_facts", return_value=[]) as fetch,
    ):
        llm.generate_script(video_subject="coffee", language="en")

    fetch.assert_called_once_with("coffee", language="en")


def test_angle_prompt_carries_the_search_results():
    with patch.object(llm, "_generate_response_with_fallback", return_value="an angle") as gen:
        script_angle.generate_script_angle("francesinha in porto", facts=FACTS)

    prompt = gen.call_args.kwargs["prompt"]
    assert "Web search results" in prompt
    assert "Café Santiago serves a classic francesinha. (source: https://example.com/a)" in prompt
    assert "never invent" in prompt


def test_angle_prompt_without_facts_has_no_results_block():
    with patch.object(llm, "_generate_response_with_fallback", return_value="an angle") as gen:
        script_angle.generate_script_angle("francesinha in porto")

    assert "Web search results" not in gen.call_args.kwargs["prompt"]

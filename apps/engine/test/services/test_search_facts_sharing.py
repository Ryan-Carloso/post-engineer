"""No task-level web search for scripts anymore (Phase 5, PR 1).

The task pipeline used to search once per video and share the results
between the script angle and every script call. That whole path is gone:
generate_script takes the supplied script as-is and never searches, and
the angle is gone. What remains here is the direct llm.generate_script
contract used by the /scripts endpoint (kept until Phase 5 PR 5): callers
that pass facts reuse them, callers that pass none trigger one search.
"""

from unittest.mock import patch

from app.models.schema import VideoParams
from app.services import llm
from app.services import task as tm
from app.services import web_search_facts

FACTS = [
    {"text": "Café Santiago serves a classic francesinha.", "url": "https://example.com/a"},
    {"text": "Regaleira has served it since the 1950s.", "url": "https://example.com/b"},
]


def test_a_ready_script_needs_no_search_and_no_llm():
    params = VideoParams(video_subject="coffee", video_script="My own script.")
    with (
        patch.object(web_search_facts, "fetch_facts") as fetch,
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

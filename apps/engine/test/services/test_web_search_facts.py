"""
Tests for the pre-script web fact lookup (Tavily primary, Exa fallback).

The fact lookup is optional: a [search] section in config.toml turns it on,
and API keys come from the environment (TAVILY_API_KEY / EXA_API_KEY).
Providers are tried in configured order; a provider without a key or one
that errors is skipped and the next one runs. When everything fails the
video still ships without facts — fetch_facts returns [].
"""

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import web_search_facts  # noqa: E402


class _FakeResponse:
    """Minimal stand-in for an httpx.Response at the boundary."""

    def __init__(self, payload: object, status_code: int) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> object:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"http {self.status_code}")


class _FakeClient:
    """Records requests and replays canned responses."""

    def __init__(self, responses: list[_FakeResponse | Exception]) -> None:
        self._responses = list(responses)
        self.calls: list[dict[str, object]] = []

    def post(self, url: str, json: dict[str, object], headers: dict[str, str]) -> _FakeResponse:
        self.calls.append({"url": url, "json": json, "headers": headers})
        outcome = self._responses.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


TAVILY_SUCCESS = _FakeResponse(
    {
        "results": [
            {
                "title": "Best francesinha in Porto",
                "url": "https://example.com/porto-1",
                "content": "Café Santiago serves the classic francesinha for about 11 euros.",
            },
            {
                "title": "Where to eat",
                "url": "https://example.com/porto-2",
                "content": "Francesinha Columbus opens at 12:00 on Rua de Ceuta.",
            },
        ]
    },
    200,
)

EXA_SUCCESS = _FakeResponse(
    {
        "results": [
            {
                "title": "Francesinha guide",
                "url": "https://example.org/guide",
                "text": "A costa francesinha costs around 10 euros in central Porto.",
            }
        ]
    },
    200,
)

_ENABLED_BOTH = {"providers": ["tavily", "exa"], "enabled": True}


class FetchFactsTest(unittest.TestCase):
    def setUp(self) -> None:
        self._env_backup = {
            key: os.environ.get(key)
            for key in ("TAVILY_API_KEY", "EXA_API_KEY", "ENGINE_UNDER_TEST")
        }

    def tearDown(self) -> None:
        for key, value in self._env_backup.items():
            if value is None:
                os.environ.pop(key, None)
                continue
            os.environ[key] = value

    #---------------
    # Success paths: each provider pinned once through the shared Fact shape.
    #---------------
    def test_tavily_returns_facts_from_results(self):
        client = _FakeClient([TAVILY_SUCCESS])
        with patch.dict(os.environ, {"TAVILY_API_KEY": "tvly-test-key"}), patch.object(
            web_search_facts, "_search_section", _ENABLED_BOTH
        ):
            facts = web_search_facts.fetch_facts(
                "best francesinha Porto", "pt", client=client
            )

        self.assertEqual(len(facts), 2)
        self.assertEqual(facts[0]["url"], "https://example.com/porto-1")
        self.assertIn("Café Santiago", facts[0]["text"])

    def test_provider_without_key_is_skipped(self):
        client = _FakeClient([EXA_SUCCESS])
        with patch.dict(os.environ, {"EXA_API_KEY": "exa-test-key"}), patch.object(
            web_search_facts, "_search_section", _ENABLED_BOTH
        ):
            facts = web_search_facts.fetch_facts(
                "best francesinha Porto", "pt", client=client
            )

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0]["url"], "https://example.org/guide")

    def test_erroring_provider_falls_back_to_next(self):
        client = _FakeClient([RuntimeError("boom"), EXA_SUCCESS])
        with patch.dict(
            os.environ,
            {"TAVILY_API_KEY": "tvly-test-key", "EXA_API_KEY": "exa-test-key"},
        ), patch.object(
            web_search_facts, "_search_section", _ENABLED_BOTH
        ):
            facts = web_search_facts.fetch_facts(
                "best francesinha Porto", "pt", client=client
            )

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0]["url"], "https://example.org/guide")

    def test_second_provider_is_not_called_when_the_first_returns_facts(self):
        # One provider answers: fewer than max_facts results is still an
        # answer, and topping up from the next provider would mix sources
        # and spend a second search per video.
        client = _FakeClient([TAVILY_SUCCESS, EXA_SUCCESS])
        keys = {"TAVILY_API_KEY": "tvly-test-key", "EXA_API_KEY": "exa-test-key"}
        with patch.dict(os.environ, keys), patch.object(
            web_search_facts, "_search_section", _ENABLED_BOTH
        ):
            facts = web_search_facts.fetch_facts("best francesinha Porto", "pt", client=client)

        self.assertEqual(len(client.calls), 1)
        self.assertEqual(client.calls[0]["url"], web_search_facts.TAVILY_SEARCH_URL)
        self.assertEqual(
            [fact["url"] for fact in facts],
            ["https://example.com/porto-1", "https://example.com/porto-2"],
        )

    def test_provider_with_no_results_falls_back_to_next(self):
        client = _FakeClient([_FakeResponse({"results": []}, 200), EXA_SUCCESS])
        keys = {"TAVILY_API_KEY": "tvly-test-key", "EXA_API_KEY": "exa-test-key"}
        with patch.dict(os.environ, keys), patch.object(
            web_search_facts, "_search_section", _ENABLED_BOTH
        ):
            facts = web_search_facts.fetch_facts("best francesinha Porto", "pt", client=client)

        self.assertEqual(len(client.calls), 2)
        self.assertEqual(client.calls[1]["url"], web_search_facts.EXA_SEARCH_URL)
        self.assertEqual([fact["url"] for fact in facts], ["https://example.org/guide"])

    def test_the_winning_provider_and_result_count_are_logged_without_content(self):
        from loguru import logger

        messages: list[str] = []
        sink = logger.add(messages.append, level="INFO")
        client = _FakeClient([TAVILY_SUCCESS])
        try:
            with patch.dict(os.environ, {"TAVILY_API_KEY": "tvly-test-key"}), patch.object(
                web_search_facts, "_search_section", _ENABLED_BOTH
            ):
                web_search_facts.fetch_facts("best francesinha Porto", "pt", client=client)
        finally:
            logger.remove(sink)

        logged = "".join(messages)
        self.assertIn("web search: 2 results from tavily", logged)
        self.assertNotIn("Café Santiago", logged)

    def test_all_providers_failing_returns_empty_list(self):
        client = _FakeClient([RuntimeError("boom"), RuntimeError("boom")])
        with patch.dict(
            os.environ,
            {"TAVILY_API_KEY": "tvly-test-key", "EXA_API_KEY": "exa-test-key"},
        ), patch.object(
            web_search_facts, "_search_section", _ENABLED_BOTH
        ):
            facts = web_search_facts.fetch_facts(
                "best francesinha Porto", "pt", client=client
            )

        self.assertEqual(facts, [])

    def test_disabled_search_returns_empty_without_requests(self):
        client = _FakeClient([])
        with patch.object(
            web_search_facts, "_search_section", {"providers": ["tavily"], "enabled": False}
        ):
            facts = web_search_facts.fetch_facts(
                "best francesinha Porto", "pt", client=client
            )

        self.assertEqual(facts, [])
        self.assertEqual(client.calls, [])

    def test_unknown_provider_name_is_skipped(self):
        client = _FakeClient([])
        with patch.object(
            web_search_facts, "_search_section", {"providers": ["serper"], "enabled": True}
        ):
            facts = web_search_facts.fetch_facts(
                "best francesinha Porto", "pt", client=client
            )

        self.assertEqual(facts, [])
        self.assertEqual(client.calls, [])

    def test_facts_are_capped_at_five(self):
        many_results = _FakeResponse(
            {
                "results": [
                    {
                        "title": f"n{i}",
                        "url": f"https://example.com/{i}",
                        "content": f"fact {i}",
                    }
                    for i in range(8)
                ]
            },
            200,
        )
        client = _FakeClient([many_results])
        with patch.dict(os.environ, {"TAVILY_API_KEY": "tvly-test-key"}), patch.object(
            web_search_facts, "_search_section", {"providers": ["tavily"], "enabled": True}
        ):
            facts = web_search_facts.fetch_facts(
                "best francesinha Porto", "pt", client=client
            )

        self.assertEqual(len(facts), 5)

    #---------------
    # Request shapes: one test pins one provider endpoint.
    #---------------
    def test_tavily_request_carries_auth_and_params(self):
        client = _FakeClient([TAVILY_SUCCESS])
        with patch.dict(os.environ, {"TAVILY_API_KEY": "tvly-test-key"}), patch.object(
            web_search_facts, "_search_section", {"providers": ["tavily"], "enabled": True}
        ):
            web_search_facts.fetch_facts(
                "best francesinha Porto", "pt", client=client
            )

        call = client.calls[0]
        assert call["url"] == "https://api.tavily.com/search"
        headers = call["headers"]
        assert isinstance(headers, dict)
        assert headers["Authorization"] == "Bearer tvly-test-key"
        assert call["json"]["query"] == "best francesinha Porto"
        assert call["json"]["max_results"] == 5

    def test_country_boost_is_sent_when_provided(self):
        client = _FakeClient([TAVILY_SUCCESS])
        with patch.dict(os.environ, {"TAVILY_API_KEY": "tvly-test-key"}), patch.object(
            web_search_facts, "_search_section", {"providers": ["tavily"], "enabled": True}
        ):
            web_search_facts.fetch_facts(
                "best francesinha Porto", "pt", country="portugal", client=client
            )

        call = client.calls[0]
        assert call["json"]["country"] == "portugal"
        assert call["json"]["language"] == "pt"

    def test_empty_country_is_not_sent(self):
        client = _FakeClient([TAVILY_SUCCESS])
        with patch.dict(os.environ, {"TAVILY_API_KEY": "tvly-test-key"}), patch.object(
            web_search_facts, "_search_section", {"providers": ["tavily"], "enabled": True}
        ):
            web_search_facts.fetch_facts(
                "best francesinha Porto", "pt", client=client
            )

        call = client.calls[0]
        assert "country" not in call["json"]

    def test_exa_request_shape(self):
        client = _FakeClient([EXA_SUCCESS])
        with patch.dict(os.environ, {"EXA_API_KEY": "exa-test-key"}), patch.object(
            web_search_facts, "_search_section", {"providers": ["exa"], "enabled": True}
        ):
            facts = web_search_facts.fetch_facts(
                "best francesinha Porto", "pt", client=client
            )

        call = client.calls[0]
        assert call["url"] == "https://api.exa.ai/search"
        assert call["json"]["numResults"] == 5
        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0]["url"], "https://example.org/guide")


class ValidateConfigTest(unittest.TestCase):
    def test_enabled_with_no_keys_raises(self):
        with patch.object(
            web_search_facts,
            "_search_section",
            {"providers": ["tavily", "exa"], "enabled": True},
        ), patch.dict(os.environ, {}, clear=False):
            os.environ.pop("TAVILY_API_KEY", None)
            os.environ.pop("EXA_API_KEY", None)
            with self.assertRaises(ValueError):
                web_search_facts.validate_config()

    def test_enabled_with_at_least_one_key_passes(self):
        with patch.object(
            web_search_facts, "_search_section", {"providers": ["tavily"], "enabled": True}
        ), patch.dict(os.environ, {"TAVILY_API_KEY": "tvly-test-key"}):
            web_search_facts.validate_config()  # must not raise

    def test_disabled_without_keys_passes(self):
        with patch.object(
            web_search_facts, "_search_section", {"providers": ["tavily"], "enabled": False}
        ):
            web_search_facts.validate_config()  # must not raise


if __name__ == "__main__":
    unittest.main()

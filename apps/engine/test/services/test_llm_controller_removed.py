"""Phase 5 PR 5: the LLM controller is gone, the search module is trimmed
to its place-photos client, and the controller's schema models are gone.

The prompt-constant modules (script_prompts, script_language_rules) are
deliberately KEPT here: llm.py still imports them at module level and
task.py still imports llm for generate_terms (the live broll path, blocked
on decision D1). They die with llm.py in P5-6, not here.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models import schema  # noqa: E402
from app.router import root_api_router  # noqa: E402
from app.services import place_photos, web_search_facts  # noqa: E402

DELETED_ROUTES = {"/api/v1/scripts", "/api/v1/terms", "/api/v1/social-metadata"}
DELETED_MODELS = (
    "VideoScriptRequest",
    "VideoScriptResponse",
    "VideoTermsRequest",
    "VideoTermsResponse",
    "VideoSocialMetadataRequest",
    "VideoSocialMetadataResponse",
)


class LlmControllerRemovedTests(unittest.TestCase):
    def test_controller_module_is_gone(self):
        with self.assertRaises(ModuleNotFoundError):
            import app.controllers.v1.llm  # noqa: F401

    def test_router_has_no_llm_routes(self):
        paths = {route.path for route in root_api_router.routes}
        self.assertTrue(DELETED_ROUTES.isdisjoint(paths))

    def test_controller_schema_models_are_gone(self):
        for name in DELETED_MODELS:
            self.assertFalse(hasattr(schema, name), name)


class SearchTrimmedToPlacePhotosTests(unittest.TestCase):
    def test_fact_functions_are_gone(self):
        self.assertFalse(hasattr(web_search_facts, "fetch_facts"))
        self.assertFalse(hasattr(web_search_facts, "format_facts_block"))
        self.assertFalse(hasattr(web_search_facts, "Fact"))

    def test_place_photos_client_surface_is_intact(self):
        self.assertTrue(hasattr(web_search_facts, "_HttpPostClient"))
        self.assertTrue(hasattr(web_search_facts, "_build_client"))
        self.assertIn("tavily", web_search_facts.PROVIDER_ENV_KEYS)
        self.assertEqual(
            web_search_facts.TAVILY_SEARCH_URL, "https://api.tavily.com/search"
        )
        self.assertTrue(callable(web_search_facts.place_photos_enabled))
        self.assertTrue(callable(web_search_facts.validate_config))
        # The test conftest switches search off, so place photos stay off.
        self.assertIs(web_search_facts.place_photos_enabled(), False)

    def test_place_photos_search_still_uses_the_trimmed_client(self):
        # search_images builds its Tavily request through the trimmed module.
        calls = []

        class StubResponse:
            def raise_for_status(self):
                return None

            def json(self):
                return {"images": ["https://e.com/santiago.jpg"]}

        class StubClient:
            def post(self, url, json, headers):
                calls.append(url)
                return StubResponse()

        hits = place_photos.search_images(
            "Café Santiago", "francesinha Porto", client=StubClient()
        )
        self.assertEqual(calls, [web_search_facts.TAVILY_SEARCH_URL])
        self.assertTrue(any("santiago.jpg" in hit.get("url", "") for hit in hits))


class PromptBuilderSurvivesSearchTrimTests(unittest.TestCase):
    def test_build_script_prompt_needs_no_search_facts(self):
        # Main added test_script_prompt_cta.py after P5-5 branched: it calls
        # build_script_prompt, which used to append a web-search facts block.
        # The facts feature is deleted in P5-5, so the builder must work
        # with no facts and no search module reference.
        from app.services import llm

        prompt = llm.build_script_prompt(video_subject="café", facts=None)
        assert "1. hook: the very first sentence." in prompt

    def test_generate_script_with_no_facts_searches_nothing(self):
        # facts=None used to trigger a live web search; in P5-5 it must
        # mean "no facts". Patching the provider proves the None branch is
        # taken (any search attempt would raise AttributeError: the search
        # functions are deleted) and covers the branch for codecov/patch.
        from unittest.mock import patch

        from app.services import llm

        with patch.object(
            llm,
            "_generate_response_with_fallback",
            return_value="Hook sentence.\n\nBody sentence.",
        ) as generate:
            script = llm.generate_script(
                video_subject="café", language="en", facts=None
            )
        generate.assert_called_once()
        assert "Hook sentence." in script


class PromptConstantsKeptUntilCoreDeletionTests(unittest.TestCase):
    def test_script_prompt_modules_still_importable_for_llm_core(self):
        # P5-6 deletes these with llm.py; deleting them here would break
        # `import task` (task imports llm, llm imports these at module level).
        from app.services import script_language_rules, script_prompts

        self.assertTrue(script_prompts.DEFAULT_SCRIPT_SYSTEM_PROMPT)
        self.assertTrue(callable(script_language_rules._uses_latin_script))

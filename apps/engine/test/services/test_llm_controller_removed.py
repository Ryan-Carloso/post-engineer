"""Phase 5 PR 5: the LLM controller is gone, the search module is trimmed
to its place-photos client, and the controller's schema models are gone.

Phase 5 PR 6: the LLM core itself is gone — llm.py, llm_providers.py,
script_prompts.py and script_language_rules.py are deleted, and task.py
no longer imports llm: broll terms come from the calling agent or from
the mechanical terms_fallback expansion of the script itself.
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


class LlmCoreDeletedTests(unittest.TestCase):
    def test_llm_core_modules_are_gone(self):
        # P5-6 deletes the core with its prompt-constant modules: importing
        # any of them must fail, and task.py must not carry an llm attr.
        from app.services import task as tm

        for module in (
            "app.services.llm",
            "app.services.llm_providers",
            "app.services.script_prompts",
            "app.services.script_language_rules",
        ):
            with self.assertRaises(ModuleNotFoundError):
                __import__(module)
        self.assertFalse(hasattr(tm, "llm"))

    def test_task_still_serves_the_live_videos_pipeline(self):
        # Deleting the core must not take the live pipeline with it:
        # POST /videos stays, and generate_terms is mechanical.
        from app.controllers.v1 import video as video_controller
        from app.services import task as tm, terms_fallback

        paths = {
            (getattr(route, "path", None), method)
            for route in video_controller.router.routes
            for method in (getattr(route, "methods", None) or set())
        }
        self.assertIn(("/api/v1/videos", "POST"), paths)
        self.assertTrue(callable(tm.generate_terms))
        self.assertTrue(callable(terms_fallback.expand_terms))

"""Phase 5 PR 5: the LLM controller is gone, and the controller's schema
models are gone.

Phase 5 PR 6: the LLM core itself is gone — llm.py, llm_providers.py,
script_prompts.py and script_language_rules.py are deleted, and task.py
no longer imports llm: scripts arrive as segments from the calling agent.

Issue #542: the search module and its place-photos client are gone too.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models import schema  # noqa: E402
from app.router import root_api_router  # noqa: E402

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
        # POST /videos stays, and scripts arrive as segments.
        from app.controllers.v1 import video as video_controller

        paths = {
            (getattr(route, "path", None), method)
            for route in video_controller.router.routes
            for method in (getattr(route, "methods", None) or set())
        }
        self.assertIn(("/api/v1/videos", "POST"), paths)

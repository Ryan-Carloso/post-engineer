"""Mechanical social metadata for the YouTube cross-post path (Phase 5).

No LLM is involved: the title is the video subject, the caption is
empty and there are no hashtags. The cross-post caller in task.py uses
this instead of ``llm.generate_social_metadata`` so the engine can
drop the LLM core without touching the cross-post flow again.
"""

import ast
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import social_metadata


def _llm_imports_in_source(source: str) -> list[str]:
    """Return every import in `source` that pulls in the LLM core.

    Both import forms count: `import app.services.llm` (alias name) and
    `from app.services import llm` (alias name with a neutral module).
    Checking only the module misses the second form, which is the form
    task.py itself uses.
    """
    tree = ast.parse(source)
    offenders = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            offenders.extend(alias.name for alias in node.names if "llm" in alias.name)
        elif isinstance(node, ast.ImportFrom):
            if node.module and "llm" in node.module:
                offenders.append(node.module)
            offenders.extend(alias.name for alias in node.names if "llm" in alias.name)
    return offenders


class MechanicalSocialMetadataTests(unittest.TestCase):
    def test_subject_becomes_title_with_empty_caption_and_hashtags(self):
        self.assertEqual(
            social_metadata.mechanical_social_metadata(video_subject="Lisbon trams"),
            {"title": "Lisbon trams", "caption": "", "hashtags": []},
        )

    def test_subject_is_stripped(self):
        result = social_metadata.mechanical_social_metadata(video_subject="  Lisbon trams  ")
        self.assertEqual(result["title"], "Lisbon trams")

    def test_empty_subject_uses_generic_fallback(self):
        # The schema allows an empty subject, and the upload service
        # sends youtube_title verbatim: the helper must never return an
        # empty title. The fallback is the fixed generic string, not
        # the first script sentence the old LLM fallback used.
        result = social_metadata.mechanical_social_metadata(video_subject="")
        self.assertEqual(
            result,
            {
                "title": "Check out this video! #shorts #viral",
                "caption": "",
                "hashtags": [],
            },
        )

    def test_whitespace_only_subject_uses_generic_fallback(self):
        result = social_metadata.mechanical_social_metadata(video_subject="   ")
        self.assertEqual(result["title"], "Check out this video! #shorts #viral")

    def test_each_call_returns_fresh_containers(self):
        first = social_metadata.mechanical_social_metadata(video_subject="Lisbon trams")
        first["hashtags"].append("#mutated")
        second = social_metadata.mechanical_social_metadata(video_subject="Lisbon trams")
        self.assertEqual(second["hashtags"], [])

    def test_module_never_imports_the_llm_core(self):
        # The whole point of the move: deleting llm.py later must not
        # touch this module. Pin the import list, not just behaviour.
        src = Path(social_metadata.__file__).read_text()
        self.assertEqual(_llm_imports_in_source(src), [])


class LlmImportScanTests(unittest.TestCase):
    # Regression tests for the OpenCode MINOR on this PR: the first
    # version of the pin inspected only ImportFrom.module, so
    # `from app.services import llm` — the form task.py itself used
    # before Phase 5 PR 6 deleted the LLM core — passed the pin while
    # importing the LLM core.

    def test_from_package_import_llm_is_flagged(self):
        offenders = _llm_imports_in_source("from app.services import llm\n")
        self.assertEqual(offenders, ["llm"])

    def test_plain_import_llm_is_flagged(self):
        offenders = _llm_imports_in_source("import app.services.llm\n")
        self.assertEqual(offenders, ["app.services.llm"])

    def test_relative_import_llm_is_flagged(self):
        offenders = _llm_imports_in_source("from . import llm\n")
        self.assertEqual(offenders, ["llm"])

    def test_unrelated_imports_are_clean(self):
        src = "from app.services import social_metadata\nimport os\n"
        self.assertEqual(_llm_imports_in_source(src), [])

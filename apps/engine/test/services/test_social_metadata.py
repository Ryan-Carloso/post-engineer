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
        tree = ast.parse(Path(social_metadata.__file__).read_text())
        llm_imports = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                llm_imports.extend(alias.name for alias in node.names if "llm" in alias.name)
            elif isinstance(node, ast.ImportFrom) and node.module:
                if "llm" in node.module:
                    llm_imports.append(node.module)
        self.assertEqual(llm_imports, [])

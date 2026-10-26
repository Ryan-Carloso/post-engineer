"""A lip-sync post honours the material choice like a faceless one.

The persona face (lip-sync intro) and the background material are
independent: get_video_materials is the single material path, so a
with-face "svg" post must query the catalog only, never stock.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models.schema import PersonaParams, VideoParams
from app.services import task as tm


def _lipsync_params(material):
    return VideoParams(
        video_subject="x",
        faceless_material=material,
        lipsync_enabled=True,
        persona=PersonaParams(avatar_url="https://example.com/a.png", voice_id="calm"),
    )


class LipsyncMaterialTests(unittest.TestCase):
    def _source_mix(self, params):
        self.assertTrue(tm.persona_lipsync_active(params))
        with patch.object(tm.material, "download_videos", return_value=["c.mp4"]) as dv:
            tm.get_video_materials(task_id="t", params=params, video_terms=["x"], audio_duration=10)
        return dv.call_args.kwargs.get("source_mix")

    def test_lipsync_svg_post_queries_catalog_only(self):
        self.assertEqual(self._source_mix(_lipsync_params("svg")), ["svg"])

    def test_lipsync_broll_post_queries_stock_only(self):
        self.assertEqual(sorted(self._source_mix(_lipsync_params("broll"))), ["coverr", "pexels", "pixabay"])


if __name__ == "__main__":
    unittest.main()

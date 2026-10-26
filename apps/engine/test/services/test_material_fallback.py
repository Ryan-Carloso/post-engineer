import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models.schema import MaterialInfo, VideoAspect
from app.services import material_fallback


def _item(provider, url="https://v.example/x.mp4"):
    item = MaterialInfo(provider=provider, url=url, duration=3)
    return item


def _fake_resolve(failure):
    def resolve(item, save_dir, max_clip_duration, exclude_faces, video_aspect):
        if item.provider == "neutral":
            return "/tmp/neutral.mp4"
        return failure()

    return resolve


class TestResolveWithNeutralFallback(unittest.TestCase):
    def _run(self, item, failure, verification_enabled):
        with patch.object(
            material_fallback.svg_material,
            "resolve_material_path",
            side_effect=_fake_resolve(failure),
        ):
            return material_fallback.resolve_with_neutral_fallback(
                item, "", 3, None, VideoAspect.portrait, verification_enabled
            )

    def test_render_empty_degrades_to_neutral_when_verification_on(self):
        result = self._run(_item("svg", "Traveler eating local food.svg"), lambda: "", True)
        self.assertEqual(result, "/tmp/neutral.mp4")

    def test_missing_asset_degrades_to_neutral_when_verification_on(self):
        def raise_missing():
            raise FileNotFoundError("Traveler eating local food.svg")

        result = self._run(_item("svg", "Traveler eating local food.svg"), raise_missing, True)
        self.assertEqual(result, "/tmp/neutral.mp4")

    def test_failed_stock_degrades_to_neutral_when_verification_on(self):
        result = self._run(_item("pexels"), lambda: "", True)
        self.assertEqual(result, "/tmp/neutral.mp4")

    def test_no_neutral_retry_when_verification_off(self):
        result = self._run(_item("svg", "Traveler eating local food.svg"), lambda: "", False)
        self.assertEqual(result, "")

    def test_neutral_item_is_never_retried(self):
        calls = []

        def resolve(item, save_dir, max_clip_duration, exclude_faces, video_aspect):
            calls.append(item.provider)
            return ""

        with patch.object(
            material_fallback.svg_material, "resolve_material_path", side_effect=resolve
        ):
            result = material_fallback.resolve_with_neutral_fallback(
                _item("neutral", ""), "", 3, None, VideoAspect.portrait, True
            )
        self.assertEqual(result, "")
        self.assertEqual(calls, ["neutral"])

    def test_neutral_retry_failure_returns_empty_path(self):
        """The neutral path never raises in production: render_neutral_clip
        logs a warning and returns "", so the helper returns "" and the
        caller skips the segment."""

        def resolve(item, save_dir, max_clip_duration, exclude_faces, video_aspect):
            return ""

        with patch.object(
            material_fallback.svg_material, "resolve_material_path", side_effect=resolve
        ):
            result = material_fallback.resolve_with_neutral_fallback(
                _item("svg", "Traveler eating local food.svg"),
                "",
                3,
                None,
                VideoAspect.portrait,
                True,
            )
        self.assertEqual(result, "")

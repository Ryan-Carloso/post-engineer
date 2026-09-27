"""Tests for subtitle font resolution and the missing-font fallback."""

from unittest.mock import patch

import pytest

from app.services import video
from app.services.video import DEFAULT_SUBTITLE_FONT, _resolve_font_path


class TestResolveFontPath:
    def test_default_font_missing_raises(self):
        # No font is bundled with the repo (resource/fonts/ is gitignored):
        # resolving the default name fails loudly instead of rendering
        # without a font.
        with pytest.raises(ValueError):
            _resolve_font_path(DEFAULT_SUBTITLE_FONT)

    def test_rejects_traversal(self):
        with pytest.raises(ValueError):
            _resolve_font_path("../escape.ttf")

    def test_rejects_missing_font(self):
        with pytest.raises(ValueError):
            _resolve_font_path("definitely-not-a-real-font.ttf")


class TestMissingFontFallback:
    """Legacy configs may reference deleted proprietary fonts (e.g. the
    old STHeitiMedium.ttc default). Rendering must fall back to the
    bundled default instead of failing every subtitled render."""

    def test_falls_back_to_default_font(self):
        default_path = "/fonts/" + DEFAULT_SUBTITLE_FONT

        def fake_resolve(font_name: str) -> str:
            if font_name == DEFAULT_SUBTITLE_FONT:
                return default_path
            raise ValueError("file does not exist")

        with patch.object(video, "_resolve_font_path", side_effect=fake_resolve):
            params = video.VideoParams(
                video_subject="test",
                font_name="STHeitiMedium.ttc",
                subtitle_enabled=True,
            )
            font_path = video._resolve_font_with_fallback(params)
            assert font_path == default_path
            assert params.font_name == DEFAULT_SUBTITLE_FONT

    def test_raises_when_default_font_also_missing(self):
        with patch.object(
            video, "_resolve_font_path", side_effect=ValueError("file does not exist")
        ):
            params = video.VideoParams(
                video_subject="test",
                font_name="STHeitiMedium.ttc",
                subtitle_enabled=True,
            )
            with pytest.raises(ValueError):
                video._resolve_font_with_fallback(params)

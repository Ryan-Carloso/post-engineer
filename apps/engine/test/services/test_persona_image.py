"""is_engine_usable_persona_image_url: the filler photo gate's shape check.

The web pre-flights the same shapes before any token charge
(isEngineUsablePersonaImageUrl); the engine re-checks everything at
download time, so this helper exists only so a bad stored avatar_url
fails fast in the batch filler — inside the refund block — instead of
dying mid-pipeline ("persona image download rejected").
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.persona_image import is_engine_usable_persona_image_url


class EngineUsablePersonaImageUrlTests(unittest.TestCase):
    def test_accepts_public_http_urls(self):
        for url in (
            "https://example.com/photo.png",
            "http://example.com/photo.png",
            "https://8.8.8.8/photo.png",
            "  https://example.com/photo.png  ",
        ):
            self.assertTrue(is_engine_usable_persona_image_url(url), url)

    def test_accepts_data_image_uris_with_a_payload_separator(self):
        self.assertTrue(
            is_engine_usable_persona_image_url("data:image/png;base64,AAA")
        )

    def test_accepts_house_face_paths_the_engine_resolves(self):
        self.assertTrue(
            is_engine_usable_persona_image_url("/caracter-samples/file-1.png")
        )

    def test_rejects_relative_and_host_changing_paths(self):
        for url in (
            "not-a-url",
            "relative/path.png",
            "/other/path.png",
            "//host/x.png",
            "/\\host\\x.png",
        ):
            self.assertFalse(is_engine_usable_persona_image_url(url), url)

    def test_rejects_data_uris_without_a_payload_separator(self):
        self.assertFalse(
            is_engine_usable_persona_image_url("data:image/png;base64")
        )

    def test_rejects_non_http_schemes_and_host_less_urls(self):
        for url in (
            "",
            "   ",
            "ftp://example.com/photo.png",
            "https://",
            "https://?x=1",
        ):
            self.assertFalse(is_engine_usable_persona_image_url(url), url)

    def test_rejects_literal_private_and_loopback_ip_hosts(self):
        for url in (
            "https://127.0.0.1/photo.png",
            "https://10.0.0.1/photo.png",
            "https://192.168.1.1/photo.png",
            "https://[::1]/photo.png",
        ):
            self.assertFalse(is_engine_usable_persona_image_url(url), url)


if __name__ == "__main__":
    unittest.main()

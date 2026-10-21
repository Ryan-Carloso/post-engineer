"""Tests for the shared stock-video downloader (app/services/video_download.py).

save_video used to live in material.py; svg_material could only reach it
through a call-time import because material.py imports svg_material at top
level. The downloader now lives in its own module: material re-exports it for
existing callers, and svg_material imports it directly.
"""
import ipaddress
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.config import config
from app.services import material, svg_material, video_download


class SharedDownloaderTests(unittest.TestCase):
    def setUp(self):
        self.original_app_config = dict(config.app)
        self.original_proxy_config = dict(config.proxy)

    def tearDown(self):
        config.app.clear()
        config.app.update(self.original_app_config)
        config.proxy.clear()
        config.proxy.update(self.original_proxy_config)

    def test_material_reexports_the_shared_save_video(self):
        self.assertIs(material.save_video, video_download.save_video)

    def test_svg_material_resolves_downloads_through_video_download(self):
        self.assertIs(svg_material.video_download, video_download)

    def test_save_video_downloads_and_verifies_tls_by_default(self):
        config.app.pop("tls_verify", None)
        config.proxy.clear()

        fake_response = SimpleNamespace(
            content=b"fake-video",
            headers={"Content-Type": "video/mp4"},
            iter_content=lambda chunk_size: iter([b"fake-video"]),
            close=lambda: None,
            status_code=200,
        )

        class FakeVideoFileClip:
            duration = 1
            fps = 24

            def __init__(self, path):
                self.path = path

            def close(self):
                return None

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch(
                "app.utils.ssrf.requests.get", return_value=fake_response
            ) as get, patch(
                # Avoid live DNS: resolve example.com to a public IP locally.
                "app.utils.ssrf._resolve_global_ips",
                return_value=[ipaddress.ip_address("93.184.216.34")],
            ), patch(
                "app.services.video_download.VideoFileClip", FakeVideoFileClip
            ):
                video_path = video_download.save_video(
                    "https://example.com/video.mp4?token=<redacted>", save_dir=temp_dir
                )

            self.assertTrue(os.path.exists(video_path))
            self.assertTrue(get.call_args.kwargs["verify"])


if __name__ == "__main__":
    unittest.main()

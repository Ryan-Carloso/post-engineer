import ipaddress
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import requests

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.config import config
from app.services import material


class TestMaterialTlsVerification(unittest.TestCase):
    def setUp(self):
        self.original_app_config = dict(config.app)
        self.original_proxy_config = dict(config.proxy)

    def tearDown(self):
        config.app.clear()
        config.app.update(self.original_app_config)
        config.proxy.clear()
        config.proxy.update(self.original_proxy_config)

    def test_search_pexels_uses_tls_verification_by_default(self):
        """
        The default path must enable TLS verification, so material API
        keys and returned material URLs can't be intercepted or tampered
        with by a man-in-the-middle on public networks or untrusted
        proxies.
        """
        config.app["pexels_api_keys"] = ["pexels-key"]
        config.app.pop("tls_verify", None)
        config.proxy.clear()

        fake_response = SimpleNamespace(
            json=lambda: {
                "videos": [
                    {
                        "duration": 8,
                        "video_files": [
                            {
                                "width": 1080,
                                "height": 1920,
                                "link": "https://example.com/video.mp4",
                            }
                        ],
                    }
                ]
            }
        )

        with patch("app.services.material.requests.get", return_value=fake_response) as get:
            results = material.search_videos_pexels("cat", minimum_duration=1)

        self.assertEqual(len(results), 1)
        self.assertTrue(get.call_args.kwargs["verify"])

    def test_search_pixabay_allows_explicit_tls_disable_for_proxy(self):
        """
        Some corporate proxies use self-signed certificates. That scenario
        must explicitly configure TLS verification off — it can no longer
        be hardcoded off in code.
        """
        config.app["pixabay_api_keys"] = ["pixabay-key"]
        config.app["tls_verify"] = False
        config.proxy.clear()

        fake_response = SimpleNamespace(
            json=lambda: {
                "hits": [
                    {
                        "duration": 8,
                        "videos": {
                            "large": {
                                "width": 720,
                                "height": 1280,
                                "url": "https://example.com/video.mp4",
                            }
                        },
                    }
                ]
            }
        )

        with patch("app.services.material.requests.get", return_value=fake_response) as get:
            results = material.search_videos_pixabay("cat", minimum_duration=1)

        self.assertEqual(len(results), 1)
        self.assertFalse(get.call_args.kwargs["verify"])

    def test_save_video_uses_tls_verification_by_default(self):
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
            ), patch("app.services.material.VideoFileClip", FakeVideoFileClip):
                video_path = material.save_video(
                    "https://example.com/video.mp4?token=abc", save_dir=temp_dir
                )

            self.assertTrue(os.path.exists(video_path))
            self.assertTrue(get.call_args.kwargs["verify"])

    def test_save_video_rejects_private_ssrf_targets(self):
        config.app.pop("tls_verify", None)
        config.proxy.clear()

        with tempfile.TemporaryDirectory() as temp_dir:
            video_path = material.save_video(
                "http://169.254.169.254/latest/meta-data", save_dir=temp_dir
            )
            self.assertEqual(video_path, "")
            self.assertEqual(os.listdir(temp_dir), [])

    def test_download_videos_accepts_plain_string_concat_mode(self):
        """
        download_videos may receive a plain string mode from the service
        layer or tests instead of the VideoConcatMode enum. Empty search
        terms avoid real network here; only verify the string "random" no
        longer raises AttributeError when `.value` is accessed.
        """
        result = material.download_videos(
            task_id="string-concat-mode",
            search_terms=[],
            video_concat_mode="random",
        )

        self.assertEqual(result, [])

    def test_download_videos_can_round_robin_terms_in_script_order(self):
        """
        With script-order material matching on, the first keyword's
        candidates must not fill the audio duration first. Two keywords
        with multiple candidates each are simulated here; the download
        order must be term1-#1, term2-#1, term1-#2 — close to script
        narrative order.
        """
        search_results = {
            "opening city": [
                material.MaterialInfo(provider="pexels", url="https://v.example/a1.mp4", duration=3),
                material.MaterialInfo(provider="pexels", url="https://v.example/a2.mp4", duration=3),
            ],
            "middle office": [
                material.MaterialInfo(provider="pexels", url="https://v.example/b1.mp4", duration=3),
                material.MaterialInfo(provider="pexels", url="https://v.example/b2.mp4", duration=3),
            ],
        }
        downloaded_urls = []

        def fake_search(search_term, minimum_duration, video_aspect):
            return search_results[search_term]

        def fake_save_video(video_url, save_dir=""):
            downloaded_urls.append(video_url)
            return f"/tmp/{video_url.rsplit('/', 1)[-1]}"

        with (
            patch.dict(config.app, {"material_directory": ""}),
            patch.object(material, "search_videos_pexels", side_effect=fake_search),
            patch.object(material, "save_video", side_effect=fake_save_video),
        ):
            result = material.download_videos(
                task_id="ordered-materials",
                search_terms=["opening city", "middle office"],
                source="pexels",
                audio_duration=7,
                max_clip_duration=3,
                match_script_order=True,
            )

        self.assertEqual(
            downloaded_urls,
            [
                "https://v.example/a1.mp4",
                "https://v.example/b1.mp4",
                "https://v.example/a2.mp4",
            ],
        )
        self.assertEqual(result, ["/tmp/a1.mp4", "/tmp/b1.mp4", "/tmp/a2.mp4"])


class TestVideoSourceMix(unittest.TestCase):
    """
    Provider mix (pexels + pixabay + coverr): per-keyword cascade search.
    Mocks only at the external search APIs and the download (boundary).
    """

    def setUp(self):
        self.original_app_config = dict(config.app)
        self.original_proxy_config = dict(config.proxy)

    def tearDown(self):
        config.app.clear()
        config.app.update(self.original_app_config)
        config.proxy.clear()
        config.proxy.update(self.original_proxy_config)

    def test_source_mix_falls_back_to_next_provider_when_pexels_is_empty(self):
        """
        With source_mix=["pexels", "pixabay"], keywords with no Pexels
        results must be supplemented by Pixabay. Expected: the Pixabay
        video enters the timeline when Pexels has no material.
        """
        calls = []

        def fake_pexels(search_term, minimum_duration, video_aspect):
            calls.append("pexels")
            return []

        def fake_pixabay(search_term, minimum_duration, video_aspect):
            calls.append("pixabay")
            return [
                material.MaterialInfo(
                    provider="pixabay", url="https://v.example/px1.mp4", duration=10
                )
            ]

        def fake_save_video(video_url, save_dir=""):
            return f"/tmp/{video_url.rsplit('/', 1)[-1]}"

        with (
            patch.dict(config.app, {"material_directory": ""}),
            patch.object(material, "search_videos_pexels", side_effect=fake_pexels),
            patch.object(material, "search_videos_pixabay", side_effect=fake_pixabay),
            patch.object(material, "save_video", side_effect=fake_save_video),
        ):
            result = material.download_videos(
                task_id="source-mix-fallback",
                search_terms=["city sunset"],
                audio_duration=4,
                max_clip_duration=3,
                source_mix=["pexels", "pixabay"],
            )

        self.assertEqual(calls, ["pexels", "pixabay"])
        self.assertEqual(result, ["/tmp/px1.mp4"])

    def test_source_mix_prioritizes_earlier_provider_results(self):
        """
        When Pexels already has enough material, Pixabay must not be
        queried (the cascade only falls to the next provider when needed).
        """
        pixabay_called = []

        def fake_pexels(search_term, minimum_duration, video_aspect):
            return [
                material.MaterialInfo(
                    provider="pexels", url="https://v.example/a1.mp4", duration=10
                )
            ]

        def fake_pixabay(search_term, minimum_duration, video_aspect):
            pixabay_called.append(True)
            return []

        def fake_save_video(video_url, save_dir=""):
            return f"/tmp/{video_url.rsplit('/', 1)[-1]}"

        with (
            patch.dict(config.app, {"material_directory": ""}),
            patch.object(material, "search_videos_pexels", side_effect=fake_pexels),
            patch.object(material, "search_videos_pixabay", side_effect=fake_pixabay),
            patch.object(material, "save_video", side_effect=fake_save_video),
        ):
            result = material.download_videos(
                task_id="source-mix-priority",
                search_terms=["city sunset"],
                audio_duration=4,
                max_clip_duration=3,
                source_mix=["pexels", "pixabay"],
            )

        self.assertEqual(pixabay_called, [])
        self.assertEqual(result, ["/tmp/a1.mp4"])

    def test_source_mix_none_keeps_single_source_behavior(self):
        """
        Without source_mix (default), behavior is unchanged: only the
        `source` provider is queried.
        """
        pixabay_called = []

        def fake_pexels(search_term, minimum_duration, video_aspect):
            return [
                material.MaterialInfo(
                    provider="pexels", url="https://v.example/a1.mp4", duration=10
                )
            ]

        def fake_pixabay(search_term, minimum_duration, video_aspect):
            pixabay_called.append(True)
            return []

        def fake_save_video(video_url, save_dir=""):
            return f"/tmp/{video_url.rsplit('/', 1)[-1]}"

        with (
            patch.dict(config.app, {"material_directory": ""}),
            patch.object(material, "search_videos_pexels", side_effect=fake_pexels),
            patch.object(material, "search_videos_pixabay", side_effect=fake_pixabay),
            patch.object(material, "save_video", side_effect=fake_save_video),
        ):
            result = material.download_videos(
                task_id="no-source-mix",
                search_terms=["city sunset"],
                source="pexels",
                audio_duration=4,
                max_clip_duration=3,
            )

        self.assertEqual(pixabay_called, [])
        self.assertEqual(result, ["/tmp/a1.mp4"])

    def test_source_mix_works_with_script_order_matching(self):
        """
        The provider mix also applies in sequential mode
        (match_script_order): empty Pexels keywords are supplemented by
        later providers, keeping the downloads' narrative order.
        """

        def fake_pexels(search_term, minimum_duration, video_aspect):
            if search_term == "opening city":
                return [
                    material.MaterialInfo(
                        provider="pexels", url="https://v.example/a1.mp4", duration=3
                    )
                ]
            return []

        def fake_pixabay(search_term, minimum_duration, video_aspect):
            if search_term == "middle office":
                return [
                    material.MaterialInfo(
                        provider="pixabay", url="https://v.example/b1.mp4", duration=3
                    )
                ]
            return []

        def fake_save_video(video_url, save_dir=""):
            return f"/tmp/{video_url.rsplit('/', 1)[-1]}"

        with (
            patch.dict(config.app, {"material_directory": ""}),
            patch.object(material, "search_videos_pexels", side_effect=fake_pexels),
            patch.object(material, "search_videos_pixabay", side_effect=fake_pixabay),
            patch.object(material, "save_video", side_effect=fake_save_video),
        ):
            result = material.download_videos(
                task_id="source-mix-ordered",
                search_terms=["opening city", "middle office"],
                audio_duration=6,
                max_clip_duration=3,
                match_script_order=True,
                source_mix=["pexels", "pixabay"],
            )

        self.assertEqual(result, ["/tmp/a1.mp4", "/tmp/b1.mp4"])


    def test_video_params_has_no_source_or_count_configuration(self):
        """
        Provider selection is fixed engine-side: 3 providers shuffled in
        cascade per task, and the output is always 1 video per task. There
        is no video_source/video_source_mix/video_count in the API or in
        config — no field to configure.
        """
        from app.models.schema import VideoParams

        params = VideoParams(video_subject="x")
        self.assertFalse(hasattr(params, "video_source"))
        self.assertFalse(hasattr(params, "video_source_mix"))
        self.assertFalse(hasattr(params, "video_count"))


class TestCoverrProvider(unittest.TestCase):
    """
    Coverr video material provider (spec:
    2026-06-09-coverr-video-provider-design.md). requests is fully replaced
    with unittest.mock so CI never depends on real network or a real API
    key.
    """

    def setUp(self):
        self.original_app_config = dict(config.app)
        self.original_proxy_config = dict(config.proxy)

    def tearDown(self):
        config.app.clear()
        config.app.update(self.original_app_config)
        config.proxy.clear()
        config.proxy.update(self.original_proxy_config)

    # ---------------- Tests for search_videos_coverr ----------------

    def test_search_coverr_uses_mp4_download_url(self):
        """
        search_videos_coverr must turn each hit into a MaterialInfo and use
        urls.mp4_download directly as MaterialInfo.url.
        Per the official Coverr docs (api.coverr.co/docs/videos/#download-a-video),
        GETting mp4_download already counts as a download stat on Coverr's
        side -- no extra PATCH ping needed. Also verifies the Authorization
        header uses Bearer <redacted>.
        """
        config.app["coverr_api_keys"] = ["coverr-key"]
        config.app.pop("tls_verify", None)
        config.proxy.clear()

        fake_response = SimpleNamespace(
            json=lambda: {
                "page": 0,
                "pages": 50,
                "page_size": 20,
                "total": 1,
                "hits": [
                    {
                        "id": "S1YbPl1NfI",
                        "duration": 11.625,
                        "width": 720,
                        "height": 1280,
                        "urls": {
                            "mp4": "https://storage.coverr.co/videos/abc?token=xyz",
                            "mp4_preview": "https://storage.coverr.co/videos/abc/preview?token=xyz",
                            "mp4_download": "https://storage.coverr.co/videos/abc/download?token=xyz",
                        },
                    }
                ],
            }
        )

        with patch(
            "app.services.material.requests.get", return_value=fake_response
        ) as get:
            results = material.search_videos_coverr("nature", minimum_duration=5)

        self.assertEqual(len(results), 1)
        item = results[0]
        self.assertEqual(item.provider, "coverr")
        self.assertEqual(item.duration, 11)
        # the url field is the mp4_download URL as-is; no coverr://id|url encoding
        self.assertEqual(
            item.url, "https://storage.coverr.co/videos/abc/download?token=xyz"
        )
        # Bearer auth + TLS verify on by default
        self.assertEqual(
            get.call_args.kwargs["headers"]["Authorization"], "Bearer coverr-key"
        )
        self.assertTrue(get.call_args.kwargs["verify"])

    def test_search_coverr_uses_tls_verification_by_default(self):
        """Same as pexels/pixabay: TLS verification defaults on when not explicitly configured."""
        config.app["coverr_api_keys"] = ["coverr-key"]
        config.app.pop("tls_verify", None)
        config.proxy.clear()

        fake_response = SimpleNamespace(json=lambda: {"hits": []})

        with patch(
            "app.services.material.requests.get", return_value=fake_response
        ) as get:
            material.search_videos_coverr("nature", minimum_duration=1)

        self.assertTrue(get.call_args.kwargs["verify"])

    def test_search_coverr_allows_explicit_tls_disable_for_proxy(self):
        """Corporate self-signed-certificate proxy scenarios must be able to turn TLS verification off explicitly."""
        config.app["coverr_api_keys"] = ["coverr-key"]
        config.app["tls_verify"] = False
        config.proxy.clear()

        fake_response = SimpleNamespace(json=lambda: {"hits": []})

        with patch(
            "app.services.material.requests.get", return_value=fake_response
        ) as get:
            material.search_videos_coverr("nature", minimum_duration=1)

        self.assertFalse(get.call_args.kwargs["verify"])

    def test_search_coverr_filters_by_min_duration_and_accepts_string(self):
        """
        The Coverr duration field may be a number or a string in different responses;
        both shapes are accepted, and entries below minimum_duration are filtered out.
        """
        config.app["coverr_api_keys"] = ["coverr-key"]
        config.app.pop("tls_verify", None)
        config.proxy.clear()

        fake_response = SimpleNamespace(
            json=lambda: {
                "hits": [
                    {
                        "id": "shortvid",
                        "duration": 3,  # below minimum
                        "urls": {"mp4_download": "https://example.com/a.mp4"},
                    },
                    {
                        "id": "stringdur",
                        "duration": "10.500000",  # string accepted
                        "width": 720,
                        "height": 1280,
                        "urls": {"mp4_download": "https://example.com/b.mp4"},
                    },
                ]
            }
        )

        with patch(
            "app.services.material.requests.get", return_value=fake_response
        ):
            results = material.search_videos_coverr("x", minimum_duration=5)

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].duration, 10)
        self.assertEqual(results[0].url, "https://example.com/b.mp4")

    def test_search_coverr_skips_invalid_items(self):
        """Entries missing id or urls.mp4_download are skipped, not raised on."""
        config.app["coverr_api_keys"] = ["coverr-key"]
        config.app.pop("tls_verify", None)
        config.proxy.clear()

        fake_response = SimpleNamespace(
            json=lambda: {
                "hits": [
                    {  # missing urls.mp4_download
                        "id": "no-download",
                        "duration": 10,
                        "urls": {"mp4_preview": "https://example.com/preview.mp4"},
                    },
                    {  # missing id
                        "duration": 10,
                        "urls": {"mp4_download": "https://example.com/x.mp4"},
                    },
                    {  # valid baseline
                        "id": "good",
                        "duration": 10,
                        "width": 720,
                        "height": 1280,
                        "urls": {"mp4_download": "https://example.com/good.mp4"},
                    },
                ]
            }
        )

        with patch(
            "app.services.material.requests.get", return_value=fake_response
        ):
            results = material.search_videos_coverr("x", minimum_duration=1)

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].url, "https://example.com/good.mp4")

    def test_search_coverr_returns_empty_on_failure(self):
        """
        On malformed response structure / network errors, the function must return []
        instead of raising, consistent with pexels/pixabay behavior.
        """
        config.app["coverr_api_keys"] = ["coverr-key"]
        config.app.pop("tls_verify", None)
        config.proxy.clear()

        # Subtest A: malformed response (no "hits" key)
        with self.subTest("malformed response"):
            fake_response = SimpleNamespace(
                json=lambda: {"error": "rate limited"}
            )
            with patch(
                "app.services.material.requests.get", return_value=fake_response
            ):
                results = material.search_videos_coverr("x", minimum_duration=1)
            self.assertEqual(results, [])

        # Subtest B: network exception bubbles up from requests.get
        with self.subTest("network exception"):
            with patch(
                "app.services.material.requests.get",
                side_effect=requests.ConnectionError("boom"),
            ):
                results = material.search_videos_coverr("x", minimum_duration=1)
            self.assertEqual(results, [])

    # ---------------- Tests for download_videos coverr branch ----------------

    def test_download_videos_passes_mp4_download_url_to_save_video(self):
        """
        With source="coverr":
          1. dispatch to search_videos_coverr
          2. coverr items take the generic download path: save_video receives the mp4_download URL as-is
             (no more coverr://id|url encoding, no PATCH ping call)
          3. the saved path is returned
        """
        config.app["coverr_api_keys"] = ["coverr-key"]
        config.app.pop("tls_verify", None)
        config.app.pop("material_directory", None)
        config.proxy.clear()

        fake_item = material.MaterialInfo()
        fake_item.provider = "coverr"
        fake_item.url = "https://storage.coverr.co/videos/abc/download?token=xyz"
        fake_item.duration = 10

        with patch(
            "app.services.material.search_videos_coverr",
            return_value=[fake_item],
        ) as search, patch(
            "app.services.material.save_video",
            return_value="/tmp/coverr-saved.mp4",
        ) as save:
            result = material.download_videos(
                task_id="t-coverr",
                search_terms=["nature"],
                source="coverr",
                audio_duration=5,
                max_clip_duration=5,
            )

        # 1. dispatch
        self.assertEqual(search.call_count, 1)

        # 2. save_video receives the mp4_download URL as-is, passed through untouched
        save_url = save.call_args.kwargs.get("video_url") or save.call_args.args[0]
        self.assertEqual(
            save_url, "https://storage.coverr.co/videos/abc/download?token=xyz"
        )

        # 3. the return value is correct
        self.assertEqual(result, ["/tmp/coverr-saved.mp4"])


if __name__ == "__main__":
    unittest.main()


class TestProviderAspectRatioBand(unittest.TestCase):
    """
    Search honors the bar ceiling (MAX_LETTERBOX_BARS = 35%): a clip only
    enters when letterboxing against the target video_aspect stays within
    the ceiling. Missing/zero dimensions reject (Coverr is 99% landscape;
    without explicit dimensions, don't risk it).
    """

    def setUp(self):
        self.original_app_config = dict(config.app)
        config.proxy.clear()

    def tearDown(self):
        config.app.clear()
        config.app.update(self.original_app_config)
        config.proxy.clear()

    def test_pexels_portrait_target_rejects_landscape_files(self):
        config.app["pexels_api_keys"] = ["pexels-key"]
        fake_response = SimpleNamespace(
            json=lambda: {
                "videos": [
                    {
                        "duration": 8,
                        "video_files": [
                            {"width": 3840, "height": 2160, "link": "https://example.com/land.mp4"},
                            {"width": 720, "height": 1280, "link": "https://example.com/port-small.mp4"},
                            {"width": 1080, "height": 1920, "link": "https://example.com/port-big.mp4"},
                        ],
                    }
                ]
            }
        )
        with patch("app.services.material.requests.get", return_value=fake_response):
            results = material.search_videos_pexels("cat", minimum_duration=1, video_aspect="9:16")

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].url, "https://example.com/port-big.mp4")

    def test_pexels_portrait_target_rejects_taller_than_target_files(self):
        """
        A 9:18 clip (720x1440) on a 9:16 target would create side bars
        (pillarbox) — always rejected, even under 35% of bars.
        """
        config.app["pexels_api_keys"] = ["pexels-key"]
        fake_response = SimpleNamespace(
            json=lambda: {
                "videos": [
                    {
                        "duration": 8,
                        "video_files": [
                            {"width": 720, "height": 1440, "link": "https://example.com/tall.mp4"},
                            {"width": 1080, "height": 1920, "link": "https://example.com/port-big.mp4"},
                        ],
                    }
                ]
            }
        )
        with patch("app.services.material.requests.get", return_value=fake_response):
            results = material.search_videos_pexels("cat", minimum_duration=1, video_aspect="9:16")

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].url, "https://example.com/port-big.mp4")

    def test_pexels_landscape_target_rejects_portrait_files(self):
        config.app["pexels_api_keys"] = ["pexels-key"]
        fake_response = SimpleNamespace(
            json=lambda: {
                "videos": [
                    {
                        "duration": 8,
                        "video_files": [
                            {"width": 1080, "height": 1920, "link": "https://example.com/port.mp4"},
                            {"width": 1280, "height": 720, "link": "https://example.com/land.mp4"},
                        ],
                    }
                ]
            }
        )
        with patch("app.services.material.requests.get", return_value=fake_response):
            results = material.search_videos_pexels("cat", minimum_duration=1, video_aspect="16:9")

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].url, "https://example.com/land.mp4")

    def test_pexels_square_target_rejects_out_of_band_files(self):
        config.app["pexels_api_keys"] = ["pexels-key"]
        fake_response = SimpleNamespace(
            json=lambda: {
                "videos": [
                    {
                        "duration": 8,
                        "video_files": [
                            {"width": 1000, "height": 1600, "link": "https://example.com/port.mp4"},
                            {"width": 960, "height": 960, "link": "https://example.com/square.mp4"},
                            {"width": 1920, "height": 800, "link": "https://example.com/wide.mp4"},
                        ],
                    }
                ]
            }
        )
        with patch("app.services.material.requests.get", return_value=fake_response):
            results = material.search_videos_pexels("cat", minimum_duration=1, video_aspect="1:1")

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].url, "https://example.com/square.mp4")

    def test_pexels_three_quarter_file_within_band_accepted_for_portrait(self):
        """3:4 on 9:16 yields ~25% bars -- within the ceiling, accepted."""
        config.app["pexels_api_keys"] = ["pexels-key"]
        fake_response = SimpleNamespace(
            json=lambda: {
                "videos": [
                    {
                        "duration": 8,
                        "video_files": [
                            {"width": 3840, "height": 2160, "link": "https://example.com/land.mp4"},
                            {"width": 720, "height": 960, "link": "https://example.com/3x4.mp4"},
                        ],
                    }
                ]
            }
        )
        with patch("app.services.material.requests.get", return_value=fake_response):
            results = material.search_videos_pexels("cat", minimum_duration=1, video_aspect="9:16")

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].url, "https://example.com/3x4.mp4")

    def test_pexels_one_to_one_file_outside_band_rejected_for_portrait(self):
        """1:1 on 9:16 yields ~44% bars -- outside the ceiling, rejected."""
        config.app["pexels_api_keys"] = ["pexels-key"]
        fake_response = SimpleNamespace(
            json=lambda: {
                "videos": [
                    {
                        "duration": 8,
                        "video_files": [
                            {"width": 960, "height": 960, "link": "https://example.com/square.mp4"},
                        ],
                    }
                ]
            }
        )
        with patch("app.services.material.requests.get", return_value=fake_response):
            results = material.search_videos_pexels("cat", minimum_duration=1, video_aspect="9:16")

        self.assertEqual(results, [])

    def test_pixabay_portrait_target_rejects_landscape_files(self):
        config.app["pixabay_api_keys"] = ["pixabay-key"]
        fake_response = SimpleNamespace(
            json=lambda: {
                "hits": [
                    {
                        "duration": 8,
                        "videos": {
                            "large": {"width": 1920, "height": 1080, "url": "https://example.com/land.mp4"},
                            "medium": {"width": 720, "height": 1280, "url": "https://example.com/port.mp4"},
                        },
                    }
                ]
            }
        )
        with patch("app.services.material.requests.get", return_value=fake_response):
            results = material.search_videos_pixabay("cat", minimum_duration=1, video_aspect="9:16")

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].url, "https://example.com/port.mp4")

    def test_pixabay_file_without_dimensions_is_rejected(self):
        """Without dimensions the bar ceiling cannot be evaluated — reject."""
        config.app["pixabay_api_keys"] = ["pixabay-key"]
        fake_response = SimpleNamespace(
            json=lambda: {
                "hits": [
                    {
                        "duration": 8,
                        "videos": {
                            "large": {"width": 1920, "url": "https://example.com/no-height.mp4"},
                        },
                    }
                ]
            }
        )
        with patch("app.services.material.requests.get", return_value=fake_response):
            results = material.search_videos_pixabay("cat", minimum_duration=1, video_aspect="9:16")

        self.assertEqual(results, [])

    def test_pixabay_three_quarter_file_within_band_accepted_for_portrait(self):
        config.app["pixabay_api_keys"] = ["pixabay-key"]
        fake_response = SimpleNamespace(
            json=lambda: {
                "hits": [
                    {
                        "duration": 8,
                        "videos": {
                            "large": {"width": 1920, "height": 1080, "url": "https://example.com/land.mp4"},
                            "medium": {"width": 720, "height": 960, "url": "https://example.com/3x4.mp4"},
                        },
                    }
                ]
            }
        )
        with patch("app.services.material.requests.get", return_value=fake_response):
            results = material.search_videos_pixabay("cat", minimum_duration=1, video_aspect="9:16")

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].url, "https://example.com/3x4.mp4")

    def test_coverr_hit_with_landscape_dimensions_rejected_for_portrait(self):
        config.app["coverr_api_keys"] = ["coverr-key"]
        fake_response = SimpleNamespace(
            json=lambda: {
                "hits": [
                    {"id": "v1", "duration": 10, "width": 1920, "height": 1080, "urls": {"mp4_download": "https://example.com/land.mp4"}},
                    {"id": "v2", "duration": 10, "width": 720, "height": 1280, "urls": {"mp4_download": "https://example.com/port.mp4"}},
                ]
            }
        )
        with patch("app.services.material.requests.get", return_value=fake_response):
            results = material.search_videos_coverr("cat", minimum_duration=1, video_aspect="9:16")

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].url, "https://example.com/port.mp4")

    def test_coverr_hit_without_dimensions_rejected(self):
        """Without dimensions the bar ceiling cannot be evaluated — reject."""
        config.app["coverr_api_keys"] = ["coverr-key"]
        fake_response = SimpleNamespace(
            json=lambda: {
                "hits": [
                    {"id": "v1", "duration": 10, "urls": {"mp4_download": "https://example.com/unknown.mp4"}},
                ]
            }
        )
        with patch("app.services.material.requests.get", return_value=fake_response):
            results = material.search_videos_coverr("cat", minimum_duration=1, video_aspect="9:16")

        self.assertEqual(results, [])


class TestFaceFiltering(unittest.TestCase):
    """
    material_exclude_people filter: material with a detected face is
    dropped from the timeline, so it does not steal the personas faces
    (the persona face comes only from the lipsync image; B-roll must not
    show other people).
    """

    def setUp(self):
        self.original_app_config = dict(config.app)
        self.original_proxy_config = dict(config.proxy)

    def tearDown(self):
        config.app.clear()
        config.app.update(self.original_app_config)
        config.proxy.clear()
        config.proxy.update(self.original_proxy_config)

    def test_download_videos_discards_material_with_detected_face(self):
        """
        With material_exclude_people=true, a saved clip containing a face
        is discarded (it does not enter the timeline).
        """
        fake_item = material.MaterialInfo(
            provider="pexels", url="https://v.example/face.mp4", duration=8
        )

        def fake_search(search_term, minimum_duration, video_aspect):
            return [fake_item]

        with (
            patch.dict(config.app, {"material_directory": ""}),
            patch.object(material, "search_videos_pexels", side_effect=fake_search),
            patch.object(material, "save_video", return_value="/tmp/face-saved.mp4"),
            patch.object(
                material.face_detect,
                "video_contains_face",
                return_value=True,
            ) as face_check,
        ):
            result = material.download_videos(
                task_id="face-excluded",
                search_terms=["city"],
                audio_duration=8,
                max_clip_duration=5,
            )

        face_check.assert_called_once_with("/tmp/face-saved.mp4", force_exclude=None)
        self.assertEqual(result, [])

    def test_download_videos_keeps_material_without_face(self):
        """
        When the clip has no detected face (or the filter is off), the
        material enters the timeline normally.
        """
        fake_item = material.MaterialInfo(
            provider="pexels", url="https://v.example/clean.mp4", duration=8
        )

        def fake_search(search_term, minimum_duration, video_aspect):
            return [fake_item]

        with (
            patch.dict(config.app, {"material_directory": ""}),
            patch.object(material, "search_videos_pexels", side_effect=fake_search),
            patch.object(material, "save_video", return_value="/tmp/clean-saved.mp4"),
            patch.object(
                material.face_detect,
                "video_contains_face",
                return_value=False,
            ) as face_check,
        ):
            result = material.download_videos(
                task_id="face-kept",
                search_terms=["city"],
                audio_duration=8,
                max_clip_duration=5,
            )

        face_check.assert_called_once_with("/tmp/clean-saved.mp4", force_exclude=None)
        self.assertEqual(result, ["/tmp/clean-saved.mp4"])

    def test_face_filter_disabled_still_invokes_guard(self):
        """
        Even when off, the download calls the guard; the enable decision
        lives inside video_contains_face (reads material_exclude_people).
        On the off default the guard returns False and the material is
        kept.
        """
        fake_item = material.MaterialInfo(
            provider="pexels", url="https://v.example/x.mp4", duration=8
        )

        def fake_search(search_term, minimum_duration, video_aspect):
            return [fake_item]

        with (
            patch.dict(config.app, {"material_directory": ""}),
            patch.object(material, "search_videos_pexels", side_effect=fake_search),
            patch.object(material, "save_video", return_value="/tmp/x-saved.mp4"),
            patch.object(
                material.face_detect,
                "video_contains_face",
                return_value=False,
            ) as face_check,
        ):
            result = material.download_videos(
                task_id="face-disabled",
                search_terms=["city"],
                audio_duration=8,
                max_clip_duration=5,
            )

        face_check.assert_called_once_with("/tmp/x-saved.mp4", force_exclude=None)
        self.assertEqual(result, ["/tmp/x-saved.mp4"])

    def test_download_videos_passes_explicit_exclude_faces_flag(self):
        """
        When exclude_faces is passed explicitly (e.g. persona mode with lipsync),
        the force_exclude parameter must be forwarded to video_contains_face.
        """
        fake_item = material.MaterialInfo(
            provider="pexels", url="https://v.example/f1.mp4", duration=8
        )

        def fake_search(search_term, minimum_duration, video_aspect):
            return [fake_item]

        with (
            patch.dict(config.app, {"material_directory": ""}),
            patch.object(material, "search_videos_pexels", side_effect=fake_search),
            patch.object(material, "save_video", return_value="/tmp/f1-saved.mp4"),
            patch.object(
                material.face_detect,
                "video_contains_face",
                return_value=True,
            ) as face_check,
        ):
            result = material.download_videos(
                task_id="face-explicit-true",
                search_terms=["city"],
                audio_duration=8,
                max_clip_duration=5,
                exclude_faces=True,
            )

        face_check.assert_called_once_with("/tmp/f1-saved.mp4", force_exclude=True)
        self.assertEqual(result, [])

    def test_download_videos_script_order_passes_exclude_faces_flag(self):
        """
        In script-order mode (match_script_order=True), exclude_faces
        is also properly forwarded to video_contains_face.
        """
        fake_item = material.MaterialInfo(
            provider="pexels", url="https://v.example/s1.mp4", duration=8
        )

        def fake_search(search_term, minimum_duration, video_aspect):
            return [fake_item]

        with (
            patch.dict(config.app, {"material_directory": ""}),
            patch.object(material, "search_videos_pexels", side_effect=fake_search),
            patch.object(material, "save_video", return_value="/tmp/s1-saved.mp4"),
            patch.object(
                material.face_detect,
                "video_contains_face",
                return_value=False,
            ) as face_check,
        ):
            result = material.download_videos(
                task_id="face-script-order-false",
                search_terms=["city"],
                audio_duration=8,
                max_clip_duration=5,
                match_script_order=True,
                exclude_faces=False,
            )

        face_check.assert_called_once_with("/tmp/s1-saved.mp4", force_exclude=False)
        self.assertEqual(result, ["/tmp/s1-saved.mp4"])


class TestPixabayKeyHandling(unittest.TestCase):
    """The Pixabay API key must never reach the logs.

    Pixabay only accepts the key as a `key` query parameter (no header auth
    exists), so it stays in the request URL — but every logged URL goes
    through secret_redaction. The missing-key error must not dump the whole
    app config (which holds every other provider key).
    """

    def setUp(self):
        self.original_app_config = dict(config.app)

    def tearDown(self):
        config.app.clear()
        config.app.update(self.original_app_config)

    def _fake_empty_response(self):
        return SimpleNamespace(json=lambda: {"hits": []})

    def _logged_text(self, mock_logger):
        texts = []
        for name in ("info", "warning", "error", "success", "debug"):
            mock = getattr(mock_logger, name)
            for call in mock.call_args_list:
                texts.append(" ".join(str(arg) for arg in call.args))
        return "\n".join(texts)

    def test_pixabay_key_never_appears_in_logs(self):
        config.app["pixabay_api_keys"] = ["PIXABAY-SECRET-KEY"]
        with (
            patch(
                "app.services.material.requests.get",
                return_value=self._fake_empty_response(),
            ),
            patch("app.services.material.logger") as mock_logger,
        ):
            material.search_videos_pixabay("cats", minimum_duration=1)

        logged = self._logged_text(mock_logger)
        self.assertNotIn("PIXABAY-SECRET-KEY", logged)
        # The search URL is still logged for debugging, with the key redacted.
        self.assertIn("key=***", logged)

    def test_pixabay_key_sent_as_query_param(self):
        # Pixabay's API requires `key` in the query string; there is no
        # header alternative, so the request URL must carry it.
        config.app["pixabay_api_keys"] = ["PIXABAY-SECRET-KEY"]
        with patch(
            "app.services.material.requests.get",
            return_value=self._fake_empty_response(),
        ) as get:
            material.search_videos_pixabay("cats", minimum_duration=1)

        called_url = get.call_args.args[0]
        self.assertIn("key=PIXABAY-SECRET-KEY", called_url)

    def test_get_api_key_error_does_not_dump_config(self):
        config.app.pop("pixabay_api_keys", None)
        config.app["pexels_api_keys"] = ["PEXELS-SECRET"]
        config.app["coverr_api_keys"] = ["COVERR-SECRET"]
        with self.assertRaises(ValueError) as ctx:
            material.get_api_key("pixabay_api_keys")

        message = str(ctx.exception)
        self.assertIn("pixabay_api_keys", message)
        self.assertNotIn("PEXELS-SECRET", message)
        self.assertNotIn("COVERR-SECRET", message)


if __name__ == "__main__":
    unittest.main()

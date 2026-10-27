"""Preview images of stock candidates: the cheap input of the visual verifier.

Pexels, Pixabay and Coverr return a preview image next to every clip.
Scoring that image instead of downloading the whole clip is what keeps
visual verification at about a minute per video. The image is optional:
a candidate without one is still a valid candidate.
"""

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.config import config
from app.models.schema import MaterialInfo
from app.services import material, stock_thumbnails


@pytest.fixture(autouse=True)
def _keys():
    saved = dict(config.app)
    config.app.update(
        pexels_api_keys=["k"], pixabay_api_keys=["k"], coverr_api_keys=["k"]
    )
    yield
    config.app.clear()
    config.app.update(saved)


def test_usable_keeps_only_http_urls():
    assert stock_thumbnails.usable("https://cdn.example/a.jpg") == "https://cdn.example/a.jpg"
    assert stock_thumbnails.usable("http://cdn.example/a.jpg") == "http://cdn.example/a.jpg"
    for bad in ("", "ftp://x/a.jpg", "file:///etc/passwd", "a.jpg", None, 5, {}):
        assert stock_thumbnails.usable(bad) == ""


def test_item_is_a_material_info_carrying_the_preview():
    item = stock_thumbnails.item("pexels", "https://v/1.mp4", 9, "https://i/1.jpg")
    assert isinstance(item, MaterialInfo)
    assert (item.provider, item.url, item.duration) == ("pexels", "https://v/1.mp4", 9)
    assert item.thumbnail == "https://i/1.jpg"


def test_item_without_a_usable_preview_has_an_empty_one():
    assert stock_thumbnails.item("pexels", "https://v/1.mp4", 9, None).thumbnail == ""
    assert stock_thumbnails.item("pexels", "https://v/1.mp4", 9, "javascript:x").thumbnail == ""


def test_pexels_candidate_carries_the_video_image():
    payload = {
        "videos": [
            {
                "duration": 8,
                "image": "https://images.pexels.com/videos/1/free-video-1.jpg",
                "video_files": [{"width": 1080, "height": 1920, "link": "https://v/1.mp4"}],
            }
        ]
    }
    with patch("app.services.material.requests.get", return_value=SimpleNamespace(json=lambda: payload)):
        results = material.search_videos_pexels("cat", minimum_duration=1)
    assert [r.thumbnail for r in results] == ["https://images.pexels.com/videos/1/free-video-1.jpg"]


def test_pixabay_candidate_carries_the_thumbnail_of_the_chosen_file():
    payload = {
        "hits": [
            {
                "duration": 8,
                "videos": {
                    "large": {
                        "width": 720,
                        "height": 1280,
                        "url": "https://v/large.mp4",
                        "thumbnail": "https://i.vimeocdn.com/large.jpg",
                    },
                    "tiny": {
                        "width": 360,
                        "height": 640,
                        "url": "https://v/tiny.mp4",
                        "thumbnail": "https://i.vimeocdn.com/tiny.jpg",
                    },
                },
            }
        ]
    }
    with patch("app.services.material.requests.get", return_value=SimpleNamespace(json=lambda: payload)):
        results = material.search_videos_pixabay("cat", minimum_duration=1)
    assert [(r.url, r.thumbnail) for r in results] == [
        ("https://v/large.mp4", "https://i.vimeocdn.com/large.jpg")
    ]


def test_coverr_candidate_carries_the_poster():
    payload = {
        "hits": [
            {
                "id": "abc",
                "duration": 11.6,
                "width": 720,
                "height": 1280,
                "poster": "https://storage.coverr.co/posters/abc.jpg",
                "urls": {"mp4_download": "https://storage.coverr.co/abc/download"},
            }
        ]
    }
    with patch("app.services.material.requests.get", return_value=SimpleNamespace(json=lambda: payload)):
        results = material.search_videos_coverr("nature", minimum_duration=5)
    assert [r.thumbnail for r in results] == ["https://storage.coverr.co/posters/abc.jpg"]

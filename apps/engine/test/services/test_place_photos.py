"""place_photos: find, fetch and prepare a photo for a named place.

One Tavily search per name with image descriptions; an image is used only
when its title or description names the place. The download goes through the
SSRF-guarded fetcher (public addresses only, size cap, image content types),
the still is composed onto a portrait canvas, photos with faces are skipped,
and every failure leaves the drawing in place: a photo never fails a video.
"""

import io
import ipaddress
import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from PIL import Image

from app.models.schema import VideoAspect, VideoParams
from app.services import place_photos, web_search_facts
from app.services.place_names import PHOTO_FILE_PREFIX, PreparedPhoto
from app.utils import ssrf
from test.services.test_web_search_facts import _FakeClient, _FakeResponse

PUBLIC_IP = [ipaddress.ip_address("93.184.216.34")]
SUBJECT = "Where to eat the best francesinha in Porto"
SCRIPT = "Ask a local in Porto for the best francesinha and shout Café Santiago in Ribeira."
WORDS = [("Café", 6.0, 6.3), ("Santiago", 6.3, 7.0), ("Ribeira.", 7.5, 8.0)]
ENABLED = {"enabled": True, "place_photos": True}
KEY = {"TAVILY_API_KEY": "tvly-test-key"}


def _jpeg(width=1200, height=800):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (200, 80, 40)).save(buffer, "JPEG")
    return buffer.getvalue()


class _Session:
    """requests-like session that replays one canned response."""

    def __init__(self, body, content_type="image/jpeg", status=200):
        self.body, self.content_type, self.status, self.urls = body, content_type, status, []

    def get(self, url, **kwargs):
        self.urls.append(url)
        return SimpleNamespace(
            status_code=self.status,
            headers={"Content-Type": self.content_type, "Content-Length": str(len(self.body))},
            iter_content=lambda chunk_size: iter([self.body]),
            close=lambda: None,
        )


def _images(*items):
    return _FakeResponse({"images": list(items)}, 200)


SANTIAGO = {
    "url": "https://e.com/santiago.jpg",
    "title": "Café Santiago",
    "description": "A francesinha at Café Santiago",
}
HITS = [
    {"url": "https://e.com/1.jpg", "title": "Rua", "description": "A street in Ribeira"},
    SANTIAGO,
    {"url": "ftp://e.com/3.jpg", "title": "Café Santiago", "description": "Café Santiago"},
]


# ---- gate


def test_first_image_whose_text_names_the_place_wins():
    assert place_photos.pick_image_url(HITS, "Café Santiago") == "https://e.com/santiago.jpg"


def test_every_part_of_the_name_must_appear():
    hits = [{"url": "https://e.com/a.jpg", "title": "Santiago bridge", "description": ""}]
    assert place_photos.pick_image_url(hits, "Café Santiago") is None


def test_only_http_urls_pass_the_gate():
    hits = [{"url": "ftp://e.com/3.jpg", "title": "Café Santiago", "description": "Café Santiago"}]
    assert place_photos.pick_image_url(hits, "Café Santiago") is None


def test_no_matching_image_means_none():
    assert place_photos.pick_image_url(HITS, "Regaleira") is None


# ---- search


def test_search_asks_tavily_for_images_with_descriptions():
    client = _FakeClient([_images({"url": "https://e.com/a.jpg", "title": "t", "description": "d"})])
    with patch.dict(os.environ, KEY):
        hits = place_photos.search_images("Café Santiago", "francesinha in Porto", client=client)
    call = client.calls[0]
    assert call["url"] == web_search_facts.TAVILY_SEARCH_URL
    assert call["json"]["include_images"] is True
    assert call["json"]["include_image_descriptions"] is True
    assert call["json"]["query"] == "Café Santiago francesinha in Porto"
    assert call["headers"]["Authorization"] == "Bearer tvly-test-key"
    assert hits == [{"url": "https://e.com/a.jpg", "title": "t", "description": "d"}]


def test_search_keeps_only_well_formed_image_items():
    client = _FakeClient([_images("https://x.com/a.jpg", 7, {"title": "no url"}, {"url": "https://e.com/b.jpg"})])
    with patch.dict(os.environ, KEY):
        hits = place_photos.search_images("Café Santiago", "s", client=client)
    assert hits == [
        {"url": "https://x.com/a.jpg", "title": "", "description": ""},
        {"url": "https://e.com/b.jpg", "title": "", "description": ""},
    ]


# ---- download


def test_download_writes_an_image_after_the_ssrf_checks(tmp_path):
    session = _Session(_jpeg())
    with patch.object(ssrf, "_resolve_global_ips", return_value=PUBLIC_IP):
        path = place_photos.download_image("https://example.com/a.jpg", str(tmp_path / "a.raw"), session=session)
    assert os.path.getsize(path) > 0


def test_download_rejects_a_private_address_without_fetching(tmp_path):
    session = _Session(b"x")
    with patch.object(ssrf, "_resolve_global_ips", return_value=[ipaddress.ip_address("10.0.0.5")]):
        with pytest.raises(ssrf.UnsafeUrlError):
            place_photos.download_image("https://internal.example/a.jpg", str(tmp_path / "a.raw"), session=session)
    assert session.urls == []


def test_download_rejects_non_images(tmp_path):
    session = _Session(b"<html>", content_type="text/html")
    with patch.object(ssrf, "_resolve_global_ips", return_value=PUBLIC_IP):
        with pytest.raises(ssrf.UnsafeUrlError):
            place_photos.download_image("https://example.com/a", str(tmp_path / "a.raw"), session=session)


def test_download_rejects_oversized_photos(tmp_path):
    session = _Session(_jpeg())
    with patch.object(ssrf, "_resolve_global_ips", return_value=PUBLIC_IP), patch.object(
        place_photos, "MAX_PHOTO_BYTES", 100
    ):
        with pytest.raises(ssrf.UnsafeUrlError):
            place_photos.download_image("https://example.com/a.jpg", str(tmp_path / "a.raw"), session=session)


# ---- portrait still


def test_a_landscape_photo_becomes_a_full_portrait_still(tmp_path):
    source = tmp_path / "p.jpg"
    Image.new("RGB", (1200, 800), (10, 120, 200)).save(source)
    out = place_photos.compose_portrait_still(str(source), str(tmp_path / "still.jpg"), VideoAspect.portrait)
    assert out == str(tmp_path / "still.jpg")
    assert Image.open(out).size == (1080, 1920)


@pytest.mark.parametrize(
    "size",
    [(300, 200), (500, 500), (1200, 200)],
    ids=["thumbnail", "long edge too short", "short edge too short"],
)
def test_small_or_sliver_photos_are_rejected(tmp_path, size):
    source = tmp_path / "p.jpg"
    Image.new("RGB", size).save(source)
    assert place_photos.compose_portrait_still(str(source), str(tmp_path / "s.jpg"), VideoAspect.portrait) == ""


def test_decompression_bombs_are_rejected(tmp_path):
    source = tmp_path / "p.jpg"
    Image.new("RGB", (1200, 800)).save(source)
    with patch.object(place_photos, "MAX_PHOTO_PIXELS", 1000):
        assert place_photos.compose_portrait_still(str(source), str(tmp_path / "s.jpg"), VideoAspect.portrait) == ""


def test_an_unreadable_file_is_rejected(tmp_path):
    source = tmp_path / "p.jpg"
    source.write_bytes(b"not an image")
    assert place_photos.compose_portrait_still(str(source), str(tmp_path / "s.jpg"), VideoAspect.portrait) == ""


# ---- preparation (orchestration)


def _prepare(tmp_path, responses, session=None, face=False, section=ENABLED, env=KEY, words=WORDS, window=None):
    client = _FakeClient(responses)
    session = session or _Session(_jpeg())
    params = VideoParams(video_subject=SUBJECT, faceless_material="svg")
    with (
        patch.dict(os.environ, env),
        patch.object(web_search_facts, "_search_section", section),
        patch.object(place_photos.utils, "task_dir", return_value=str(tmp_path)),
        patch.object(place_photos.subtitle, "file_to_words", return_value=words),
        patch.object(ssrf, "_resolve_global_ips", return_value=PUBLIC_IP),
        patch.object(place_photos.face_detect, "image_contains_face", return_value=face),
        patch.object(place_photos, "track_event") as track,
    ):
        photos = place_photos.prepare_photos(
            "photo-task", params, SCRIPT, "sub.srt", 30.0, window=window, client=client, session=session
        )
    return photos, client, track


def test_named_places_get_a_prepared_photo(tmp_path):
    photos, client, track = _prepare(tmp_path, [_images(SANTIAGO), _images()])
    assert [p.name for p in photos] == ["Café Santiago"]
    assert photos[0].seconds == 6.0 and photos[0].source_host == "e.com"
    assert Image.open(photos[0].still_path).size == (1080, 1920)
    # video_loop recognizes photo clips by this prefix (their clip is <still>.mp4).
    assert os.path.basename(photos[0].still_path).startswith(PHOTO_FILE_PREFIX)
    assert len(client.calls) == 2
    track.assert_called_once_with("place_photos", {"names": 2, "photos": 1})


def test_a_failing_search_only_costs_that_name_its_photo(tmp_path):
    ribeira = {"url": "https://e.com/ribeira.jpg", "title": "Ribeira", "description": "Ribeira riverside"}
    photos, _, _ = _prepare(tmp_path, [RuntimeError("tavily down"), _images(ribeira)])
    assert [p.name for p in photos] == ["Ribeira"]
    assert photos[0].seconds == 7.5


def test_switched_off_means_no_search_at_all(tmp_path):
    photos, client, track = _prepare(tmp_path, [], section={"enabled": True})
    assert photos == [] and client.calls == []
    track.assert_not_called()


def test_a_missing_tavily_key_means_no_photos(tmp_path):
    photos, client, _ = _prepare(tmp_path, [], env={"TAVILY_API_KEY": ""})
    assert photos == [] and client.calls == []


def test_a_photo_with_a_face_is_skipped(tmp_path):
    photos, _, _ = _prepare(tmp_path, [_images(SANTIAGO), _images()], face=True)
    assert photos == []


def test_a_failed_download_is_skipped(tmp_path):
    photos, _, _ = _prepare(tmp_path, [_images(SANTIAGO), _images()], session=_Session(b"", status=403))
    assert photos == []


def test_an_image_that_does_not_name_the_place_is_skipped(tmp_path):
    other = {"url": "https://e.com/x.jpg", "title": "Street", "description": "A street"}
    photos, _, _ = _prepare(tmp_path, [_images(other), _images(other)])
    assert photos == []


def test_a_thumbnail_is_skipped(tmp_path):
    photos, _, _ = _prepare(tmp_path, [_images(SANTIAGO), _images()], session=_Session(_jpeg(300, 200)))
    assert photos == []


def test_an_unexpected_error_never_escapes(tmp_path):
    with patch.object(place_photos.utils, "task_dir", side_effect=RuntimeError("disk gone")), patch.object(
        web_search_facts, "_search_section", ENABLED
    ), patch.dict(os.environ, KEY), patch.object(place_photos.subtitle, "file_to_words", return_value=WORDS):
        photos = place_photos.prepare_photos(
            "t", VideoParams(video_subject=SUBJECT, faceless_material="svg"), SCRIPT, "s.srt", 30.0
        )
    assert photos == []


# ---- the window (persona videos keep their face intro and outro)


def test_mentions_before_the_window_are_skipped_and_not_searched(tmp_path):
    # Café Santiago is said at 6.0s, Ribeira at 7.5s: a window opening at 7.0s
    # (the lip-sync intro still on screen) leaves only Ribeira.
    ribeira = {"url": "https://e.com/ribeira.jpg", "title": "Ribeira", "description": "Ribeira riverside"}
    photos, client, track = _prepare(tmp_path, [_images(ribeira)], window=(7.0, 30.0))
    assert [p.name for p in photos] == ["Ribeira"]
    assert len(client.calls) == 1
    track.assert_called_once_with("place_photos", {"names": 1, "photos": 1})


def test_mentions_after_the_window_are_skipped(tmp_path):
    # A window closing at 7.0s (the face outro starts) leaves only Café Santiago.
    photos, client, _ = _prepare(tmp_path, [_images(SANTIAGO)], window=(0.0, 7.0))
    assert [p.name for p in photos] == ["Café Santiago"]
    assert len(client.calls) == 1


def test_the_window_edges_are_inclusive(tmp_path):
    photos, _, _ = _prepare(tmp_path, [_images(SANTIAGO)], window=(6.0, 6.0))
    assert [p.name for p in photos] == ["Café Santiago"]


# ---- splicing into the final material list


PHOTO = PreparedPhoto("Café Santiago", "/t/place-photo-0.jpg", 11.0, "e.com")


def _splice(clips, photos, clip_seconds=5, durations=None, rendered="photo.mp4"):
    durations = durations or {clip: 5.0 for clip in clips}

    def probe(path):
        value = durations[path]
        if isinstance(value, Exception):
            raise value
        return value

    with patch.object(place_photos.audio_trim, "media_duration", side_effect=probe), patch.object(
        place_photos.image_material, "render_image_file_to_mp4", return_value=rendered
    ) as render:
        return place_photos.splice_photos(clips, photos, clip_seconds), render


def test_a_photo_replaces_the_clip_nearest_to_its_mention():
    clips = ["a.mp4", "b.mp4", "c.mp4", "d.mp4"]
    out, render = _splice(clips, [PHOTO])
    assert out == ["a.mp4", "b.mp4", "photo.mp4", "d.mp4"]
    render.assert_called_once_with("/t/place-photo-0.jpg", clip_duration=5)
    assert clips == ["a.mp4", "b.mp4", "c.mp4", "d.mp4"]


def test_the_real_clip_durations_decide_the_slot():
    # Stock clips differ in length: they start at 0, 2, 4 and 9; 8s is slot 3.
    clips = ["a.mp4", "b.mp4", "c.mp4", "d.mp4"]
    durations = {"a.mp4": 2.0, "b.mp4": 2.0, "c.mp4": 5.0, "d.mp4": 5.0}
    photo = PreparedPhoto("Café Santiago", "/t/place-photo-0.jpg", 8.0, "e.com")
    out, _ = _splice(clips, [photo], durations=durations)
    assert out == ["a.mp4", "b.mp4", "c.mp4", "photo.mp4"]


def test_a_clip_longer_than_the_clip_length_counts_only_its_first_seconds():
    # combine_videos takes the first max_clip_duration seconds of each file.
    clips = ["a.mp4", "b.mp4", "c.mp4"]
    durations = {"a.mp4": 30.0, "b.mp4": 30.0, "c.mp4": 30.0}
    photo = PreparedPhoto("Café Santiago", "/t/place-photo-0.jpg", 10.0, "e.com")
    out, _ = _splice(clips, [photo], durations=durations)
    assert out == ["a.mp4", "b.mp4", "photo.mp4"]


def test_a_photo_that_fails_to_render_leaves_the_clip_in_place():
    clips = ["a.mp4", "b.mp4", "c.mp4", "d.mp4"]
    out, _ = _splice(clips, [PHOTO], rendered="")
    assert out == clips


def test_two_photos_never_take_the_same_slot():
    clips = ["a.mp4", "b.mp4", "c.mp4", "d.mp4"]
    later = PreparedPhoto("Ribeira", "/t/place-photo-1.jpg", 11.5, "e.com")
    with patch.object(place_photos.audio_trim, "media_duration", return_value=5.0), patch.object(
        place_photos.image_material, "render_image_file_to_mp4", side_effect=["p1.mp4", "p2.mp4"]
    ):
        out = place_photos.splice_photos(clips, [PHOTO, later], 5)
    assert out == ["a.mp4", "b.mp4", "p1.mp4", "p2.mp4"]


def test_an_unreadable_clip_counts_as_a_full_clip():
    clips = ["a.mp4", "b.mp4", "c.mp4", "d.mp4"]
    durations = {"a.mp4": 5.0, "b.mp4": RuntimeError("ffprobe failed"), "c.mp4": 5.0, "d.mp4": 5.0}
    out, _ = _splice(clips, [PHOTO], durations=durations)
    assert out == ["a.mp4", "b.mp4", "photo.mp4", "d.mp4"]


def test_the_photo_clip_lasts_a_whole_number_of_seconds():
    out, render = _splice(["a.mp4", "b.mp4"], [PHOTO], clip_seconds=4.6)
    assert render.call_args.kwargs["clip_duration"] == 5
    assert len(out) == 2


def test_nothing_to_splice_leaves_the_list_alone():
    clips = ["a.mp4", "b.mp4"]
    out, render = _splice(clips, [])
    assert out == clips
    out, render = _splice(clips, [PHOTO], clip_seconds=0)
    assert out == clips
    render.assert_not_called()

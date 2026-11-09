"""user_media with the images material: photos cover the whole audio, none left fails."""

import io
import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from PIL import Image

from app.services import image_coverage, place_photos, segment_panels, user_media

# Hook spoken 0.0-1.2 s, CTA 5.0-5.9 s, audio 6.0 s.
WORDS = [("Welcome", 0.0, 0.5), ("to", 0.5, 0.7), ("Porto", 0.7, 1.2), ("Visit", 5.0, 5.4), ("Porto", 5.4, 5.9)]
SEGMENTS = [
    {"kind": "hook", "text": "Welcome to Porto.", "media": [{"url": "https://e.com/hook.jpg"}]},
    {"kind": "cta", "text": "Visit Porto.", "media": [{"url": "https://e.com/cta.jpg"}]},
]


def _subtitle(tmp_path):
    path = str(tmp_path / "subtitle.srt")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("1\n00:00:00,000 --> 00:00:06,000\nPorto\n\n")
    with open(f"{path}.words.json", "w", encoding="utf-8") as handle:
        json.dump([[text, start, end] for text, start, end in WORDS], handle)
    return path


def _download(url, dest_path, session=None):
    buffer = io.BytesIO()
    Image.new("RGB", (1200, 800), (200, 30, 30)).save(buffer, "JPEG")
    with open(dest_path, "wb") as handle:
        handle.write(buffer.getvalue())
    return dest_path



@pytest.fixture
def task_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(segment_panels.utils, "task_dir", lambda task_id: str(tmp_path))
    monkeypatch.setattr(user_media.utils, "task_dir", lambda task_id: str(tmp_path))
    return tmp_path


def _params(material, segments=SEGMENTS):
    return SimpleNamespace(
        video_aspect="9:16", font_name="x.ttf", segments=segments, persona=None,
        faceless_material=material, video_script="\n\n".join(s["text"] for s in segments),
    )


def _run(task_dir, params, download=_download):
    with patch.object(place_photos, "download_image", side_effect=download), patch(
        "app.services.user_media.face_detect.image_contains_face", return_value=False
    ):
        return user_media.prepare_segment_panels("task-1", params, _subtitle(task_dir), 6.0)


def test_images_material_photos_cover_the_whole_audio_and_zoom(task_dir):
    warnings = _run(task_dir, _params("images"))
    panels, stored = segment_panels._read_manifest("task-1")
    assert [(p.index, p.start, p.end, p.motion) for p in panels] == [(0, 0.0, 5.0, "in"), (1, 5.0, 6.0, "out")]
    # The hook photo runs on over the 3.8 s silence before the CTA: worth a warning.
    assert warnings == ["segment 0 image extended: a neighbour image covers a missing image"]
    assert stored == warnings


def test_broll_material_keeps_photos_to_their_spoken_seconds_without_zoom(task_dir):
    assert _run(task_dir, _params("broll")) == []
    panels, _ = segment_panels._read_manifest("task-1")
    assert [(p.index, p.start, p.end, p.motion) for p in panels] == [(0, 0.0, 1.2, None), (1, 5.0, 5.9, None)]


def test_a_dropped_photo_keeps_its_skip_warning_and_the_neighbour_covers_it(task_dir):
    def only_cta(url, dest_path, session=None):
        if "hook" in url:
            raise OSError("blocked")
        return _download(url, dest_path, session)

    warnings = _run(task_dir, _params("images"), download=only_cta)
    panels, _ = segment_panels._read_manifest("task-1")
    assert [(p.index, p.start, p.end) for p in panels] == [(1, 0.0, 6.0)]
    assert warnings[0].startswith("segment 0 image 0 media skipped: ")
    assert warnings[1:] == ["segment 1 image extended: a neighbour image covers a missing image"]


def test_no_surviving_photo_fails_the_images_material_without_writing_a_manifest(task_dir):
    def refuse(url, dest_path, session=None):
        raise OSError("blocked")

    with pytest.raises(image_coverage.ImagesDoNotCoverAudio):
        _run(task_dir, _params("images"), download=refuse)
    assert segment_panels._read_manifest("task-1") == ([], [])


def test_hook_persona_coverage_starts_where_the_face_hands_over(task_dir):
    params = _params("images")
    with patch.object(user_media, "_face_mode", return_value=segment_panels.FACE_HOOK), patch.object(
        user_media, "_hook_end", return_value=1.5
    ) as hook_end:
        _run(task_dir, params)
    hook_end.assert_called()
    panels, _ = segment_panels._read_manifest("task-1")
    framed = [p for p in panels if p.caption_bottom is not None]
    full = [p for p in panels if p.caption_bottom is None]
    assert [(p.index, p.start, p.end, p.motion) for p in framed] == [(0, 0.0, 1.2, None)], "the hook panel never moves"
    assert [(p.index, p.start, p.end) for p in full] == [(1, 1.5, 6.0)]


def test_full_lipsync_has_nothing_to_cover_and_never_fails(task_dir):
    def refuse(url, dest_path, session=None):
        raise OSError("blocked")

    with patch.object(user_media, "_face_mode", return_value=segment_panels.FACE_FULL):
        warnings = _run(task_dir, _params("images"), download=refuse)
    assert len(warnings) == 2 and all("media skipped" in w for w in warnings)

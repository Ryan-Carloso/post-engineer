"""Photos join the final material list of EVERY video type.

They used to be injected as search terms, which only works for drawings:
stock footage downloads in rounds, so a term's position is not its time on the
timeline. The photo now replaces the clip nearest to the spoken name in the
list that combine_videos receives, for drawings, stock footage and persona
videos alike.
"""

import inspect
from unittest.mock import patch

from app.models.schema import VideoParams
from app.services import svg_terms
from app.services import task as tm
from app.services.place_names import PreparedPhoto

PHOTO = PreparedPhoto("Café Santiago", "/t/place-photo-0.jpg", 20.0, "e.com")
TERMS = [f"path:{n}.svg" for n in range(10)]
CLIPS = ["a.mp4", "b.mp4", "c.mp4", "d.mp4"]


def _materials(params, photos=None):
    with patch.object(tm.material, "download_videos", return_value=list(CLIPS)), patch.object(
        tm.svg_terms, "report_coverage"
    ), patch.object(
        tm.place_photos, "splice_photos", side_effect=lambda clips, found, seconds: ["spliced.mp4"]
    ) as splice:
        if photos is None:
            result = tm.get_video_materials("wire-task", params, TERMS, 30)
        else:
            result = tm.get_video_materials("wire-task", params, TERMS, 30, photos)
    return result, splice


def test_drawing_videos_get_their_photos_spliced_into_the_downloaded_clips():
    params = VideoParams(video_subject="x", faceless_material="svg")
    result, splice = _materials(params, [PHOTO])
    assert result == ["spliced.mp4"]
    splice.assert_called_once_with(CLIPS, [PHOTO], svg_terms.clip_seconds(params, len(CLIPS), 30))


def test_stock_videos_get_their_photos_too():
    params = VideoParams(video_subject="x", faceless_material="broll", video_clip_duration=3)
    result, splice = _materials(params, [PHOTO])
    assert result == ["spliced.mp4"]
    splice.assert_called_once_with(CLIPS, [PHOTO], 3)


def test_without_photos_nothing_is_probed_or_spliced():
    result, splice = _materials(VideoParams(video_subject="x", faceless_material="svg"))
    assert result == CLIPS
    splice.assert_not_called()


def test_there_is_no_photo_term_plumbing_left():
    source = inspect.getsource(tm.get_video_materials)
    assert "inject_photo_terms" not in source


def test_photos_are_prepared_after_the_subtitle_for_every_video_type():
    source = inspect.getsource(tm.start)
    prepare = source.index("place_photos.prepare_photos(")
    assert source.index("subtitle_path = generate_subtitle(") < prepare < source.index("get_video_materials(")
    before = source[prepare - 600:prepare]
    # Persona videos keep their face intro and outro: photos fit between them.
    assert "persona_lipsync_active(params)" in before
    assert "PERSONA_LIPSYNC_MAX_SECONDS" in before
    assert "FACE_FILL_MAX_SECONDS" in before
    # Random concatenation scrambles the timeline: a photo's moment is lost.
    assert "match_materials_to_script" in before
    assert 'faceless_material != "svg"' not in source[prepare - 600:prepare + 400]

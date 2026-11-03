"""user_media on persona videos: the panel goes at the bottom, so captions stay above it.

A panel is an overlay on the finished video, so it works the same over a
hook-only lip-sync intro, over a full lip-sync render and over stock. Where
the persona's face shows, the photo is a panel anchored to the bottom edge,
so the captions above it never cover the photo.
"""

import inspect

from app.models.schema import PersonaParams, TaskVideoRequest, VideoLayout
from app.services import segment_panels, user_media
from app.services import task as tm

SEGMENTS = [
    {"kind": "hook", "text": "Welcome to Porto where the river meets the sea and every bridge tells a story of trade and wine for sure."},
    {"kind": "body", "text": "Walk the Ribeira in the morning light, cross the Dom Luis bridge, taste francesinha where the locals eat, and finish with port wine as the river turns gold before heading home through the old town streets."},
    {"kind": "cta", "text": "Follow for more Porto walks."},
]


def _persona():
    return PersonaParams(name="Ana", avatar_url="https://example.com/a.png", voice_id="calm")


def _request(**overrides):
    values = dict(video_subject="Porto", segments=SEGMENTS, video_script="\n\n".join(s["text"] for s in SEGMENTS))
    values.update(overrides)
    return TaskVideoRequest(**values)


def test_persona_panel_sits_at_the_bottom_in_every_layout():
    # The photo is inset where the face shows: bottom-anchored, so the
    # captions above it never cover the photo.
    for layout in (VideoLayout.standard, VideoLayout.react, "react"):
        for full in (False, True):
            params = _request(persona=_persona(), video_layout=layout, full_lipsync=full)
            assert user_media._face_mode(params) != segment_panels.FACE_NONE
            assert segment_panels.panel_rect(1080, 1920)[1] == 1160


def test_faceless_video_shows_the_photo_full_frame():
    assert user_media._face_mode(_request()) == segment_panels.FACE_NONE


def test_start_draws_the_panels_at_the_materials_stage_and_overlays_them_when_assembling():
    start = inspect.getsource(tm.start)
    assert "user_media.prepare_segment_panels(" in start
    assert "apply_segment_media" not in start
    assert "downloaded_videos, media_warnings" not in start
    final = inspect.getsource(tm.generate_final_videos)
    overlay = final.index("segment_panels.overlay_onto(")
    # After the persona intro or the full lip-sync render, before the subtitles are burned in.
    assert final.index("full_lipsync.render_full_lipsync(") < overlay < final.index("video.generate_video(")
    assert final.index("prepare_persona_lipsync_video(") < overlay
    assert "_update_task)" in final[overlay : overlay + 140], "the render failure is recorded on the task"


def test_final_encode_keeps_the_captions_above_each_panel():
    final = inspect.getsource(tm.generate_final_videos)
    assert "caption_bands=segment_panels.caption_bands(task_id)" in final

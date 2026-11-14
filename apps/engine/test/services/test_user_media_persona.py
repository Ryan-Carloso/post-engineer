"""user_media on persona videos: the panel goes at the bottom, so captions stay above it.

A panel is an overlay on the finished video, so it works the same over a
hook-only lip-sync intro, over a full lip-sync render and over the agent's images. Where
the persona's face shows, the photo is a panel anchored to the bottom edge,
so the captions above it never cover the photo.
"""

import inspect

from app.models.schema import PersonaParams, TaskVideoRequest, VideoLayout
from app.services import segment_panels, user_media
from app.services import task as tm

SEGMENTS = [
    {"kind": "hook", "text": "Welcome to Porto where the river meets the sea and every bridge tells a story of trade and wine for sure.", "media": [{"url": f"https://e.com/h{i}.jpg"} for i in range(3)]},
    {"kind": "content", "text": "Walk the Ribeira in the morning light, cross the Dom Luis bridge, taste francesinha where the locals eat, and finish with port wine as the river turns gold before heading home through the old town streets.", "media": [{"url": f"https://e.com/b{i}.jpg"} for i in range(5)]},
    {"kind": "content", "text": "Follow for more Porto walks.", "media": [{"url": "https://e.com/c0.jpg"}]},
]


def _persona():
    return PersonaParams(name="Ana", avatar_url="https://example.com/a.png", voice_id="calm")


def _request(**overrides):
    full = overrides.pop("full_lipsync", False) is True
    values = dict(
        video_title="Porto",
        video_description="Test description.",
        video_type=(
            "full_lipsync"
            if full
            else "hook_lipsync"
            if overrides.get("persona") is not None
            else "faceless"
        ),
        segments=SEGMENTS,
        video_script="\n\n".join(s["text"] for s in SEGMENTS),
    )
    values.update(overrides)
    return TaskVideoRequest(**values)


def test_persona_panel_sits_at_the_bottom_in_every_layout():
    # The photo is inset where the face shows: bottom-anchored, so the
    # captions above it never cover the photo.
    for layout in (VideoLayout.standard, VideoLayout.react, "react"):
        for full in (False, True):
            # Full lip sync caps media at 6 photos for the whole video,
            # so its segments carry none.
            segments = SEGMENTS
            if full:
                segments = [{k: v for k, v in s.items() if k != "media"} for s in SEGMENTS]
            params = _request(persona=_persona(), video_layout=layout, full_lipsync=full, segments=segments)
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

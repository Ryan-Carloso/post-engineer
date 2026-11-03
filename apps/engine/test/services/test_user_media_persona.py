"""user_media on persona videos: the panel goes over the face, and below it in the react layout.

A panel is an overlay on the finished video, so it works the same over a
hook-only lip-sync intro, over a full lip-sync render and over stock. The
only thing the persona changes is where the panel sits: the react layout
fills the top half with the persona, so the panel anchors to the bottom.
"""

import inspect
from types import SimpleNamespace

import pytest

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


def test_faceless_video_anchors_the_panel_at_the_top():
    assert user_media._anchor(_request()) == segment_panels.ANCHOR_TOP


def test_hook_only_persona_in_the_standard_layout_anchors_at_the_top():
    assert user_media._anchor(_request(persona=_persona(), video_layout=VideoLayout.standard)) == segment_panels.ANCHOR_TOP


def test_hook_only_persona_in_the_react_layout_anchors_at_the_bottom_below_the_persona():
    params = _request(persona=_persona(), video_layout=VideoLayout.react)
    assert user_media._anchor(params) == segment_panels.ANCHOR_BOTTOM


def test_full_lipsync_ignores_the_react_layout_because_the_face_fills_the_frame():
    params = _request(persona=_persona(), video_layout=VideoLayout.react, full_lipsync=True)
    assert user_media._anchor(params) == segment_panels.ANCHOR_TOP


def test_react_layout_without_a_lipsync_face_keeps_the_top():
    assert user_media._anchor(_request(video_layout=VideoLayout.react)) == segment_panels.ANCHOR_TOP
    params = _request(persona=_persona(), video_layout=VideoLayout.react, lipsync_enabled=False)
    assert user_media._anchor(params) == segment_panels.ANCHOR_TOP


@pytest.mark.parametrize("layout", [None, "standard", "react", VideoLayout.react])
def test_anchor_accepts_the_layout_as_a_string_an_enum_or_nothing(layout):
    params = SimpleNamespace(video_layout=layout, persona=None, full_lipsync=False)
    assert user_media._anchor(params) == segment_panels.ANCHOR_TOP


def test_react_layout_anchor_survives_a_plain_string_layout():
    params = _request(persona=_persona())
    params.video_layout = "react"
    assert user_media._anchor(params) == segment_panels.ANCHOR_BOTTOM


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

"""Svg drawings keep their full 4-6s clip all the way to the final video.

The material step renders each drawing as a 4-6s clip, but
combine_videos cut every clip at params.video_clip_duration (2s): only the
first half of each pencil draw reached the video, and the few drawings
looped. Both steps must use the same svg clip length.
"""

from unittest.mock import patch

from app.models.schema import VideoParams
from app.services import task as tm


def _combine_kwargs(material):
    params = VideoParams(video_subject="x", faceless_material=material, video_clip_duration=2)
    with (
        patch.object(tm.sm.state, "get_task", return_value={"user_id": "u1"}),
        patch.object(tm.sm.state, "update_task"),
        patch.object(tm.history_repository, "recent", return_value=[]),
        patch.object(tm.video, "combine_videos") as combine,
        patch.object(tm.video, "generate_video"),
        patch.object(tm.voice, "get_audio_duration", return_value=5.0),
    ):
        tm.generate_final_videos(
            task_id="svg-clip",
            params=params,
            downloaded_videos=["c1.mp4"],
            audio_file="a.mp3",
            subtitle_path="s.srt",
            video_script="script",
            music_mood="calm",
        )
    return combine.call_args.kwargs


def test_svg_clips_are_combined_at_their_full_length():
    # One drawing for 5s of audio: a 5s clip, inside the 4-6s range.
    assert _combine_kwargs("svg")["max_clip_duration"] == 5


def test_stock_clips_keep_the_requested_length():
    assert _combine_kwargs("broll")["max_clip_duration"] == 2


def test_svg_terms_are_fitted_to_the_audio_before_download():
    import inspect

    source = inspect.getsource(tm.get_video_materials)
    assert source.index("svg_terms.fit_to_audio(video_terms, audio_duration)") < source.index(
        "material.download_videos("
    )

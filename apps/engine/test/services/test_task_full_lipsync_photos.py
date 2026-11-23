"""generate_final_videos wires the full lip-sync face photos into the render.

The full branch must render from lipsync_photos.resolve_lipsync_photos, in
window order, never from the hook image path (resolve_persona_image).
"""

import unittest
from unittest.mock import patch

from app.models.schema import PersonaParams, VideoParams
from app.services import task as tm


class FullLipsyncPhotosWiringTests(unittest.TestCase):
    def test_full_branch_renders_from_the_lipsync_photos(self):
        params = VideoParams(
            video_title="test",
            video_description="Test description.",
            video_type="full_lipsync",
            persona=PersonaParams(name="Ana", photo_url="https://img.test/p.png", voice_id="calm"),
            lipsync_photos=[{"url": "https://img.test/a.png"}, {"url": "https://img.test/b.png"}],
        )
        photos = ["/task/lipsync-photo-0.png", "/task/lipsync-photo-1.png"]
        with (
            patch.object(tm.sm.state, "get_task", return_value={"user_id": "alice"}),
            patch.object(tm.history_repository, "recent", return_value=[]),
            patch.object(tm, "_update_task"),
            patch.object(tm.video, "combine_videos"),
            patch.object(tm.voice, "get_audio_duration", return_value=30.0),
            patch.object(tm.subtitle, "file_to_subtitles", return_value=[]),
            patch.object(tm.segment_panels, "overlay_onto", side_effect=lambda _t, path, _u: path),
            patch.object(tm.lipsync_photos, "resolve_lipsync_photos", return_value=photos) as resolve,
            patch.object(tm.full_lipsync, "resolve_persona_image") as hook_image,
            patch.object(
                tm.full_lipsync, "render_full_lipsync", return_value=("/task/full.mp4", 1.5, ["job-1"])
            ) as render,
            patch.object(tm.video, "generate_video") as generate_video,
        ):
            _final, _combined, report = tm.generate_final_videos(
                "full-photos", params, ["clip.mp4"], "voice.mp3", "sub.srt", "script", "none"
            )
        resolve.assert_called_once_with("full-photos", params)
        hook_image.assert_not_called()
        self.assertEqual(render.call_args.kwargs["image_paths"], photos)
        self.assertEqual(generate_video.call_args.kwargs["video_path"], "/task/full.mp4")
        self.assertTrue(report.ran)
        self.assertEqual(report.job_id, "job-1")


if __name__ == "__main__":
    unittest.main()

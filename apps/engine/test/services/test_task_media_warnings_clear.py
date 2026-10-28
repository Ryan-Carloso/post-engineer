"""A segments retry must not keep the previous attempt's skip warnings.

``_update_task`` merges into the task row on every backend (memory dict
merge, Redis per-field hset, Supabase read-modify-write), and a requeue
reuses the same task id (deterministic batch id, direct redispatch). So
a task that recorded skips on the attempt that crashed, then requeues
and renders every photo, would keep showing skip warnings for a video
that contains all its photos — unless the materials stage writes the
(empty) warning list on every segments run, not only when non-empty.
"""

import unittest
from contextlib import ExitStack
from unittest.mock import patch

from app.models.schema import TaskVideoRequest, VideoParams
from app.services import task as tm

SEGMENTS = [
    {
        "kind": "hook",
        "text": "Porto is the city that wins you over slowly, one riverside morning and one golden sunset at a time.",
    },
    {
        "kind": "body",
        "text": "Walk the Ribeira in the morning light, cross the Dom Luis bridge, taste francesinha where the locals eat, and finish with port wine as the river turns gold at sunset before heading home through the old town streets.",
    },
    {"kind": "cta", "text": "Follow for more Porto walks every week."},
]


class MediaWarningsClearTests(unittest.TestCase):
    """tm.start(stop_at='materials') writes media_warnings every segments run."""

    def _run_to_materials(self, params, apply_result):
        writes = []
        with ExitStack() as stack:
            stack.enter_context(patch.object(tm.sm.state, "update_task"))
            stack.enter_context(patch.object(tm, "send_discord"))
            stack.enter_context(
                patch.object(tm.video_storage, "require_r2_configuration")
            )
            stack.enter_context(patch.object(tm, "cleanup_task_intermediates"))
            stack.enter_context(patch.object(tm, "track_generation_started"))
            stack.enter_context(patch.object(tm, "_complete_task"))
            stack.enter_context(
                patch.object(tm, "_update_task", side_effect=lambda tid, **kw: writes.append(kw))
            )
            stack.enter_context(
                patch.object(tm, "generate_script", return_value="script text")
            )
            stack.enter_context(
                patch.object(tm, "generate_terms", return_value="terms")
            )
            stack.enter_context(patch.object(tm, "save_script_data"))
            stack.enter_context(
                patch.object(
                    tm, "generate_audio", return_value=("audio.mp3", 10.0, None)
                )
            )
            stack.enter_context(
                patch.object(tm, "generate_subtitle", return_value="sub.srt")
            )
            stack.enter_context(
                patch.object(tm.audio_trim, "trim_after_last_word", return_value=None)
            )
            stack.enter_context(
                patch.object(
                    tm,
                    "_ensure_persona_hook_fits",
                    side_effect=lambda tid, p, s, a, d, sm, sp: (s, a, d, sm, sp),
                )
            )
            stack.enter_context(
                patch.object(tm, "get_video_materials", return_value=["clip.mp4"])
            )
            stack.enter_context(
                patch.object(tm.user_media, "apply_segment_media", return_value=apply_result)
            )
            tm.start(task_id="task-warnings", params=params, stop_at="materials")
        return writes

    def test_clean_segments_retry_clears_the_previous_warnings(self):
        params = TaskVideoRequest(video_subject="Porto walks", segments=SEGMENTS)
        writes = self._run_to_materials(params, (["clip.mp4"], []))
        warning_writes = [w for w in writes if "media_warnings" in w]
        self.assertEqual(warning_writes, [{"media_warnings": []}])

    def test_skips_are_still_recorded_when_present(self):
        params = TaskVideoRequest(video_subject="Porto walks", segments=SEGMENTS)
        skipped = ["segment 1 media skipped: bad url"]
        writes = self._run_to_materials(params, (["clip.mp4"], skipped))
        warning_writes = [w for w in writes if "media_warnings" in w]
        self.assertEqual(warning_writes, [{"media_warnings": skipped}])

    def test_no_segments_run_writes_no_media_warnings(self):
        params = VideoParams(video_subject="Porto walks")
        writes = self._run_to_materials(params, (["clip.mp4"], []))
        self.assertEqual([w for w in writes if "media_warnings" in w], [])


if __name__ == "__main__":
    unittest.main()

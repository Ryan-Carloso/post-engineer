"""tm.start with the images material: only the neutral canvas renders; no photo fails."""

import unittest
from contextlib import ExitStack
from unittest.mock import ANY, patch

from app.models.schema import TaskVideoRequest
from app.services import image_coverage
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


def _photos(count, prefix):
    return [{"url": f"https://e.com/{prefix}{i}.jpg"} for i in range(count)]


def _params():
    # Images mode needs about one photo per 3s (hook 19 words → 3, body 38 → 5, CTA 7 → 1).
    counts = (3, 5, 1)
    segments = []
    for index, segment in enumerate(SEGMENTS):
        copied = dict(segment)
        if counts[index]:
            copied["media"] = _photos(counts[index], f"{index}-")
        segments.append(copied)
    return TaskVideoRequest(
        video_title="Porto walks",
        video_description="Test description.",
        video_type="faceless",
        segments=segments,
        voice_name="chatterbox:kokoro_af_heart",
    )


class ImagesMaterialStartTests(unittest.TestCase):
    def _run(self, params, panels=None, canvas=("/t/neutral.mp4",)):
        mocks = {}
        with ExitStack() as stack:
            stack.enter_context(patch.object(tm.sm.state, "update_task"))
            stack.enter_context(patch.object(tm, "send_discord"))
            stack.enter_context(patch.object(tm.video_storage, "require_r2_configuration"))
            stack.enter_context(patch.object(tm, "track_generation_started"))
            stack.enter_context(patch.object(tm, "_update_task"))
            stack.enter_context(patch.object(tm, "save_script_data"))
            mocks["cleanup"] = stack.enter_context(patch.object(tm, "cleanup_task_intermediates"))
            mocks["complete"] = stack.enter_context(patch.object(tm, "_complete_task"))
            mocks["fail"] = stack.enter_context(patch.object(tm, "_fail_task"))
            stack.enter_context(patch.object(tm, "generate_script", return_value="script text"))
            stack.enter_context(
                patch.object(tm, "generate_audio", return_value=("audio.mp3", 10.0, None))
            )
            stack.enter_context(patch.object(tm, "generate_subtitle", return_value="sub.srt"))
            stack.enter_context(patch.object(tm.audio_trim, "task_local_copy", return_value=None))
            stack.enter_context(
                patch.object(
                    tm,
                    "_ensure_persona_hook_fits",
                    side_effect=lambda tid, p, s, a, d, sm, sp: (s, a, d, sm, sp),
                )
            )
            mocks["canvas"] = stack.enter_context(
                patch.object(tm.faceless_material, "images_canvas", return_value=list(canvas))
            )
            mocks["panels"] = stack.enter_context(
                patch.object(
                    tm.user_media, "prepare_segment_panels", **(panels or {"return_value": []})
                )
            )
            stack.enter_context(patch.object(tm.utils, "task_dir", return_value="/t"))
            tm.start(task_id="task-images", params=params, stop_at="materials")
        return mocks

    def test_images_material_renders_only_the_canvas(self):
        mocks = self._run(_params())
        mocks["canvas"].assert_called_once_with("/t", 10.0, "9:16")
        mocks["fail"].assert_not_called()
        mocks["complete"].assert_called_once_with("task-images", ANY, materials=["/t/neutral.mp4"])

    def test_a_canvas_that_cannot_render_fails_the_task(self):
        mocks = self._run(_params(), canvas=[])
        mocks["fail"].assert_called()
        self.assertEqual(
            mocks["fail"].call_args.args[:2], ("task-images", "failed to get video materials")
        )
        mocks["complete"].assert_not_called()

    def test_no_surviving_photo_fails_with_the_stable_code_at_the_materials_stage(self):
        mocks = self._run(_params(), panels={"side_effect": image_coverage.ImagesDoNotCoverAudio()})
        mocks["fail"].assert_called_once()
        args, kwargs = mocks["fail"].call_args
        self.assertEqual(args[:2], ("task-images", "images_do_not_cover_audio"))
        self.assertEqual(kwargs["stage"], "materials")
        mocks["complete"].assert_not_called()
        mocks["cleanup"].assert_called_with("task-images", ())

    def test_a_detailed_coverage_failure_reaches_the_task_error_verbatim(self):
        detail = (
            "no full-frame image survived; "
            "2 sent, 0 survived, 2 skipped (download blocked x2); "
            "segment 0 image 0 media skipped: download blocked"
        )
        mocks = self._run(
            _params(),
            panels={"side_effect": image_coverage.ImagesDoNotCoverAudio(detail)},
        )
        mocks["fail"].assert_called_once()
        args, _kwargs = mocks["fail"].call_args
        self.assertEqual(args[1], f"images_do_not_cover_audio: {detail}")
        mocks["complete"].assert_not_called()


if __name__ == "__main__":
    unittest.main()

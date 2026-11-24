"""Persona image preflight: a dead image URL fails the job at the start.

Before the preflight the image was downloaded only after the script, TTS
and material stages, so a 404/400 image failed the job late, after
spending LLM and TTS cost. These tests pin: the preflight only acts for an
active lip-sync persona, the download happens once per task, and a failed
download aborts start() before any generation stage runs.
"""

import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from app.models.schema import PersonaParams, TaskVideoRequest, VideoParams
from test.controllers.test_task_segments_request import valid_segments
from app.services import face_detect, full_lipsync, lipsync_photos, longcat, persona_preflight
from app.services import task as task_service
from app.utils import ssrf

_MAX_BYTES = 20 * 1024 * 1024


def _params(
    video_type: str = "hook_lipsync", photo: str | None = "https://img.test/p.png"
) -> VideoParams:
    return VideoParams(
        video_title="coffee",
        video_description="Test description.",
        video_type=video_type,
        video_script="Hook. Body. Call to action.",
        persona=PersonaParams(name="Ana", photo_url=photo, voice_id="chatterbox:kokoro_af_heart"),
    )


class PreflightPersonaImageTests(unittest.TestCase):
    def test_downloads_the_image_when_lipsync_is_active(self):
        with patch.object(
            full_lipsync, "resolve_persona_image", return_value="/t/img.png"
        ) as resolve:
            params = _params()
            persona_preflight.preflight_persona_image("task-1", params, _MAX_BYTES)
        resolve.assert_called_once_with("task-1", params, _MAX_BYTES)

    def test_full_lipsync_preflights_every_lipsync_photo_not_the_hook_image(self):
        params = _params(video_type="full_lipsync")
        with (
            patch.object(full_lipsync, "resolve_persona_image") as hook_image,
            patch.object(
                lipsync_photos, "resolve_lipsync_photos", return_value=["/t/0.png", "/t/1.png"]
            ) as photos,
        ):
            persona_preflight.preflight_persona_image("task-full", params, _MAX_BYTES)
        photos.assert_called_once_with("task-full", params)
        hook_image.assert_not_called()

    def test_hook_lipsync_never_reads_lipsync_photos(self):
        with (
            patch.object(full_lipsync, "resolve_persona_image", return_value="/t/img.png"),
            patch.object(lipsync_photos, "resolve_lipsync_photos") as photos,
        ):
            persona_preflight.preflight_persona_image("task-hook", _params(), _MAX_BYTES)
        photos.assert_not_called()

    def test_skips_when_voiceover(self):
        with patch.object(full_lipsync, "resolve_persona_image") as resolve:
            persona_preflight.preflight_persona_image(
                "task-2", _params(video_type="voiceover"), _MAX_BYTES
            )
        resolve.assert_not_called()

    def test_skips_when_the_persona_has_no_image(self):
        with patch.object(full_lipsync, "resolve_persona_image") as resolve:
            persona_preflight.preflight_persona_image("task-3", _params(photo=None), _MAX_BYTES)
        resolve.assert_not_called()

    def test_propagates_a_failed_download(self):
        failure = longcat.LongCatError("first photo of the video (segment 0 image 0) could not be loaded: download blocked")
        with patch.object(full_lipsync, "resolve_persona_image", side_effect=failure):
            with self.assertRaises(longcat.LongCatError) as ctx:
                persona_preflight.preflight_persona_image("task-4", _params(), _MAX_BYTES)
        self.assertIn("download blocked", str(ctx.exception))


class ResolvePersonaImageReuseTests(unittest.TestCase):
    def test_reuses_the_file_the_preflight_already_downloaded(self):
        with tempfile.TemporaryDirectory() as task_dir:
            cached = os.path.join(task_dir, "persona-lipsync-image.png")
            with open(cached, "wb") as handle:
                handle.write(b"png-bytes")
            with (
                patch.object(full_lipsync.utils, "task_dir", return_value=task_dir),
                patch.object(ssrf, "download_public_file") as download,
                patch.object(face_detect, "image_contains_face", return_value=True),
            ):
                result = full_lipsync.resolve_persona_image("task-5", _params(), _MAX_BYTES)
        self.assertEqual(result, cached)
        download.assert_not_called()


class StartAbortsOnDeadImageTests(unittest.TestCase):
    def _run_start(self, stop_at: str, preflight_side_effect=None):
        generate_script = MagicMock(return_value="script")
        with (
            patch.object(
                persona_preflight, "preflight_persona_image", side_effect=preflight_side_effect
            ) as preflight,
            patch.object(task_service.video_storage, "require_r2_configuration"),
            patch.object(task_service, "generate_script", generate_script),
            patch.object(task_service, "track_generation_started"),
            patch.object(task_service, "_update_task"),
            patch.object(task_service, "_fail_task") as fail_task,
            patch.object(task_service, "_complete_task"),
            patch.object(task_service, "save_script_data"),
            patch.object(task_service, "cleanup_task_intermediates"),
        ):
            task_service.start("task-8", _params(), stop_at=stop_at)
        return preflight, generate_script, fail_task

    def test_dead_image_fails_a_video_run_before_the_script_stage(self):
        failure = longcat.LongCatError("first photo of the video (segment 0 image 0) could not be loaded: download blocked")
        _, generate_script, fail_task = self._run_start("video", preflight_side_effect=failure)
        generate_script.assert_not_called()
        fail_task.assert_called_once()
        self.assertEqual(fail_task.call_args.kwargs["stage"], "persona_image")
        self.assertIn("download blocked", fail_task.call_args.args[1])

    def test_partial_runs_never_download_the_image(self):
        preflight, generate_script, _ = self._run_start("script")
        preflight.assert_not_called()
        generate_script.assert_called_once()


if __name__ == "__main__":
    unittest.main()


class IntroOnlyJobsArePreflightedTests(unittest.TestCase):
    def test_a_dead_image_fails_an_intro_only_video_run_at_the_start(self):
        params = _params()
        self.assertEqual(params.video_type, "hook_lipsync")
        failure = longcat.LongCatError("first photo of the video (segment 0 image 0) could not be loaded: download blocked")
        with (
            patch.object(persona_preflight, "preflight_persona_image", side_effect=failure),
            patch.object(task_service.video_storage, "require_r2_configuration"),
            patch.object(task_service, "generate_script", MagicMock()) as generate_script,
            patch.object(task_service, "track_generation_started"),
            patch.object(task_service, "_update_task"),
            patch.object(task_service, "_fail_task") as fail_task,
            patch.object(task_service, "cleanup_task_intermediates"),
        ):
            task_service.start("task-intro", params, stop_at="video")
        generate_script.assert_not_called()
        self.assertEqual(fail_task.call_args.kwargs["stage"], "persona_image")


class ResolvePersonaImageFirstPhotoTests(unittest.TestCase):
    """Issue #589: the hook opens with the first photo of the video.

    When the job carries segments, their first photo is the lip-sync
    image — not the persona avatar. A job with no usable first photo
    fails with no_first_photo instead of falling back to the persona
    photo.
    """

    def _task_params(self, hook_media):
        segments = valid_segments()
        fillers = [
            {"url": f"https://e.com/filler{i}.jpg"}
            for i in range(max(0, 4 - len(hook_media)))
        ]
        segments[0]["media"] = [*hook_media, *fillers]
        return TaskVideoRequest(
            video_title="coffee",
            video_description="Test description.",
            video_type="hook_lipsync",
            video_script="",
            segments=segments,
            persona=PersonaParams(
                name="Ana",
                photo_url="https://img.test/p.png",
                voice_id="chatterbox:kokoro_af_heart",
            ),
        )

    def _resolve(self, task_dir, params, first_photo, has_face=True):
        with (
            patch.object(full_lipsync.utils, "task_dir", return_value=task_dir),
            patch.object(ssrf, "download_public_file") as download,
            patch.object(
                full_lipsync.user_media,
                "resolve_first_segment_photo",
                return_value=first_photo,
            ) as resolve_first,
            patch.object(face_detect, "image_contains_face", return_value=has_face),
        ):
            return full_lipsync.resolve_persona_image("task-hook", params, _MAX_BYTES), download, resolve_first

    def test_first_segment_photo_wins_over_the_persona_avatar(self):
        with tempfile.TemporaryDirectory() as task_dir:
            resolved = os.path.join(task_dir, "resolved.jpg")
            with open(resolved, "wb") as handle:
                handle.write(b"first-photo-bytes")
            params = self._task_params([{"url": "https://e.com/a.jpg"}])
            result, download, _ = self._resolve(
                task_dir, params, (resolved, 0, 0, None)
            )
            self.assertEqual(result, os.path.join(task_dir, "persona-lipsync-image.png"))
            with open(result, "rb") as handle:
                self.assertEqual(handle.read(), b"first-photo-bytes")
            download.assert_not_called()

    def test_url_downloaded_first_photo_is_removed_after_the_copy(self):
        with tempfile.TemporaryDirectory() as task_dir:
            raw = os.path.join(task_dir, "segment-media-hook-first.raw")
            with open(raw, "wb") as handle:
                handle.write(b"first-photo-bytes")
            params = self._task_params([{"url": "https://e.com/a.jpg"}])
            self._resolve(task_dir, params, (raw, 0, 0, None))
            self.assertFalse(os.path.exists(raw))
            self.assertTrue(
                os.path.exists(os.path.join(task_dir, "persona-lipsync-image.png"))
            )

    def test_media_id_temp_asset_survives_the_copy(self):
        with tempfile.TemporaryDirectory() as task_dir:
            with tempfile.TemporaryDirectory() as assets_dir:
                asset = os.path.join(assets_dir, "aabbccddeeff00112233445566778899.jpg")
                with open(asset, "wb") as handle:
                    handle.write(b"first-photo-bytes")
                params = self._task_params(
                    [{"mediaId": "aabbccddeeff00112233445566778899.jpg"}]
                )
                self._resolve(task_dir, params, (asset, 0, 0, None))
                self.assertTrue(os.path.exists(asset))

    def test_no_segment_media_fails_with_no_first_photo(self):
        from types import SimpleNamespace

        with tempfile.TemporaryDirectory() as task_dir:
            params = SimpleNamespace(
                persona=PersonaParams(
                    name="Ana",
                    photo_url="https://img.test/p.png",
                    voice_id="chatterbox:kokoro_af_heart",
                ),
                segments=[{"kind": "hook", "text": "Hi."}],
            )
            with (
                patch.object(full_lipsync.utils, "task_dir", return_value=task_dir),
                patch.object(ssrf, "download_public_file") as download,
                patch.object(
                    full_lipsync.user_media,
                    "resolve_first_segment_photo",
                    return_value=("", -1, -1, "no_segment_media"),
                ),
                patch.object(face_detect, "image_contains_face", return_value=True),
            ):
                with self.assertRaises(longcat.LongCatError) as ctx:
                    full_lipsync.resolve_persona_image("task-hook", params, _MAX_BYTES)
            self.assertIn("no_first_photo", str(ctx.exception))
            download.assert_not_called()

    def test_missing_segments_fail_with_no_first_photo(self):
        from types import SimpleNamespace

        for segments in (None, []):
            with self.subTest(segments=segments):
                with tempfile.TemporaryDirectory() as task_dir:
                    params = SimpleNamespace(
                        persona=PersonaParams(
                            name="Ana",
                            photo_url="https://img.test/p.png",
                            voice_id="chatterbox:kokoro_af_heart",
                        ),
                        segments=segments,
                    )
                    with (
                        patch.object(full_lipsync.utils, "task_dir", return_value=task_dir),
                        patch.object(ssrf, "download_public_file") as download,
                        patch.object(
                            full_lipsync.user_media, "resolve_first_segment_photo"
                        ) as resolve_first,
                        patch.object(face_detect, "image_contains_face", return_value=True),
                    ):
                        with self.assertRaises(longcat.LongCatError) as ctx:
                            full_lipsync.resolve_persona_image(
                                "task-hook", params, _MAX_BYTES
                            )
                    self.assertIn("no_first_photo", str(ctx.exception))
                    download.assert_not_called()
                    resolve_first.assert_not_called()

    def test_empty_cached_file_is_replaced_by_the_first_segment_photo(self):
        with tempfile.TemporaryDirectory() as task_dir:
            open(os.path.join(task_dir, "persona-lipsync-image.png"), "wb").close()
            resolved = os.path.join(task_dir, "resolved.jpg")
            with open(resolved, "wb") as handle:
                handle.write(b"first-photo-bytes")
            params = self._task_params([{"url": "https://e.com/a.jpg"}])
            result, download, _ = self._resolve(task_dir, params, (resolved, 0, 0, None))
            self.assertEqual(result, os.path.join(task_dir, "persona-lipsync-image.png"))
            with open(result, "rb") as handle:
                self.assertEqual(handle.read(), b"first-photo-bytes")
            download.assert_not_called()

    def test_unresolvable_first_photo_fails_naming_the_segment_and_image(self):
        with tempfile.TemporaryDirectory() as task_dir:
            params = self._task_params(
                [{"url": "https://e.com/a.jpg"}, {"url": "https://e.com/b.jpg"}]
            )
            with self.assertRaises(longcat.LongCatError) as ctx:
                self._resolve(task_dir, params, ("", 0, 1, "media expired or missing"))
            self.assertIn("segment 0 image 1", str(ctx.exception))
            self.assertIn("media expired or missing", str(ctx.exception))

    def test_voiceover_first_photo_fails_the_task(self):
        with tempfile.TemporaryDirectory() as task_dir:
            resolved = os.path.join(task_dir, "resolved.jpg")
            with open(resolved, "wb") as handle:
                handle.write(b"first-photo-bytes")
            params = self._task_params([{"url": "https://e.com/a.jpg"}])
            with self.assertRaises(longcat.LongCatError) as ctx:
                self._resolve(task_dir, params, (resolved, 0, 0, None), has_face=False)
            self.assertIn("first photo of the video (segment 0 image 0)", str(ctx.exception))
            self.assertIn("no detectable face", str(ctx.exception))

    def test_missing_detector_never_blocks(self):
        with tempfile.TemporaryDirectory() as task_dir:
            resolved = os.path.join(task_dir, "resolved.jpg")
            with open(resolved, "wb") as handle:
                handle.write(b"first-photo-bytes")
            params = self._task_params([{"url": "https://e.com/a.jpg"}])
            result, _, _ = self._resolve(task_dir, params, (resolved, 0, 0, None), has_face=None)
            self.assertEqual(result, os.path.join(task_dir, "persona-lipsync-image.png"))

    def test_cached_file_is_face_checked_too(self):
        with tempfile.TemporaryDirectory() as task_dir:
            cached = os.path.join(task_dir, "persona-lipsync-image.png")
            with open(cached, "wb") as handle:
                handle.write(b"png-bytes")
            with (
                patch.object(full_lipsync.utils, "task_dir", return_value=task_dir),
                patch.object(face_detect, "image_contains_face", return_value=False),
            ):
                with self.assertRaises(longcat.LongCatError) as ctx:
                    full_lipsync.resolve_persona_image("task-cached", _params(), _MAX_BYTES)
            self.assertIn("no detectable face", str(ctx.exception))

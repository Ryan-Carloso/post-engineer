"""Persona image preflight: a dead image URL fails the job at the start.

Before the preflight the image was downloaded only after the script, terms,
TTS and stock-video stages, so a 404/400 image failed the job late, after
spending LLM and TTS cost. These tests pin: the preflight only acts for an
active lip-sync persona, the download happens once per task, and a failed
download aborts start() before any generation stage runs.
"""

import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from app.models.schema import PersonaParams, VideoParams
from app.services import full_lipsync, longcat, persona_preflight
from app.services import task as task_service

_MAX_BYTES = 20 * 1024 * 1024


def _params(lipsync_enabled: bool = True, photo: str | None = "https://img.test/p.png") -> VideoParams:
    return VideoParams(
        video_subject="coffee",
        video_script="Hook. Body. Call to action.",
        lipsync_enabled=lipsync_enabled,
        persona=PersonaParams(name="Ana", photo_url=photo, voice_id="chatterbox:kokoro_af_heart"),
    )


class PreflightPersonaImageTests(unittest.TestCase):
    def test_downloads_the_image_when_lipsync_is_active(self):
        with patch.object(full_lipsync, "resolve_persona_image", return_value="/t/img.png") as resolve:
            params = _params()
            persona_preflight.preflight_persona_image("task-1", params, _MAX_BYTES)
        resolve.assert_called_once_with("task-1", params, _MAX_BYTES)

    def test_skips_when_lipsync_is_disabled(self):
        with patch.object(full_lipsync, "resolve_persona_image") as resolve:
            persona_preflight.preflight_persona_image("task-2", _params(lipsync_enabled=False), _MAX_BYTES)
        resolve.assert_not_called()

    def test_skips_when_the_persona_has_no_image(self):
        with patch.object(full_lipsync, "resolve_persona_image") as resolve:
            persona_preflight.preflight_persona_image("task-3", _params(photo=None), _MAX_BYTES)
        resolve.assert_not_called()

    def test_propagates_a_failed_download(self):
        failure = longcat.LongCatError("persona image download failed: HTTP 404")
        with patch.object(full_lipsync, "resolve_persona_image", side_effect=failure):
            with self.assertRaises(longcat.LongCatError) as ctx:
                persona_preflight.preflight_persona_image("task-4", _params(), _MAX_BYTES)
        self.assertIn("HTTP 404", str(ctx.exception))


class ResolvePersonaImageReuseTests(unittest.TestCase):
    def test_reuses_the_file_the_preflight_already_downloaded(self):
        with tempfile.TemporaryDirectory() as task_dir:
            cached = os.path.join(task_dir, "persona-lipsync-image.png")
            with open(cached, "wb") as handle:
                handle.write(b"png-bytes")
            with (
                patch.object(full_lipsync.utils, "task_dir", return_value=task_dir),
                patch.object(full_lipsync.ssrf, "download_public_file") as download,
            ):
                result = full_lipsync.resolve_persona_image("task-5", _params(), _MAX_BYTES)
        self.assertEqual(result, cached)
        download.assert_not_called()

    def test_downloads_when_there_is_no_cached_file(self):
        with tempfile.TemporaryDirectory() as task_dir:
            with (
                patch.object(full_lipsync.utils, "task_dir", return_value=task_dir),
                patch.object(full_lipsync.ssrf, "download_public_file") as download,
            ):
                full_lipsync.resolve_persona_image("task-6", _params(), _MAX_BYTES)
        download.assert_called_once()

    def test_redownloads_when_the_cached_file_is_empty(self):
        with tempfile.TemporaryDirectory() as task_dir:
            open(os.path.join(task_dir, "persona-lipsync-image.png"), "wb").close()
            with (
                patch.object(full_lipsync.utils, "task_dir", return_value=task_dir),
                patch.object(full_lipsync.ssrf, "download_public_file") as download,
            ):
                full_lipsync.resolve_persona_image("task-7", _params(), _MAX_BYTES)
        download.assert_called_once()


class StartAbortsOnDeadImageTests(unittest.TestCase):
    def _run_start(self, stop_at: str, preflight_side_effect=None):
        generate_script = MagicMock(return_value="script")
        with (
            patch.object(persona_preflight, "preflight_persona_image", side_effect=preflight_side_effect) as preflight,
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
        failure = longcat.LongCatError("persona image download failed: HTTP 404")
        _, generate_script, fail_task = self._run_start("video", preflight_side_effect=failure)
        generate_script.assert_not_called()
        fail_task.assert_called_once()
        self.assertEqual(fail_task.call_args.kwargs["stage"], "persona_image")
        self.assertIn("HTTP 404", fail_task.call_args.args[1])

    def test_partial_runs_never_download_the_image(self):
        # Only the render needs the image: a script-only run must stay free.
        preflight, generate_script, _ = self._run_start("script")
        preflight.assert_not_called()
        generate_script.assert_called_once()


if __name__ == "__main__":
    unittest.main()

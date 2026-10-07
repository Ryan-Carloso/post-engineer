
import unittest
import asyncio
import os
import shutil
import subprocess
import sys
import tempfile
import types
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch
from moviepy import (
    VideoFileClip,
)
# add project root to python path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from app.config import config
from app.controllers.manager.base_manager import TaskQueueFullError
from app.controllers.manager.memory_manager import InMemoryTaskManager
from app.controllers.v1 import video as video_controller
from app.models import const
from app.models.schema import MaterialInfo
from app.services import state as sm
from app.services import video as vd
from app.utils import utils

resources_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "resources")


class _FakeRequest:
    def __init__(self):
        self.headers = {"x-task-id": "test-request"}
        self.state = types.SimpleNamespace(
            auth=video_controller.base.AuthContext(user_id="internal", auth_type="internal")
        )


class TestSecurityControls(unittest.TestCase):
    def setUp(self):
        self.original_app_config = dict(config.app)

    def tearDown(self):
        config.app.clear()
        config.app.update(self.original_app_config)

    def test_bgm_selection_requires_an_explicit_matching_mood(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            song_dir = Path(temp_dir) / "songs"
            song_dir.mkdir()
            confident = song_dir / "confident.mp3"
            confident_alt = song_dir / "confident-alt.mp3"
            sad = song_dir / "sad.mp3"
            unlisted = song_dir / "unlisted.mp3"
            for song in (confident, confident_alt, sad, unlisted):
                song.write_bytes(b"audio")
            catalog = Path(temp_dir) / "catalog.toml"
            catalog.write_text(
                "[[tracks]]\nfile = \"confident.mp3\"\nmoods = [\"confident\"]\n\n"
                "[[tracks]]\nfile = \"confident-alt.mp3\"\nmoods = [\"confident\"]\n\n"
                "[[tracks]]\nfile = \"sad.mp3\"\nmoods = [\"sad\"]\n",
                encoding="utf-8",
            )

            self.assertIn(
                vd.select_bgm_file("confident", str(catalog), str(song_dir)),
                {str(confident.resolve()), str(confident_alt.resolve())},
            )
            self.assertEqual(
                vd.select_bgm_file("sad", str(catalog), str(song_dir)),
                str(sad.resolve()),
            )
            self.assertEqual(vd.select_bgm_file("finance", str(catalog), str(song_dir)), "")

            self.assertEqual(
                vd.select_bgm_file(
                    "confident",
                    str(catalog),
                    str(song_dir),
                    recent_files=(str(confident.resolve()),),
                ),
                str(confident_alt.resolve()),
            )

    def test_music_moods_are_loaded_from_catalog_without_duplicates(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            catalog = Path(temp_dir) / "catalog.toml"
            catalog.write_text(
                "[[tracks]]\nfile = \"one.mp3\"\nmoods = [\"romantic\", \"calm\"]\n\n"
                "[[tracks]]\nfile = \"two.mp3\"\nmoods = [\"romantic\", \"energetic\"]\n",
                encoding="utf-8",
            )

            self.assertEqual(
                vd.get_available_music_moods(str(catalog)),
                ("calm", "energetic", "romantic"),
            )

    def test_task_query_returns_relative_task_url_without_mutating_state(self):
        """
        When no endpoint is explicitly configured, the task query endpoint
        must not derive absolute URLs from Host, nor write the display URL
        back into task state — otherwise queries from different Hosts would
        pollute the results.
        """
        task_id = "security-task-url"
        task_dir = utils.task_dir(task_id)
        video_path = os.path.join(task_dir, "final-1.mp4")
        Path(video_path).write_bytes(b"fake-video")
        config.app["endpoint"] = ""

        try:
            sm.state.update_task(
                task_id,
                state=const.TASK_STATE_COMPLETE,
                videos=[video_path],
                combined_videos=[video_path],
                user_id="internal",
            )

            response = video_controller.get_task(_FakeRequest(), task_id=task_id)

            self.assertEqual(response["body"]["videos"], [f"/api/v1/download/{task_id}/final-1.mp4"])
            self.assertEqual(sm.state.get_task(task_id)["videos"], [video_path])
        finally:
            sm.state.delete_task(task_id)
            shutil.rmtree(task_dir, ignore_errors=True)

    def test_download_authorizes_task_from_resolved_path(self):
        task_id = "normalized-task-url"
        task_dir = utils.task_dir(task_id)
        video_path = os.path.join(task_dir, "final-1.mp4")
        Path(video_path).write_bytes(b"fake-video")
        sm.state.update_task(task_id, state=const.TASK_STATE_COMPLETE, user_id="internal")

        try:
            response = asyncio.run(
                video_controller.download_video(
                    _FakeRequest(), f"wrong/../{task_id}/final-1.mp4"
                )
            )
            self.assertEqual(response.path, os.path.realpath(video_path))
        finally:
            sm.state.delete_task(task_id)
            shutil.rmtree(task_dir, ignore_errors=True)

    def test_stream_authorizes_task_from_resolved_path(self):
        task_id = "normalized-stream-url"
        task_dir = utils.task_dir(task_id)
        video_path = os.path.join(task_dir, "final-1.mp4")
        Path(video_path).write_bytes(b"fake-video")
        sm.state.update_task(task_id, state=const.TASK_STATE_COMPLETE, user_id="internal")

        try:
            response = asyncio.run(
                video_controller.stream_video(
                    _FakeRequest(), f"wrong/../{task_id}/final-1.mp4"
                )
            )
            self.assertEqual(response.status_code, 206)
        finally:
            sm.state.delete_task(task_id)
            shutil.rmtree(task_dir, ignore_errors=True)

    def test_in_memory_task_manager_rejects_when_queue_is_full(self):
        """
        Once concurrency is exhausted, the wait queue must have a hard cap.
        max_concurrent_tasks=0 forces tasks into the queue here, verifying
        that exceeding max_queued_tasks refuses further enqueueing.
        """
        manager = InMemoryTaskManager(max_concurrent_tasks=0, max_queued_tasks=1)

        manager.add_task(lambda: None)

        with self.assertRaises(TaskQueueFullError):
            manager.add_task(lambda: None)


class TestStorageFallback(unittest.TestCase):
    """When the local file is gone (restart wiped the disk), /stream/ and
    /download/ redirect to the durable Supabase Storage copy recorded in
    the task state at generation time."""

    def _run(self, coro):
        return asyncio.run(coro)

    def test_download_redirects_to_signed_storage_url_when_local_file_missing(self):
        task_id = "storage-fallback-task"
        sm.state.update_task(
            task_id,
            state=const.TASK_STATE_COMPLETE,
            user_id="internal",
            video_storage_path="internal/faceless/storage-fallback-task/final-1.mp4",
        )
        try:
            with patch(
                "app.controllers.v1.video.video_storage.create_signed_url",
                return_value="https://xyz.supabase.co/signed?token=abc",
            ):
                response = self._run(
                    video_controller.download_video(_FakeRequest(), f"{task_id}/final-1.mp4")
                )
            self.assertEqual(response.status_code, 302)
            self.assertEqual(
                response.headers["location"], "https://xyz.supabase.co/signed?token=abc"
            )
        finally:
            sm.state.delete_task(task_id)

    def test_stream_redirects_to_signed_storage_url_when_local_file_missing(self):
        task_id = "storage-fallback-stream"
        sm.state.update_task(
            task_id,
            state=const.TASK_STATE_COMPLETE,
            user_id="internal",
            video_storage_path="internal/faceless/storage-fallback-stream/final-1.mp4",
        )
        try:
            with patch(
                "app.controllers.v1.video.video_storage.create_signed_url",
                return_value="https://xyz.supabase.co/signed?token=abc",
            ):
                response = self._run(
                    video_controller.stream_video(_FakeRequest(), f"{task_id}/final-1.mp4")
                )
            self.assertEqual(response.status_code, 302)
        finally:
            sm.state.delete_task(task_id)

    def test_missing_local_file_without_storage_copy_still_404s(self):
        task_id = "no-storage-copy-task"
        sm.state.update_task(task_id, state=const.TASK_STATE_COMPLETE, user_id="internal")
        try:
            with self.assertRaises(video_controller.HttpException) as ctx:
                self._run(
                    video_controller.download_video(_FakeRequest(), f"{task_id}/final-1.mp4")
                )
            self.assertEqual(ctx.exception.status_code, 404)
        finally:
            sm.state.delete_task(task_id)

    def test_storage_copy_of_another_user_is_not_leaked(self):
        # The fallback resolves the task through the caller's own user_id:
        # a storage path recorded under a different user must not redirect.
        task_id = "other-user-task"
        sm.state.update_task(
            task_id,
            state=const.TASK_STATE_COMPLETE,
            user_id="someone-else",
            video_storage_path="someone-else/faceless/other-user-task/final-1.mp4",
        )
        try:
            with patch(
                "app.controllers.v1.video.video_storage.create_signed_url",
                return_value="https://xyz.supabase.co/signed?token=abc",
            ) as signed:
                with self.assertRaises(video_controller.HttpException) as ctx:
                    self._run(
                        video_controller.download_video(
                            _FakeRequest(), f"{task_id}/final-1.mp4"
                        )
                    )
                self.assertEqual(ctx.exception.status_code, 404)
                signed.assert_not_called()
        finally:
            sm.state.delete_task(task_id)

    def test_local_file_is_served_directly_when_present(self):
        task_id = "local-file-present-task"
        task_dir = utils.task_dir(task_id)
        video_path = os.path.join(task_dir, "final-1.mp4")
        Path(video_path).write_bytes(b"fake-video")
        sm.state.update_task(
            task_id,
            state=const.TASK_STATE_COMPLETE,
            user_id="internal",
            video_storage_path="internal/faceless/local-file-present-task/final-1.mp4",
        )
        try:
            with patch(
                "app.controllers.v1.video.video_storage.create_signed_url",
            ) as signed:
                response = self._run(
                    video_controller.download_video(_FakeRequest(), f"{task_id}/final-1.mp4")
                )
            self.assertEqual(response.path, os.path.realpath(video_path))
            signed.assert_not_called()
        finally:
            sm.state.delete_task(task_id)
            shutil.rmtree(task_dir, ignore_errors=True)


class TestVideoService(unittest.TestCase):
    def setUp(self):
        self.original_app_config = dict(config.app)
        self.test_img_path = os.path.join(resources_dir, "1.png")
        vd._runtime_disabled_video_codecs.clear()
        vd._ffmpeg_encoder_exists.cache_clear()
    
    def tearDown(self):
        config.app.clear()
        config.app.update(self.original_app_config)
        vd._runtime_disabled_video_codecs.clear()
        vd._ffmpeg_encoder_exists.cache_clear()
    
    def test_preprocess_video(self):
        if not os.path.exists(self.test_img_path):
            self.fail(f"test image not found: {self.test_img_path}")

        local_videos_dir = utils.storage_dir("local_videos", create=True)
        safe_img_path = os.path.join(local_videos_dir, "test-preprocess-1.png")
        shutil.copy2(self.test_img_path, safe_img_path)

        # test preprocess_video function
        m = MaterialInfo()
        m.url = os.path.basename(safe_img_path)
        m.provider = "local"
        print(m)

        try:
            materials = vd.preprocess_video([m], clip_duration=4)
            print(materials)

            # verify result
            self.assertIsNotNone(materials)
            self.assertEqual(len(materials), 1)
            self.assertTrue(materials[0].url.endswith(".mp4"))

            # moviepy get video info
            clip = VideoFileClip(materials[0].url)
            try:
                print(clip)
            finally:
                clip.close()

            # clean generated test video file
            if os.path.exists(materials[0].url):
                os.remove(materials[0].url)
        finally:
            if os.path.exists(safe_img_path):
                os.remove(safe_img_path)

    def test_preprocess_video_rejects_material_outside_local_videos(self):
        """
        local material paths come from API params; arbitrary absolute paths
        must never reach MoviePy. This verifies paths outside the
        local_videos allowlist are skipped, preventing arbitrary file reads.
        """
        m = MaterialInfo(provider="local", url=self.test_img_path)

        materials = vd.preprocess_video([m], clip_duration=4)

        self.assertEqual(materials, [])

    def test_get_ffmpeg_binary_uses_configured_env_path(self):
        """When ffmpeg is explicitly configured, that path takes precedence."""
        with patch.dict(os.environ, {"IMAGEIO_FFMPEG_EXE": "/tmp/custom-ffmpeg"}, clear=True):
            self.assertEqual(utils.get_ffmpeg_binary(), "/tmp/custom-ffmpeg")

    def test_get_ffmpeg_binary_falls_back_to_imageio_ffmpeg(self):
        """
        The Windows portable bundle may lack ffmpeg on the system PATH, but
        moviepy's imageio-ffmpeg dependency usually ships a binary. This
        verifies that fallback path works.
        """
        fake_imageio_ffmpeg = types.SimpleNamespace(
            get_ffmpeg_exe=lambda: "/tmp/bundled-ffmpeg"
        )

        with patch.dict(os.environ, {}, clear=True), patch.object(
            utils.shutil, "which", return_value=None
        ), patch.dict(sys.modules, {"imageio_ffmpeg": fake_imageio_ffmpeg}):
            self.assertEqual(utils.get_ffmpeg_binary(), "/tmp/bundled-ffmpeg")

    def test_get_effective_video_codec_falls_back_when_encoder_missing(self):
        """
        A user-selected hardware encoder must first pass the FFmpeg encoder
        list probe. When missing, fall back to libx264 directly instead of
        failing the generation task at the file-writing stage.
        """
        config.app["video_codec"] = "h264_nvenc"

        with patch.object(vd, "_ffmpeg_encoder_exists", return_value=False):
            self.assertEqual(vd._get_effective_video_codec(), "libx264")

    def test_ffmpeg_encoder_exists_falls_back_when_probe_fails(self):
        """
        A user-configured ffmpeg on Windows may fail to run due to a broken
        path, permissions, or antivirus interception. The encoder probe must
        return False then, so the upper layer stably falls back to libx264.
        """
        with patch.object(
            vd.subprocess,
            "run",
            side_effect=OSError("permission denied"),
        ):
            self.assertFalse(vd._ffmpeg_encoder_exists("C:/ffmpeg/bin/ffmpeg.exe", "h264_nvenc"))

    def test_write_videofile_falls_back_after_runtime_encoder_failure(self):
        """
        FFmpeg advertising a hardware encoder doesn't mean the current GPU
        or driver can actually use it. After the first real encode failure,
        retry with libx264 immediately and disable that encoder for this
        process.
        """

        class _FakeClip:
            def __init__(self):
                self.codecs = []

            def write_videofile(self, output_file, codec, **kwargs):
                self.codecs.append(codec)
                if codec == "h264_nvenc":
                    raise RuntimeError("nvenc device not available")

        fake_clip = _FakeClip()

        with patch.object(vd, "_ffmpeg_encoder_exists", return_value=True), patch.object(
            vd, "_encoder_actually_usable", return_value=True
        ):
            used_codec = vd._write_videofile_with_codec_fallback(
                fake_clip,
                "/tmp/fake.mp4",
                codec="h264_nvenc",
                logger=None,
                fps=30,
            )

        self.assertEqual(used_codec, "libx264")
        self.assertEqual(fake_clip.codecs, ["h264_nvenc", "libx264"])
        self.assertIn("h264_nvenc", vd._runtime_disabled_video_codecs)

    def test_write_videofile_does_not_disable_codec_when_fallback_also_fails(self):
        """
        If the libx264 fallback also fails, the cause is more likely an
        output path, permission, or file-lock issue — it must not be
        misattributed to the hardware encoder being unavailable.
        """

        class _FakeClip:
            def write_videofile(self, output_file, codec, **kwargs):
                raise RuntimeError(f"{codec} cannot write output")

        with patch.object(vd, "_ffmpeg_encoder_exists", return_value=True), patch.object(
            vd, "_encoder_actually_usable", return_value=True
        ):
            with self.assertRaises(RuntimeError):
                vd._write_videofile_with_codec_fallback(
                    _FakeClip(),
                    "/tmp/fake.mp4",
                    codec="h264_nvenc",
                    logger=None,
                    fps=30,
                )

        self.assertNotIn("h264_nvenc", vd._runtime_disabled_video_codecs)

    def test_format_ffmpeg_concat_path_normalizes_windows_path(self):
        """
        The concat demuxer's file list is sensitive to Windows backslashes;
        normalize to forward slashes before writing the list, keeping the
        single-quote escaping.
        """
        with patch.object(vd.os.path, "abspath", return_value=r"C:\Users\Harry's Videos\clip.mp4"):
            self.assertEqual(
                vd._format_ffmpeg_concat_path(r"C:\Users\Harry's Videos\clip.mp4"),
                "C:/Users/Harry'\\''s Videos/clip.mp4",
            )

    def test_concat_video_clips_falls_back_after_runtime_encoder_failure(self):
        """
        The final ffmpeg concat stage needs the same fallback ability. Mock
        an h264_nvenc encode failure here and confirm libx264 is run once
        more automatically.
        """
        config.app["video_codec"] = "h264_nvenc"

        def fake_run(command, capture_output, text, check):
            codec_index = command.index("-c:v") + 1
            codec = command[codec_index]
            if codec == "h264_nvenc":
                return types.SimpleNamespace(
                    returncode=1,
                    stdout="",
                    stderr="nvenc device not available",
                )
            return types.SimpleNamespace(returncode=0, stdout="", stderr="")

        with tempfile.TemporaryDirectory() as temp_dir:
            clip_file = os.path.join(temp_dir, "clip.mp4")
            output_file = os.path.join(temp_dir, "combined.mp4")
            Path(clip_file).write_bytes(b"fake")

            with patch.object(vd, "_ffmpeg_encoder_exists", return_value=True), patch.object(
            vd, "_encoder_actually_usable", return_value=True
        ):
                with patch.object(vd.subprocess, "run", side_effect=fake_run) as run:
                    vd.concat_video_clips_with_ffmpeg(
                        clip_files=[clip_file],
                        output_file=output_file,
                        threads=1,
                        output_dir=temp_dir,
                    )

        used_codecs = [
            call.args[0][call.args[0].index("-c:v") + 1]
            for call in run.call_args_list
        ]
        self.assertEqual(used_codecs, ["h264_nvenc", "libx264"])
        self.assertIn("h264_nvenc", vd._runtime_disabled_video_codecs)

    def test_concat_video_clips_does_not_disable_codec_when_fallback_also_fails(self):
        """
        If libx264 also fails at the concat stage, the cause is likely the
        input list, paths, or output permissions — the hardware encoder must
        not be added to the runtime disable list.
        """
        config.app["video_codec"] = "h264_nvenc"

        def fake_run(command, capture_output, text, check):
            codec_index = command.index("-c:v") + 1
            codec = command[codec_index]
            return types.SimpleNamespace(
                returncode=1,
                stdout="",
                stderr=f"{codec} cannot write output",
            )

        with tempfile.TemporaryDirectory() as temp_dir:
            clip_file = os.path.join(temp_dir, "clip.mp4")
            output_file = os.path.join(temp_dir, "combined.mp4")
            Path(clip_file).write_bytes(b"fake")

            with patch.object(vd, "_ffmpeg_encoder_exists", return_value=True), patch.object(
            vd, "_encoder_actually_usable", return_value=True
        ):
                with patch.object(vd.subprocess, "run", side_effect=fake_run):
                    with self.assertRaises(RuntimeError):
                        vd.concat_video_clips_with_ffmpeg(
                            clip_files=[clip_file],
                            output_file=output_file,
                            threads=1,
                            output_dir=temp_dir,
                        )

        self.assertNotIn("h264_nvenc", vd._runtime_disabled_video_codecs)

    def test_open_video_clip_quietly_suppresses_moviepy_stdout(self):
        """
        MoviePy 2.1.x's FFMPEG_VideoReader prints metadata and the ffmpeg
        command straight to stdout. The service layer should suppress this
        dependency noise so users don't misread `audio_found: False` as the
        final video having no audio.
        """
        video_path = os.path.join(resources_dir, "1.png.mp4")
        if not os.path.exists(video_path):
            self.fail(f"test video not found: {video_path}")

        stdout = StringIO()
        with redirect_stdout(stdout):
            clip = vd._open_video_clip_quietly(video_path)

        try:
            self.assertEqual(stdout.getvalue(), "")
            self.assertIsNone(clip.audio)
            self.assertGreater(clip.duration, 0)
        finally:
            vd.close_clip(clip)

    def test_combine_videos_closes_audio_clip_when_duration_read_fails(self):
        """
        `combine_videos()` only needs the voiceover audio duration. Even if
        reading duration raises, the AudioFileClip must be closed to avoid
        leaking the file handle.
        """

        class _FakeAudioReader:
            def __init__(self):
                self.closed = False

            def close(self):
                self.closed = True

        class _BrokenAudioClip:
            def __init__(self):
                self.reader = _FakeAudioReader()

            @property
            def duration(self):
                raise RuntimeError("failed to read duration")

        fake_audio_clip = _BrokenAudioClip()

        with patch.object(vd, "AudioFileClip", return_value=fake_audio_clip):
            with self.assertRaises(RuntimeError):
                vd.combine_videos(
                    combined_video_path="/tmp/unused-combined.mp4",
                    video_paths=[],
                    audio_file="/tmp/unused-audio.mp3",
                )

        self.assertTrue(fake_audio_clip.reader.closed)

    def test_combine_videos_handles_none_transition_mode(self):
        """
        Ensure `combine_videos` safely handles
        `video_transition_mode=None`.
        """
        class _FakeAudioClip:
            @property
            def duration(self):
                return 10.0

            def close(self):
                pass

        with tempfile.TemporaryDirectory() as temp_dir:
            combined_video_path = os.path.join(temp_dir, "combined.mp4")
            audio_file = os.path.join(temp_dir, "audio.mp3")

            with patch.object(vd, "AudioFileClip", return_value=_FakeAudioClip()):
                # Use empty video_paths to avoid heavy video processing while
                # still exercising transition mode normalization logic.
                result = vd.combine_videos(
                    combined_video_path=combined_video_path,
                    video_paths=[],
                    audio_file=audio_file,
                    video_transition_mode=None,
                )
                self.assertEqual(result, combined_video_path)

    def test_combine_videos_keeps_small_duration_safety_margin(self):
        """
        When accumulated audio and material durations are exactly equal, one
        more short clip is still appended as a safety margin.

        FFmpeg's framerate-based concat can leave the final video tens of
        milliseconds shorter than theory; stopping at exactly 10.0s == 10.0s
        would risk the edge case of audio still playing while the video
        material has ended.
        """

        class _FakeAudioClip:
            duration = 10.0

            def close(self):
                pass

        class _FakeVideoClip:
            def __init__(self, duration):
                self.duration = duration
                self.size = (1080, 1920)
                self.w = 1080
                self.h = 1920

            def subclipped(self, start_time, end_time):
                return _FakeVideoClip(end_time - start_time)

        video_durations = {
            "clip-1.mp4": 3.0,
            "clip-2.mp4": 4.0,
            "clip-3.mp4": 3.0,
            "clip-4.mp4": 2.0,
        }

        def _open_fake_video_clip(video_path):
            return _FakeVideoClip(video_durations[video_path])

        with tempfile.TemporaryDirectory() as temp_dir:
            combined_video_path = os.path.join(temp_dir, "combined.mp4")

            with patch.object(vd, "AudioFileClip", return_value=_FakeAudioClip()):
                with patch.object(
                    vd, "_open_video_clip_quietly", side_effect=_open_fake_video_clip
                ):
                    with patch.object(
                        vd, "_reencode_clip_with_ffmpeg",
                        side_effect=lambda **kwargs: True,
                    ) as ffmpeg_reencode_mock:
                        with patch.object(
                            vd, "_write_videofile_with_codec_fallback"
                        ) as write_mock:
                            with patch.object(vd, "concat_video_clips_with_ffmpeg"):
                                with patch.object(vd, "delete_files"):
                                    result = vd.combine_videos(
                                        combined_video_path=combined_video_path,
                                        video_paths=list(video_durations.keys()),
                                        audio_file=os.path.join(temp_dir, "audio.mp3"),
                                        video_aspect=vd.VideoAspect.portrait,
                                        video_concat_mode=vd.VideoConcatMode.sequential,
                                        video_transition_mode=None,
                                        max_clip_duration=10,
                                    )

        self.assertEqual(result, combined_video_path)
        self.assertEqual(ffmpeg_reencode_mock.call_count, 4)
        write_mock.assert_not_called()

    def test_prioritize_unique_source_clips_uses_each_source_before_reuse(self):
        """
        In random mode, one long material is split into several clips. The
        scheduler should surface each source at least once before reusing
        other slices of the same source, reducing perceived repetition.
        """
        clips = [
            vd.SubClippedVideoClip("a.mp4", 0, 4, source_file_path="a.mp4"),
            vd.SubClippedVideoClip("a.mp4", 4, 8, source_file_path="a.mp4"),
            vd.SubClippedVideoClip("b.mp4", 0, 4, source_file_path="b.mp4"),
            vd.SubClippedVideoClip("b.mp4", 4, 8, source_file_path="b.mp4"),
            vd.SubClippedVideoClip("c.mp4", 0, 4, source_file_path="c.mp4"),
        ]

        ordered_clips = vd._prioritize_unique_source_clips(
            subclipped_items=clips,
            concat_mode=vd.VideoConcatMode.random,
        )

        self.assertCountEqual(ordered_clips, clips)
        first_round_sources = [clip.source_file_path for clip in ordered_clips[:3]]
        self.assertCountEqual(first_round_sources, ["a.mp4", "b.mp4", "c.mp4"])

    def test_prioritize_unique_source_clips_keeps_sequential_order(self):
        """
        Sequential mode takes only each material's first segment; the random
        scheduling logic must not reorder it.
        """
        clips = [
            vd.SubClippedVideoClip("a.mp4", 0, 4, source_file_path="a.mp4"),
            vd.SubClippedVideoClip("b.mp4", 0, 4, source_file_path="b.mp4"),
            vd.SubClippedVideoClip("c.mp4", 0, 4, source_file_path="c.mp4"),
        ]

        ordered_clips = vd._prioritize_unique_source_clips(
            subclipped_items=clips,
            concat_mode=vd.VideoConcatMode.sequential,
        )

        self.assertEqual(ordered_clips, clips)

    def test_prioritize_unique_source_clips_prefers_long_primary_clip(self):
        """
        A source material's last slice may be shorter than the target clip
        duration. The first dedup pass should prefer longer slices, or
        material gets reused early from insufficient accumulated duration.
        """
        short_tail = vd.SubClippedVideoClip(
            "a.mp4", 6, 6.5, source_file_path="a.mp4"
        )
        full_clip = vd.SubClippedVideoClip(
            "a.mp4", 0, 3, source_file_path="a.mp4"
        )
        other_source = vd.SubClippedVideoClip(
            "b.mp4", 0, 3, source_file_path="b.mp4"
        )

        ordered_clips = vd._prioritize_unique_source_clips(
            subclipped_items=[short_tail, full_clip, other_source],
            concat_mode=vd.VideoConcatMode.random,
        )

        first_a_clip = next(
            clip for clip in ordered_clips if clip.source_file_path == "a.mp4"
        )
        self.assertEqual(first_a_clip, full_clip)
    
    def test_wrap_text(self):
        """test text wrapping function"""

        class _FakeFont:
            """Mimics PIL font metrics with a fixed width per character.

            No font is bundled with the repo (resource/fonts/ is gitignored),
            so the wrapping logic is tested against synthetic metrics instead
            of a real .ttf file.
            """

            def __init__(self, char_width=10, height=20):
                self._char_width = char_width
                self._height = height

            def getbbox(self, text):
                return (0, 0, len(text) * self._char_width, self._height)

        try:
            with patch.object(
                vd.ImageFont, "truetype", return_value=_FakeFont()
            ):
                # test english text wrapping
                test_text_en = "This is a test text for wrapping long sentences in english language"

                wrapped_text_en, text_height_en = vd.wrap_text(
                    text=test_text_en,
                    max_width=300,
                    font="any-font.ttf",
                    fontsize=30
                )
                print(wrapped_text_en, text_height_en)
                # verify text is wrapped
                self.assertIn("\n", wrapped_text_en)

                # test chinese text wrapping
                test_text_zh = "这是一段用来测试中文长句换行的文本内容，应该会根据宽度限制进行换行处理"
                wrapped_text_zh, text_height_zh = vd.wrap_text(
                    text=test_text_zh,
                    max_width=300,
                    font="any-font.ttf",
                    fontsize=30
                )
                print(wrapped_text_zh, text_height_zh)
                # verify chinese text is wrapped
                self.assertIn("\n", wrapped_text_zh)
        except Exception as e:
            self.fail(f"test wrap_text failed: {str(e)}")

    def test_rounded_subtitle_background_clip_has_transparent_corners(self):
        """
        The rounded subtitle background is only used when explicitly
        enabled. This directly verifies the generated RGBA background has
        transparent rounded corners and a translucent center, so later
        changes can't regress it into a solid rectangle.
        """
        clip = vd._rounded_subtitle_background_clip(
            width=120,
            height=48,
            color="#123456",
            alpha=140,
            radius=16,
        )
        try:
            frame = clip.get_frame(0)
            mask = clip.mask.get_frame(0)

            self.assertEqual(frame.shape[0:2], (48, 120))
            self.assertEqual(tuple(frame[24, 60]), (18, 52, 86))
            self.assertEqual(mask[0, 0], 0)
            self.assertGreater(mask[24, 60], 0.5)
            self.assertLess(mask[24, 60], 0.6)
        finally:
            clip.close()

    def test_get_temp_audio_dir_returns_system_temp_on_windows(self):
        with patch("sys.platform", "win32"):
            result = vd._get_temp_audio_dir("/some/output/dir")
            self.assertEqual(result, tempfile.gettempdir())

    def test_get_temp_audio_dir_returns_output_dir_on_non_windows(self):
        for platform in ("linux", "darwin"):
            with self.subTest(platform=platform):
                with patch("sys.platform", platform):
                    result = vd._get_temp_audio_dir("/some/output/dir")
                    self.assertEqual(result, "/some/output/dir")


class TestBgmStartOffset(unittest.TestCase):
    def test_offset_is_chosen_from_catalog_start_points(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            song_dir = Path(temp_dir) / "songs"
            song_dir.mkdir()
            track = song_dir / "track.mp3"
            track.write_bytes(b"audio")
            catalog = Path(temp_dir) / "catalog.toml"
            catalog.write_text(
                '[[tracks]]\nfile = "track.mp3"\nmoods = ["upbeat"]\n'
                'start_points = [0.0, 8.4, 16.8]\n',
                encoding="utf-8",
            )

            offset = vd.get_bgm_start_offset(
                str(track.resolve()), catalog_file=str(catalog), song_dir=str(song_dir)
            )

            self.assertIn(offset, {0.0, 8.4, 16.8})

    def test_track_without_start_points_starts_at_zero(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            song_dir = Path(temp_dir) / "songs"
            song_dir.mkdir()
            track = song_dir / "plain.mp3"
            track.write_bytes(b"audio")
            catalog = Path(temp_dir) / "catalog.toml"
            catalog.write_text(
                '[[tracks]]\nfile = "plain.mp3"\nmoods = ["calm"]\n',
                encoding="utf-8",
            )

            offset = vd.get_bgm_start_offset(
                str(track.resolve()), catalog_file=str(catalog), song_dir=str(song_dir)
            )

            self.assertEqual(offset, 0.0)

    def test_missing_catalog_falls_back_to_zero(self):
        offset = vd.get_bgm_start_offset(
            "/nonexistent/track.mp3",
            catalog_file="/nonexistent/catalog.toml",
            song_dir="/nonexistent",
        )

        self.assertEqual(offset, 0.0)

    def test_invalid_start_points_entries_are_ignored(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            song_dir = Path(temp_dir) / "songs"
            song_dir.mkdir()
            track = song_dir / "broken.mp3"
            track.write_bytes(b"audio")
            catalog = Path(temp_dir) / "catalog.toml"
            catalog.write_text(
                '[[tracks]]\nfile = "broken.mp3"\nmoods = ["sad"]\n'
                'start_points = ["oops"]\n',
                encoding="utf-8",
            )

            offset = vd.get_bgm_start_offset(
                str(track.resolve()), catalog_file=str(catalog), song_dir=str(song_dir)
            )

            self.assertEqual(offset, 0.0)


class TestFfmpegReencode(unittest.TestCase):
    """Tests for the new _reencode_clip_with_ffmpeg fast path."""

    def test_needs_moviepy_effects_none(self):
        """None transition mode means no effects needed."""
        self.assertFalse(vd._needs_moviepy_effects(None))

    def test_needs_moviepy_effects_no_transition(self):
        """VideoTransitionMode.none means no effects needed."""
        self.assertFalse(vd._needs_moviepy_effects(vd.VideoTransitionMode.none))

    def test_needs_moviepy_effects_fade_in(self):
        """fade_in transition mode requires MoviePy effects."""
        self.assertTrue(vd._needs_moviepy_effects(vd.VideoTransitionMode.fade_in))

    def test_reencode_clip_with_ffmpeg_zero_duration_raises(self):
        """Zero-duration subclip must raise instead of producing corrupt output."""
        with tempfile.TemporaryDirectory() as temp_dir:
            src = os.path.join(temp_dir, "input.mp4")
            out = os.path.join(temp_dir, "output.mp4")
            subprocess.run(
                [
                    vd.get_ffmpeg_binary(),
                    "-y", "-f", "lavfi", "-i",
                    "color=c=red:s=320x240:d=2:r=30",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    src,
                ],
                capture_output=True, check=True,
            )
            with self.assertRaises(ValueError):
                vd._reencode_clip_with_ffmpeg(
                    src=src, out=out,
                    start_time=2, end_time=2,
                    target_w=640, target_h=480,
                    codec="libx264", fps=30, threads=2,
                )
            self.assertFalse(os.path.exists(out))

    def test_reencode_clip_with_ffmpeg_missing_src_raises(self):
        """Missing source file must raise a clear error before calling ffmpeg."""
        with self.assertRaises(FileNotFoundError):
            vd._reencode_clip_with_ffmpeg(
                src="/nonexistent/video.mp4",
                out="/tmp/should_not_exist.mp4",
                start_time=0, end_time=5,
                target_w=1080, target_h=1920,
                codec="libx264", fps=30, threads=2,
            )
        self.assertFalse(os.path.exists("/tmp/should_not_exist.mp4"))

    def test_reencode_clip_with_ffmpeg_success(self):
        """Create a small test video, re-encode with FFmpeg, check output exists and has correct dimensions."""
        with tempfile.TemporaryDirectory() as temp_dir:
            src = os.path.join(temp_dir, "input.mp4")
            out = os.path.join(temp_dir, "output.mp4")
            # Create a 2-second 320x240 test video using ffmpeg
            subprocess.run(
                [
                    vd.get_ffmpeg_binary(),
                    "-y", "-f", "lavfi", "-i",
                    "color=c=red:s=320x240:d=2:r=30",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    src,
                ],
                capture_output=True, check=True,
            )
            self.assertTrue(os.path.exists(src))

            vd._reencode_clip_with_ffmpeg(
                src=src, out=out,
                start_time=0, end_time=2,
                target_w=640, target_h=480,
                codec="libx264", fps=30, threads=2,
            )

            self.assertTrue(os.path.exists(out))
            # Verify output dimensions via ffprobe when available
            if shutil.which("ffprobe"):
                probe = subprocess.run(
                    [
                        "ffprobe",
                        "-v", "quiet",
                        "-select_streams", "v:0",
                        "-show_entries", "stream=width,height",
                        "-of", "csv=p=0",
                        out,
                    ],
                    capture_output=True, text=True, check=True,
                )
                dims = probe.stdout.strip().split(",")
                self.assertEqual(dims, ["640", "480"])
            else:
                self.assertGreater(os.path.getsize(out), 0)

    def test_combine_videos_uses_ffmpeg_when_no_transition(self):
        """When _needs_moviepy_effects returns False, combine_videos should
        call _reencode_clip_with_ffmpeg and NOT _write_videofile_with_codec_fallback."""

        class _FakeAudioClip:
            duration = 10.0
            def close(self):
                pass

        class _FakeSubClip:
            def __init__(self, duration):
                self.duration = duration
                self.size = (1080, 1920)

        fake_clip = _FakeSubClip(6.0)

        def _open_fake(path):
            return fake_clip

        with tempfile.TemporaryDirectory() as temp_dir:
            combined_video_path = os.path.join(temp_dir, "combined.mp4")

            with patch.object(vd, "AudioFileClip", return_value=_FakeAudioClip()):
                with patch.object(vd, "_open_video_clip_quietly", side_effect=_open_fake):
                    with patch.object(vd, "_needs_moviepy_effects", return_value=False):
                        with patch.object(vd, "_reencode_clip_with_ffmpeg", return_value=True) as ffmpeg_mock:
                            with patch.object(vd, "_write_videofile_with_codec_fallback") as write_mock:
                                with patch.object(vd, "concat_video_clips_with_ffmpeg"):
                                    with patch.object(vd, "delete_files"):
                                        result = vd.combine_videos(
                                            combined_video_path=combined_video_path,
                                            video_paths=["/tmp/clip1.mp4"],
                                            audio_file=os.path.join(temp_dir, "audio.mp3"),
                                            max_clip_duration=10,
                                        )

            self.assertEqual(result, combined_video_path)
            ffmpeg_mock.assert_called_once()
            write_mock.assert_not_called()

    def test_combine_videos_uses_moviepy_when_transition(self):
        """When _needs_moviepy_effects returns True, combine_videos should
        use the MoviePy _write_videofile_with_codec_fallback path."""

        class _FakeAudioClip:
            duration = 10.0
            def close(self):
                pass

        class _FakeSubClip:
            def __init__(self, duration):
                self.duration = duration
                self.size = (1080, 1920)

            def subclipped(self, start, end):
                return _FakeSubClip(end - start)

        fake_clip = _FakeSubClip(6.0)

        def _open_fake(path):
            return fake_clip

        with tempfile.TemporaryDirectory() as temp_dir:
            combined_video_path = os.path.join(temp_dir, "combined.mp4")

            with patch.object(vd, "AudioFileClip", return_value=_FakeAudioClip()):
                with patch.object(vd, "_open_video_clip_quietly", side_effect=_open_fake):
                    with patch.object(vd, "_needs_moviepy_effects", return_value=True):
                        with patch.object(vd, "_reencode_clip_with_ffmpeg", return_value=True) as ffmpeg_mock:
                            with patch.object(vd, "_write_videofile_with_codec_fallback") as write_mock:
                                with patch.object(vd, "concat_video_clips_with_ffmpeg"):
                                    with patch.object(vd, "delete_files"):
                                        result = vd.combine_videos(
                                            combined_video_path=combined_video_path,
                                            video_paths=["/tmp/clip1.mp4"],
                                            audio_file=os.path.join(temp_dir, "audio.mp3"),
                                        )

            self.assertEqual(result, combined_video_path)
            write_mock.assert_called()
            ffmpeg_mock.assert_not_called()


class TestFontContainment(unittest.TestCase):
    """Subtitle fonts must resolve inside the bundled fonts directory.

    The font name arrives from API params, so it is untrusted input: absolute
    paths, nested paths, and ``../`` traversal must all be rejected before
    anything is handed to the renderer.
    """

    def test_valid_basename_resolves_inside_fonts_dir(self):
        # No font is bundled with the repo (resource/fonts/ is gitignored),
        # so the test stages its own font file in an isolated directory.
        with tempfile.TemporaryDirectory() as tmpdir:
            staged = os.path.join(tmpdir, "TestFont-Regular.ttf")
            Path(staged).write_bytes(b"not-a-real-font")
            with patch.object(utils, "font_dir", return_value=tmpdir):
                path = vd._resolve_font_path("TestFont-Regular.ttf")
            self.assertEqual(os.path.commonpath([tmpdir, path]), tmpdir)
            self.assertTrue(os.path.isfile(path))

    def test_absolute_path_is_rejected(self):
        inside = os.path.join(utils.font_dir(), "SomeFont.ttf")
        with self.assertRaises(ValueError):
            vd._resolve_font_path(inside)

    def test_nested_path_is_rejected(self):
        with self.assertRaises(ValueError):
            vd._resolve_font_path("subdir/SomeFont.ttf")

    def test_parent_traversal_is_rejected(self):
        with self.assertRaises(ValueError):
            vd._resolve_font_path("../SomeFont.ttf")

    def test_missing_file_is_rejected(self):
        with self.assertRaises(ValueError):
            vd._resolve_font_path("no-such-font.ttf")

    def test_windows_style_separators_are_rejected(self):
        # On POSIX a backslash is a legal filename character, so the plain
        # basename check would pass these through. Reject them explicitly:
        # the font name is always a bare basename, never a path in any
        # platform's syntax.
        for name in (
            "subdir\\SomeFont.ttf",
            "..\\SomeFont.ttf",
            "C:\\Windows\\Fonts\\arial.ttf",
        ):
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, "invalid font name"):
                    vd._resolve_font_path(name)

    def test_empty_name_is_rejected(self):
        with self.assertRaises(ValueError):
            vd._resolve_font_path("")


class TestEncoderProbe(unittest.TestCase):
    """
    The encoder-list probe only proves an encoder was COMPILED into ffmpeg.
    A machine with no GPU still lists h264_nvenc/h264_qsv/h264_vaapi, so the
    probe accepted them and every real encode then failed and fell back —
    once per clip, logging the same warning ~18 times in a single task.

    These tests pin a probe that actually tries to USE the encoder.
    """

    def setUp(self):
        vd._runtime_disabled_video_codecs.clear()
        vd._ffmpeg_encoder_exists.cache_clear()
        vd._encoder_actually_usable.cache_clear()

    def tearDown(self):
        vd._runtime_disabled_video_codecs.clear()
        vd._ffmpeg_encoder_exists.cache_clear()
        vd._encoder_actually_usable.cache_clear()

    def test_encoder_that_fails_a_real_encode_is_rejected(self):
        """
        An encoder that advertises itself but cannot encode one frame is
        unusable — the probe must say so before a task spends minutes
        failing on it.
        """
        with patch.object(
            vd.subprocess,
            "run",
            return_value=types.SimpleNamespace(returncode=1, stdout="", stderr="device not available"),
        ):
            self.assertFalse(vd._encoder_actually_usable("h264_nvenc"))

    def test_encoder_that_encodes_a_frame_is_accepted(self):
        with patch.object(
            vd.subprocess,
            "run",
            return_value=types.SimpleNamespace(returncode=0, stdout="", stderr=""),
        ):
            self.assertTrue(vd._encoder_actually_usable("h264_nvenc"))

    def test_encoder_that_cannot_be_probed_is_rejected(self):
        """
        An unreadable probe must fail CLOSED: falling back to libx264 is
        slower but works, while proceeding on an unverified hardware encoder
        fails the whole generation.
        """
        with patch.object(vd.subprocess, "run", side_effect=OSError("no device")):
            self.assertFalse(vd._encoder_actually_usable("h264_vaapi"))

    def test_effective_codec_falls_back_when_encoder_is_unusable(self):
        """
        The end-to-end contract: a configured hardware encoder that is
        compiled in but unusable yields libx264 without running a task.
        """
        with patch.dict(config.app, {"video_codec": "h264_nvenc"}, clear=False), patch.object(
            vd, "_ffmpeg_encoder_exists", return_value=True
        ), patch.object(vd, "_encoder_actually_usable", return_value=False):
            self.assertEqual(vd._get_effective_video_codec(), "libx264")

    def test_unusable_encoder_is_probed_only_once_per_codec(self):
        """
        The whole point: one probe for the process, not one per clip. An
        18-clip task logged the same warning 18 times.
        """
        with patch.object(
            vd.subprocess,
            "run",
            return_value=types.SimpleNamespace(returncode=1, stdout="", stderr="no device"),
        ) as mocked_run:
            for _ in range(5):
                vd._encoder_actually_usable("h264_videotoolbox")
        self.assertEqual(mocked_run.call_count, 1)


class TestLipSyncConcat(unittest.TestCase):
    """
    replace_video_intro_with_lipsync splices a ~4s talking-avatar intro onto
    the front of a ~36s clip. It re-encoded the ENTIRE clip to do it, which
    on this CPU-only host (2 vCPUs, no GPU) took ~13 minutes with no log
    output at all — indistinguishable from a hang.
    """

    def setUp(self):
        # Isolate from whatever the ambient config declares, so these tests
        # pin the shipped DEFAULT rather than this machine's config.toml.
        self._original_config = dict(config.app)
        config.app.pop("video_preset", None)
        config.app.pop("video_codec", None)

    def tearDown(self):
        config.app.clear()
        config.app.update(self._original_config)

    def _run_with_capture(self, duration=5.0, run_side_effect=None):
        """
        Drive the splice with ffmpeg stubbed, recording EVERY command it
        runs. The splice is three ffmpeg invocations now (encode intro,
        extract tail, join), so tests assert on the recorded list, not on a
        single command.
        """
        captured = {"commands": []}

        def fake_run(command, **run_kwargs):
            captured["commands"].append({"command": command, "run_kwargs": run_kwargs})
            if run_side_effect is not None:
                return run_side_effect(command, run_kwargs)
            return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

        # The concat list is written to disk; keep it in a temp dir so the
        # test never pollutes /tmp with a real file list.
        with tempfile.TemporaryDirectory() as tmpdir:
            out_path = os.path.join(tmpdir, "out.mp4")
            clip = types.SimpleNamespace(w=1080, h=1920)
            clip.close = lambda: None

            def call():
                with patch.object(vd.subprocess, "run", side_effect=fake_run), patch.object(
                    vd, "_open_video_clip_quietly", return_value=clip
                ), patch.object(vd, "_get_effective_video_codec", return_value="libx264"), patch.object(
                    vd, "_format_ffmpeg_concat_path", side_effect=lambda p: p
                ):
                    return vd.replace_video_intro_with_lipsync(
                        background_video="/tmp/bg.mp4",
                        lipsync_video="/tmp/ls.mp4",
                        output_file=out_path,
                        duration=duration,
                    )

            result = call()
        return result, captured

    def _command_containing(self, captured, needle):
        for entry in captured["commands"]:
            if needle in entry["command"]:
                return entry
        self.fail(f"no ffmpeg command contained {needle!r}: {captured['commands']}")

    def test_tail_is_stream_copied_instead_of_re_encoded(self):
        """
        The ~32s tail needs no re-encode: it is already H.264 at the target
        resolution and only its start offset changes. Copying it is the
        difference between ~13 minutes and a fraction of that.
        """
        _, captured = self._run_with_capture()
        tail = self._command_containing(captured, "-ss")
        self.assertIn("-c:v", tail["command"])
        self.assertEqual(tail["command"][tail["command"].index("-c:v") + 1], "copy")

    def test_encode_uses_a_fast_preset(self):
        """
        libx264's default preset is veryslow. On a CPU-only host that is the
        dominant cost of the splice.
        """
        _, captured = self._run_with_capture()
        # Only the intro encode carries a preset; the copied steps must not.
        intro = self._command_containing(captured, "-vf")
        self.assertIn("-preset", intro["command"])
        self.assertEqual(intro["command"][intro["command"].index("-preset") + 1], "veryfast")

    def test_configured_preset_overrides_the_default(self):
        """
        The default is a default, not a hardcode: a self-hoster who sets
        video_preset still gets their choice.
        """
        with patch.dict(config.app, {"video_preset": "slow"}, clear=False):
            self.assertEqual(vd._get_configured_video_preset(), "slow")

    def test_encode_is_bounded_by_a_timeout(self):
        """
        Without a timeout a wedged ffmpeg leaves the task `running` forever —
        the engine's own InfiniteTalk timeout does not cover local encodes.
        """
        _, captured = self._run_with_capture()
        self.assertTrue(captured["commands"], "expected at least one ffmpeg invocation")
        for entry in captured["commands"]:
            self.assertIn("timeout", entry["run_kwargs"])
            self.assertGreater(entry["run_kwargs"]["timeout"], 0)

    def test_timeout_is_surfaced_with_the_task_id_context(self):
        clip = types.SimpleNamespace(w=1080, h=1920)
        clip.close = lambda: None
        with patch.object(
            vd.subprocess, "run", side_effect=subprocess.TimeoutExpired(cmd="ffmpeg", timeout=5)
        ), patch.object(vd, "_open_video_clip_quietly", return_value=clip), patch.object(
            vd, "_get_effective_video_codec", return_value="libx264"
        ):
            with self.assertRaises(RuntimeError) as ctx:
                vd.replace_video_intro_with_lipsync(
                    background_video="/tmp/bg.mp4",
                    lipsync_video="/tmp/ls.mp4",
                    output_file="/tmp/out.mp4",
                )
        self.assertIn("timed out", str(ctx.exception).lower())

    def test_failed_encode_reports_ffmpeg_stderr(self):
        clip = types.SimpleNamespace(w=1080, h=1920)
        clip.close = lambda: None
        with patch.object(
            vd.subprocess,
            "run",
            return_value=subprocess.CompletedProcess(
                ["ffmpeg"], 1, stdout="", stderr="Invalid data found"
            ),
        ), patch.object(vd, "_open_video_clip_quietly", return_value=clip), patch.object(
            vd, "_get_effective_video_codec", return_value="libx264"
        ):
            with self.assertRaises(RuntimeError) as ctx:
                vd.replace_video_intro_with_lipsync(
                    background_video="/tmp/bg.mp4",
                    lipsync_video="/tmp/ls.mp4",
                    output_file="/tmp/out.mp4",
                )
        self.assertIn("Invalid data found", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()


class TestTerminalStateGate(unittest.TestCase):
    """stream_video/download_video only serve tasks that COMPLETED.

    final-1.mp4 is written progressively by moviepy between progress 75 and
    100 (task.py), so a PROCESSING task whose file exists on disk is a
    half-written render. Serving it is how truncated videos reached users.
    Publishing reads the finished file straight off disk
    (fill_schedule/publish.py), never through this endpoint, so the gate
    cannot break the batch.
    """

    def _run(self, coro):
        return asyncio.run(coro)

    def _seed_task(self, task_id, state, with_file=True, storage_path=None):
        task_dir = utils.task_dir(task_id)
        if with_file:
            Path(os.path.join(task_dir, "final-1.mp4")).write_bytes(b"fake-video")
        kwargs = {"state": state, "user_id": "internal"}
        if storage_path is not None:
            kwargs["video_storage_path"] = storage_path
        sm.state.update_task(task_id, **kwargs)
        return task_dir

    def _cleanup(self, task_id, task_dir):
        sm.state.delete_task(task_id)
        shutil.rmtree(task_dir, ignore_errors=True)

    def test_stream_refuses_task_still_processing(self):
        task_id = "gate-processing-stream"
        task_dir = self._seed_task(task_id, const.TASK_STATE_PROCESSING)
        try:
            with self.assertRaises(video_controller.HttpException) as ctx:
                self._run(
                    video_controller.stream_video(
                        _FakeRequest(), f"{task_id}/final-1.mp4"
                    )
                )
            self.assertEqual(ctx.exception.status_code, 404)
        finally:
            self._cleanup(task_id, task_dir)

    def test_download_refuses_task_still_processing(self):
        task_id = "gate-processing-download"
        task_dir = self._seed_task(task_id, const.TASK_STATE_PROCESSING)
        try:
            with self.assertRaises(video_controller.HttpException) as ctx:
                self._run(
                    video_controller.download_video(
                        _FakeRequest(), f"{task_id}/final-1.mp4"
                    )
                )
            self.assertEqual(ctx.exception.status_code, 404)
        finally:
            self._cleanup(task_id, task_dir)

    def test_stream_and_download_refuse_failed_task(self):
        task_id = "gate-failed-task"
        task_dir = self._seed_task(task_id, const.TASK_STATE_FAILED)
        try:
            for handler in (
                video_controller.stream_video,
                video_controller.download_video,
            ):
                with self.assertRaises(video_controller.HttpException) as ctx:
                    self._run(handler(_FakeRequest(), f"{task_id}/final-1.mp4"))
                self.assertEqual(ctx.exception.status_code, 404)
        finally:
            self._cleanup(task_id, task_dir)

    def test_processing_task_does_not_fall_back_to_storage(self):
        # The gate runs BEFORE the storage fallback: a PROCESSING task must
        # never 302 to an archived copy, even when video_storage_path is
        # already recorded.
        task_id = "gate-processing-fallback"
        self._seed_task(
            task_id,
            const.TASK_STATE_PROCESSING,
            with_file=False,
            storage_path=f"internal/faceless/{task_id}/final-1.mp4",
        )
        try:
            with patch(
                "app.controllers.v1.video.video_storage.create_signed_url",
                return_value="https://xyz.supabase.co/signed?token=abc",
            ) as signed:
                with self.assertRaises(video_controller.HttpException) as ctx:
                    self._run(
                        video_controller.download_video(
                            _FakeRequest(), f"{task_id}/final-1.mp4"
                        )
                    )
            self.assertEqual(ctx.exception.status_code, 404)
            signed.assert_not_called()
        finally:
            sm.state.delete_task(task_id)

    def test_completed_task_is_still_served(self):
        task_id = "gate-completed-task"
        task_dir = self._seed_task(task_id, const.TASK_STATE_COMPLETE)
        try:
            stream = self._run(
                video_controller.stream_video(
                    _FakeRequest(), f"{task_id}/final-1.mp4"
                )
            )
            self.assertEqual(stream.status_code, 206)
            download = self._run(
                video_controller.download_video(
                    _FakeRequest(), f"{task_id}/final-1.mp4"
                )
            )
            self.assertEqual(
                download.path,
                os.path.realpath(os.path.join(task_dir, "final-1.mp4")),
            )
        finally:
            self._cleanup(task_id, task_dir)


class TestFinalVideoUri(unittest.TestCase):
    """GET /tasks/{id} exposes the authoritative final render as
    `final_video` so consumers never guess the filename, plus `has_archive`
    so the UI knows a durable Storage copy exists."""

    def setUp(self):
        self.original_app_config = dict(config.app)

    def tearDown(self):
        config.app.clear()
        config.app.update(self.original_app_config)

    def test_task_query_exposes_final_video_uri(self):
        task_id = "final-video-task"
        task_dir = utils.task_dir(task_id)
        video_path = os.path.join(task_dir, "final-1.mp4")
        Path(video_path).write_bytes(b"fake-video")
        config.app["endpoint"] = ""
        sm.state.update_task(
            task_id,
            state=const.TASK_STATE_COMPLETE,
            videos=[video_path],
            user_id="internal",
        )
        try:
            response = video_controller.get_task(_FakeRequest(), task_id=task_id)
            self.assertEqual(
                response["body"]["final_video"],
                f"/api/v1/download/{task_id}/final-1.mp4",
            )
        finally:
            sm.state.delete_task(task_id)
            shutil.rmtree(task_dir, ignore_errors=True)

    def test_task_query_omits_final_video_when_absent(self):
        # The key is absent (not null) when the task has no videos.
        task_id = "no-final-video-task"
        sm.state.update_task(
            task_id, state=const.TASK_STATE_COMPLETE, user_id="internal"
        )
        try:
            response = video_controller.get_task(_FakeRequest(), task_id=task_id)
            self.assertNotIn("final_video", response["body"])
        finally:
            sm.state.delete_task(task_id)

    def test_task_query_does_not_mutate_state(self):
        # final_video is derived on the response; the stored task is untouched.
        task_id = "final-video-no-mutate"
        task_dir = utils.task_dir(task_id)
        video_path = os.path.join(task_dir, "final-1.mp4")
        Path(video_path).write_bytes(b"fake-video")
        config.app["endpoint"] = ""
        sm.state.update_task(
            task_id,
            state=const.TASK_STATE_COMPLETE,
            videos=[video_path],
            user_id="internal",
        )
        try:
            video_controller.get_task(_FakeRequest(), task_id=task_id)
            stored = sm.state.get_task(task_id, user_id="internal")
            self.assertNotIn("final_video", stored)
            self.assertEqual(stored["videos"], [video_path])
        finally:
            sm.state.delete_task(task_id)
            shutil.rmtree(task_dir, ignore_errors=True)

    def test_task_query_exposes_has_archive(self):
        task_id = "has-archive-task"
        sm.state.update_task(
            task_id,
            state=const.TASK_STATE_COMPLETE,
            user_id="internal",
            video_storage_path=f"internal/faceless/{task_id}/final-1.mp4",
        )
        try:
            response = video_controller.get_task(_FakeRequest(), task_id=task_id)
            self.assertTrue(response["body"]["has_archive"])
        finally:
            sm.state.delete_task(task_id)

        sm.state.update_task(
            task_id, state=const.TASK_STATE_COMPLETE, user_id="internal"
        )
        try:
            response = video_controller.get_task(_FakeRequest(), task_id=task_id)
            self.assertFalse(response["body"]["has_archive"])
        finally:
            sm.state.delete_task(task_id)

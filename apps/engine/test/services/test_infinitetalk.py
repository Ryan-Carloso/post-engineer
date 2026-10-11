import unittest
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import requests

from app.models.schema import (
    LipSyncQuality,
)
from app.services import infinitetalk


class TestInfiniteTalkClient(unittest.TestCase):
    def test_frames_follow_audio_duration_for_random_clip_lengths(self):
        samples = {
            1.0: 21,
            2.37: 53,
            3.72: 89,
            5.0: 121,
            7.99: 193,
        }

        for duration_seconds, expected_frames in samples.items():
            with self.subTest(duration_seconds=duration_seconds):
                self.assertEqual(
                    infinitetalk.frames_for_duration(duration_seconds),
                    expected_frames,
                )

    def test_generate_intro_polls_and_downloads_completed_job(self):
        responses = []
        submit = requests.Response()
        submit.status_code = 200
        submit._content = b'{"job_id":"job-1"}'
        status = requests.Response()
        status.status_code = 200
        status._content = b'{"status":"done"}'
        download = requests.Response()
        download.status_code = 200
        download._content = b"valid-mp4"
        responses.extend([submit, status, download])

        calls: list[dict[str, object]] = []

        def request(*args: object, **kwargs: object) -> requests.Response:
            calls.append(kwargs)
            return responses.pop(0)

        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "image.png"
            audio_path = Path(temp_dir) / "audio.mp3"
            output_path = Path(temp_dir) / "intro.mp4"
            image_path.write_bytes(b"image")
            audio_path.write_bytes(b"audio")
            with patch.object(infinitetalk, "trim_audio") as trim:
                def fake_trim(
                    source: str,
                    target: str,
                    duration_seconds: float,
                    padding_seconds: float,
                ) -> None:
                    Path(target).write_bytes(b"audio")

                trim.side_effect = fake_trim
                with patch.object(infinitetalk, "audio_duration_seconds", return_value=5.0):
                    with patch.dict(
                        os.environ,
                        {
                            "INFINITETALK_SUBMIT_URL": "https://modal.test/submit",
                            "INFINITETALK_STATUS_URL": "https://modal.test/status",
                            "INFINITETALK_DOWNLOAD_URL": "https://modal.test/download",
                            "INFINITETALK_HTTP_SECRET": "test-secret",
                        },
                    ):
                        with patch.object(
                            infinitetalk.config,
                            "infinitetalk",
                            {
                                "poll_interval_seconds": 0,
                                "timeout_seconds": 1,
                                "intro_duration_seconds": 5,
                            },
                        ):
                            infinitetalk.generate_intro(
                                str(image_path),
                                str(audio_path),
                                LipSyncQuality.very_good,
                                str(output_path),
                                request=request,
                            )

            self.assertEqual(output_path.read_bytes(), b"valid-mp4")
            self.assertEqual(calls[0]["data"], {"quality": "very-good", "frames": "121"})
            # Every request must carry the configured bearer secret.
            for call in calls:
                self.assertEqual(
                    call["headers"], {"Authorization": "Bearer test-secret"}
                )


    def test_generate_intro_requires_http_secret(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "image.png"
            audio_path = Path(temp_dir) / "audio.mp3"
            image_path.write_bytes(b"image")
            audio_path.write_bytes(b"audio")
            with patch.object(infinitetalk, "trim_audio"):
                with patch.dict(os.environ):
                    # The URLs are set but the bearer secret is missing: the
                    # client must fail fast on the env var, not the config.
                    for var in (
                        "INFINITETALK_SUBMIT_URL",
                        "INFINITETALK_STATUS_URL",
                        "INFINITETALK_DOWNLOAD_URL",
                    ):
                        os.environ[var] = "https://modal.test/endpoint"
                    os.environ.pop("INFINITETALK_HTTP_SECRET", None)
                    with self.assertRaises(infinitetalk.InfiniteTalkError):
                        infinitetalk.generate_intro(
                            str(image_path),
                            str(audio_path),
                            LipSyncQuality.very_good,
                            str(Path(temp_dir) / "intro.mp4"),
                        )

    def test_generate_intro_creates_missing_output_parent_dir(self):
        # The task storage dir can vanish between utils.task_dir() creating
        # it and the Modal job finishing its (multi-minute) poll, e.g. a
        # cleanup between stage retries. The download must recreate it
        # instead of crashing with FileNotFoundError.
        submit = requests.Response()
        submit.status_code = 200
        submit._content = b'{"job_id":"job-1"}'
        status = requests.Response()
        status.status_code = 200
        status._content = b'{"status":"done"}'
        download = requests.Response()
        download.status_code = 200
        download._content = b"valid-mp4"
        responses = [submit, status, download]

        def request(*args: object, **kwargs: object) -> requests.Response:
            return responses.pop(0)

        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "image.png"
            audio_path = Path(temp_dir) / "audio.mp3"
            output_path = Path(temp_dir) / "vanished-task-dir" / "intro.mp4"
            image_path.write_bytes(b"image")
            audio_path.write_bytes(b"audio")
            with patch.object(infinitetalk, "trim_audio") as trim:
                def fake_trim(
                    source: str,
                    target: str,
                    duration_seconds: float,
                    padding_seconds: float,
                ) -> None:
                    Path(target).write_bytes(b"audio")

                trim.side_effect = fake_trim
                with patch.object(
                    infinitetalk, "audio_duration_seconds", return_value=5.0
                ):
                    # Since #146 the endpoint URLs and HTTP secret come from
                    # env vars, not config.toml — only the poll/timeout
                    # tunables still come from config.
                    with patch.dict(
                        os.environ,
                        {
                            "INFINITETALK_SUBMIT_URL": "https://modal.test/submit",
                            "INFINITETALK_STATUS_URL": "https://modal.test/status",
                            "INFINITETALK_DOWNLOAD_URL": "https://modal.test/download",
                            "INFINITETALK_HTTP_SECRET": "test-secret",
                        },
                    ):
                        with patch.object(
                            infinitetalk.config,
                            "infinitetalk",
                            {
                                "poll_interval_seconds": 0,
                                "timeout_seconds": 1,
                                "intro_duration_seconds": 5,
                            },
                        ):
                            infinitetalk.generate_intro(
                                str(image_path),
                                str(audio_path),
                                LipSyncQuality.very_good,
                                str(output_path),
                                request=request,
                            )
            self.assertEqual(output_path.read_bytes(), b"valid-mp4")


class TestGenerateIntroTracking(unittest.TestCase):
    def _run_generate_intro(self, responses):
        """Run generate_intro with canned HTTP responses; returns the paths."""
        calls: list[dict[str, object]] = []

        def request(*args: object, **kwargs: object) -> requests.Response:
            calls.append(kwargs)
            return responses.pop(0)

        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "image.png"
            audio_path = Path(temp_dir) / "audio.mp3"
            output_path = Path(temp_dir) / "intro.mp4"
            image_path.write_bytes(b"image")
            audio_path.write_bytes(b"audio")
            with patch.object(infinitetalk, "trim_audio") as trim:
                def fake_trim(
                    source: str,
                    target: str,
                    duration_seconds: float,
                    padding_seconds: float,
                ) -> None:
                    Path(target).write_bytes(b"audio")

                trim.side_effect = fake_trim
                with patch.object(
                    infinitetalk, "audio_duration_seconds", return_value=5.0
                ):
                    with patch.dict(
                        os.environ,
                        {
                            "INFINITETALK_SUBMIT_URL": "https://modal.test/submit",
                            "INFINITETALK_STATUS_URL": "https://modal.test/status",
                            "INFINITETALK_DOWNLOAD_URL": "https://modal.test/download",
                            "INFINITETALK_HTTP_SECRET": "test-secret",
                        },
                    ):
                        with patch.object(
                            infinitetalk.config,
                            "infinitetalk",
                            {
                                "poll_interval_seconds": 0,
                                "timeout_seconds": 1,
                                "intro_duration_seconds": 5,
                            },
                        ):
                            result = infinitetalk.generate_intro(
                                str(image_path),
                                str(audio_path),
                                LipSyncQuality.very_good,
                                str(output_path),
                                request=request,
                            )
            output_path_result, cost_usd = result
            self.assertTrue(Path(output_path_result).exists())
            return result

    def _submit_status_download(self):
        submit = requests.Response()
        submit.status_code = 200
        submit._content = b'{"job_id":"job-1"}'
        status = requests.Response()
        status.status_code = 200
        status._content = b'{"status":"done"}'
        download = requests.Response()
        download.status_code = 200
        download._content = b"valid-mp4"
        return [submit, status, download]

    def test_generate_intro_tracks_success(self):
        """
        A completed Modal job emits one ai_request: backend=modal,
        operation=generate_intro, the job_id, success=True.
        """
        with patch.object(infinitetalk, "track_ai_request") as track:
            self._run_generate_intro(self._submit_status_download())

        track.assert_called_once()
        props = track.call_args[0][0]
        self.assertEqual(props["backend"], "modal")
        self.assertEqual(props["operation"], "generate_intro")
        self.assertEqual(props["job_id"], "job-1")
        self.assertTrue(props["success"])
        self.assertEqual(props["error"], "")
        self.assertGreaterEqual(props["duration_ms"], 0)

    def test_generate_intro_tracks_failure(self):
        """
        A failed Modal submit emits ai_request with success=False and the
        error, and the original exception still propagates.
        """
        submit = requests.Response()
        submit.status_code = 500
        submit._content = b"boom"

        with patch.object(infinitetalk, "track_ai_request") as track:
            with self.assertRaises(infinitetalk.InfiniteTalkError):
                self._run_generate_intro([submit])

        track.assert_called_once()
        props = track.call_args[0][0]
        self.assertEqual(props["backend"], "modal")
        self.assertEqual(props["operation"], "generate_intro")
        self.assertFalse(props["success"])
        self.assertIn("500", props["error"])


    def test_generate_intro_tracks_failure_with_job_id(self):
        """
        A job that fails after submit still reports the Modal job_id, so
        post-submit failures stay correlatable in PostHog.
        """
        submit = requests.Response()
        submit.status_code = 200
        submit._content = b'{"job_id":"job-42"}'
        status = requests.Response()
        status.status_code = 200
        status._content = b'{"status":"failed","error":"cuda oom"}'

        with patch.object(infinitetalk, "track_ai_request") as track:
            with self.assertRaises(infinitetalk.InfiniteTalkError):
                self._run_generate_intro([submit, status])

        track.assert_called_once()
        props = track.call_args[0][0]
        self.assertFalse(props["success"])
        self.assertEqual(props["job_id"], "job-42")


class TestGenerateIntroCost(unittest.TestCase):
    """The Modal done payload carries the GPU cost (USD) for unit economics."""

    def _run_with_status(self, status_body: bytes):
        submit = requests.Response()
        submit.status_code = 200
        submit._content = b'{"job_id":"job-1"}'
        status = requests.Response()
        status.status_code = 200
        status._content = status_body
        download = requests.Response()
        download.status_code = 200
        download._content = b"valid-mp4"
        responses = [submit, status, download]

        def request(*args: object, **kwargs: object) -> requests.Response:
            return responses.pop(0)

        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "image.png"
            audio_path = Path(temp_dir) / "audio.mp3"
            output_path = Path(temp_dir) / "intro.mp4"
            image_path.write_bytes(b"image")
            audio_path.write_bytes(b"audio")
            with patch.object(infinitetalk, "trim_audio") as trim:
                def fake_trim(
                    source: str,
                    target: str,
                    duration_seconds: float,
                    padding_seconds: float,
                ) -> None:
                    Path(target).write_bytes(b"audio")

                trim.side_effect = fake_trim
                with patch.object(
                    infinitetalk, "audio_duration_seconds", return_value=5.0
                ):
                    with patch.dict(
                        os.environ,
                        {
                            "INFINITETALK_SUBMIT_URL": "https://modal.test/submit",
                            "INFINITETALK_STATUS_URL": "https://modal.test/status",
                            "INFINITETALK_DOWNLOAD_URL": "https://modal.test/download",
                            "INFINITETALK_HTTP_SECRET": "test-secret",
                        },
                    ):
                        with patch.object(
                            infinitetalk.config,
                            "infinitetalk",
                            {
                                "poll_interval_seconds": 0,
                                "timeout_seconds": 1,
                                "intro_duration_seconds": 5,
                            },
                        ):
                            return infinitetalk.generate_intro(
                                str(image_path),
                                str(audio_path),
                                LipSyncQuality.ok,
                                str(output_path),
                                request=request,
                            )

    def test_returns_cost_usd_from_done_payload(self):
        _, cost_usd = self._run_with_status(b'{"status":"done","cost_usd":0.1234}')
        self.assertEqual(cost_usd, 0.1234)

    def test_returns_none_when_cost_absent(self):
        # Older Modal jobs predate cost reporting: unknown, not zero.
        _, cost_usd = self._run_with_status(b'{"status":"done"}')
        self.assertIsNone(cost_usd)

    def test_returns_none_for_non_numeric_cost(self):
        _, cost_usd = self._run_with_status(b'{"status":"done","cost_usd":"free"}')
        self.assertIsNone(cost_usd)

    def test_returns_none_for_non_finite_cost(self):
        _, cost_usd = self._run_with_status(b'{"status":"done","cost_usd":Infinity}')
        self.assertIsNone(cost_usd)


class TestTrimAudio(unittest.TestCase):
    def _capture_ffmpeg_args(self, **kwargs):
        captured: list[list[str]] = []

        class FakeCompleted:
            returncode = 0
            stdout = ""
            stderr = ""

        def fake_run(argv, **_kwargs):
            captured.append(list(argv))
            return FakeCompleted()

        with tempfile.TemporaryDirectory() as temp_dir:
            audio_path = str(Path(temp_dir) / "audio.mp3")
            output_path = str(Path(temp_dir) / "trimmed.mp3")
            Path(audio_path).write_bytes(b"audio")
            with (
                patch.object(infinitetalk.subprocess, "run", side_effect=fake_run),
                patch("os.path.isfile", return_value=True),
            ):
                infinitetalk.trim_audio(audio_path, output_path, **kwargs)
        return captured[0]

    def test_trim_audio_passes_exactly_one_duration_flag(self):
        # Regression: a second "-t" silently overrides the first, so the
        # output length becomes duration + padding instead of the intended
        # duration (OpenCode review on a24e322).
        args = self._capture_ffmpeg_args(duration_seconds=5, padding_seconds=0.75)
        self.assertEqual(args.count("-t"), 1)
        flag_index = args.index("-t")
        self.assertEqual(args[flag_index + 1], str(5 + 0.75))

    def test_trim_audio_seeks_before_input_for_start_offset(self):
        args = self._capture_ffmpeg_args(
            duration_seconds=2, padding_seconds=0.5, start_seconds=1.5
        )
        self.assertLess(args.index("-ss"), args.index("-i"))
        self.assertEqual(args[args.index("-ss") + 1], "1.5")
        self.assertEqual(args.count("-t"), 1)
        flag_index = args.index("-t")
        self.assertEqual(args[flag_index + 1], str(2 + 0.5))


if __name__ == "__main__":
    unittest.main()

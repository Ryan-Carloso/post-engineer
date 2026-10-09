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
            self.assertTrue(Path(result).exists())
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


if __name__ == "__main__":
    unittest.main()

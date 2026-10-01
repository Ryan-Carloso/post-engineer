import unittest
import tempfile
import types
from pathlib import Path
from unittest.mock import patch

import requests

from app.models.schema import (
    ContentParams,
    LipSyncQuality,
    PersonaParams,
    PersonaVideoRequest,
)
from app.controllers.v1 import video as video_controller
from app.services import infinitetalk
from app.services import task as task_service


class TestPersonaVideoContract(unittest.TestCase):
    def test_accepts_frontend_persona_and_content_payload(self):
        request = PersonaVideoRequest(
            persona=PersonaParams(
                id="ana",
                name="Ana",
                photo_url="https://example.com/ana.png",
                voice_id="calm",
                niche="finanças pessoais",
                speaking_style="direta e didática",
                audience="jovens",
                language="pt-BR",
            ),
            content=ContentParams(
                topic="Como organizar o salário",
                goal="educar",
                platform_ids=["234dd"],
                video_quality=LipSyncQuality.ok,
            ),
        )

        self.assertEqual(request.content.video_quality, LipSyncQuality.ok)
        self.assertEqual(request.persona.language, "pt-BR")

    def test_rejects_missing_persona(self):
        with self.assertRaises(ValueError):
            PersonaVideoRequest.model_validate(
                {
                    "content": {
                        "topic": "x",
                        "goal": "y",
                        "platform_ids": ["account-1"],
                    }
                }
            )

    def test_public_controller_maps_nested_content_to_video_task(self):

        body = PersonaVideoRequest(
            persona=PersonaParams(
                name="Ana",
                photo_url="https://example.com/ana.png",
                voice_id="calm",
                niche="finanças",
                speaking_style="direta",
                audience="jovens",
            ),
            content=ContentParams(
                topic="Poupar dinheiro",
                goal="educar",
                platform_ids=["account-1"],
                video_quality=LipSyncQuality.very_good,
            ),
        )

        with patch.object(
            video_controller,
            "process_persona_videos",
            return_value=[("task-1", "params")],
        ) as process:
            request = types.SimpleNamespace(
                state=types.SimpleNamespace(
                    auth=video_controller.base.AuthContext(
                        user_id="internal", auth_type="internal"
                    )
                )
            )
            result = video_controller.create_persona_video(request, body)

        self.assertEqual(result, {"status": 200, "data": {"task_id": "task-1"}})
        process.assert_called_once()
        batch_body = process.call_args.args[1]
        self.assertEqual(len(batch_body.items), 1)
        item = batch_body.items[0]
        self.assertEqual(item.topic, "Poupar dinheiro")
        self.assertEqual(item.goal, "educar")
        self.assertEqual(item.platform_ids, ["account-1"])
        self.assertEqual(item.video_quality, LipSyncQuality.very_good)

    def test_persona_script_is_limited_at_a_sentence_boundary(self):
        long_script = "Primeira frase. " + ("palavra " * 100)

        with patch.dict(task_service.config.app, {"max_video_script_characters": 30}):
            result = task_service._limit_generated_script(long_script)

        self.assertEqual(result, "Primeira frase.")


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
                    with patch.object(
                        infinitetalk.config,
                        "infinitetalk",
                        {
                            "submit_url": "https://modal.test/submit",
                            "status_url": "https://modal.test/status",
                            "download_url": "https://modal.test/download",
                            "poll_interval_seconds": 0,
                            "timeout_seconds": 1,
                            "intro_duration_seconds": 5,
                            "http_secret": "test-secret",
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
                with patch.object(
                    infinitetalk.config,
                    "infinitetalk",
                    {
                        "submit_url": "https://modal.test/submit",
                        "status_url": "https://modal.test/status",
                        "download_url": "https://modal.test/download",
                    },
                ):
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
                    with patch.object(
                        infinitetalk.config,
                        "infinitetalk",
                        {
                            "submit_url": "https://modal.test/submit",
                            "status_url": "https://modal.test/status",
                            "download_url": "https://modal.test/download",
                            "poll_interval_seconds": 0,
                            "timeout_seconds": 1,
                            "intro_duration_seconds": 5,
                            "http_secret": "test-secret",
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

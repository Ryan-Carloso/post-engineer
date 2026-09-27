import unittest
import types
import tempfile
from pathlib import Path
from unittest.mock import patch

import requests

from app.models import const
from app.models.schema import (
    ContentParams,
    LipSyncQuality,
    PersonaParams,
    PersonaVideoRequest,
    TaskVideoRequest,
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

    def test_deleting_queued_persona_removes_it_from_daily_batch(self):
        request = type("Request", (), {
            "headers": {"x-task-id": "request"},
            "state": types.SimpleNamespace(
                auth=video_controller.base.AuthContext(user_id="internal", auth_type="internal")
            ),
        })()
        queued_task = {
            "state": const.TASK_STATE_QUEUED,
            "status": "queued_for_daily_batch",
        }
        with patch.object(video_controller.sm.state, "get_task", return_value=queued_task):
            with patch.object(video_controller.sm.state, "delete_task") as delete_task:
                with patch.object(video_controller, "_persona_batch_queue") as queue:
                    response = video_controller.delete_video(request, task_id="queued-task")

        queue.delete.assert_called_once_with("queued-task")
        delete_task.assert_called_once_with("queued-task")
        self.assertEqual(response["status"], 200)

    def test_queue_enqueue_failure_does_not_create_queued_state(self):
        request = type("Request", (), {
            "headers": {"x-task-id": "request"},
            "state": types.SimpleNamespace(
                auth=video_controller.base.AuthContext(user_id="internal", auth_type="internal")
            ),
        })()
        body = TaskVideoRequest(
            video_subject="topic",
            persona=PersonaParams(
                name="Ana",
                photo_url="https://example.com/ana.png",
                voice_id="calm",
                niche="education",
                speaking_style="direct",
                audience="adults",
            ),
        )
        with patch.object(video_controller, "_persona_batch_queue") as queue:
            queue.enqueue.side_effect = RuntimeError("database locked")
            with patch.object(video_controller.sm.state, "update_task") as update_task:
                with self.assertRaises(RuntimeError):
                    video_controller.create_task(request, body, "video", daily_batch=True)

        update_task.assert_not_called()

    def test_public_controller_maps_nested_content_to_video_task(self):
        from app.controllers.v1 import video as video_controller

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

        with patch.object(video_controller, "create_task", return_value="task") as create_task:
            result = video_controller.create_persona_video(object(), body)

        self.assertEqual(result, "task")
        mapped = create_task.call_args.args[1]
        self.assertEqual(mapped.video_subject, "Poupar dinheiro")
        self.assertEqual(mapped.video_quality, LipSyncQuality.very_good)
        self.assertEqual(mapped.platform_ids, ["account-1"])

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


if __name__ == "__main__":
    unittest.main()

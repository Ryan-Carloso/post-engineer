"""Supabase Storage archive for final videos (app/services/video_storage.py).

Only the FINAL video (final-1.mp4, post audio-mux) is archived — never
intermediates (combined-1.mp4), caches, or pre-audio renders. Layout:
    videos/{user_id}/{persona_id|faceless}/{task_id}/final-1.mp4
so Supabase RLS can scope every object to its owning user by path prefix.
"""

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models.schema import PersonaParams, VideoParams
from app.services import video_storage as vs


def _params(persona=None):
    return VideoParams(video_subject="s", persona=persona)


def _visual_persona(pid="persona-1"):
    return PersonaParams(
        id=pid, name="P", photo_url="https://x/y.jpg", voice_id="v1"
    )


def _faceless_persona(pid="persona-2"):
    return PersonaParams(id=pid, name="F", voice_id="v1")


class StorageObjectPathTests(unittest.TestCase):
    def test_persona_path(self):
        self.assertEqual(
            vs.storage_object_path("user-1", "persona-9", "task-7"),
            "user-1/persona-9/task-7/final-1.mp4",
        )

    def test_faceless_path(self):
        self.assertEqual(
            vs.storage_object_path("user-1", "faceless", "task-7"),
            "user-1/faceless/task-7/final-1.mp4",
        )


class PersonaFolderTests(unittest.TestCase):
    def test_persona_with_visuals_uses_persona_id(self):
        task = {"user_id": "u1", "persona_id": "persona-9"}
        self.assertEqual(
            vs.persona_folder(task, _params(_visual_persona("persona-9"))),
            "persona-9",
        )

    def test_faceless_persona_goes_to_faceless_folder(self):
        task = {"user_id": "u1", "persona_id": "persona-2"}
        self.assertEqual(
            vs.persona_folder(task, _params(_faceless_persona("persona-2"))),
            "faceless",
        )

    def test_persona_id_from_inline_params_when_task_row_lacks_it(self):
        task = {"user_id": "u1"}
        self.assertEqual(
            vs.persona_folder(task, _params(_visual_persona("persona-9"))),
            "persona-9",
        )

    def test_no_persona_at_all_goes_to_faceless_folder(self):
        self.assertEqual(vs.persona_folder({"user_id": "u1"}, _params()), "faceless")
        self.assertEqual(vs.persona_folder({}, _params()), "faceless")


class IsConfiguredTests(unittest.TestCase):
    def test_requires_both_env_vars(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(vs.is_configured())
        with patch.dict(os.environ, {"SUPABASE_URL": "https://x.supabase.co"}, clear=True):
            self.assertFalse(vs.is_configured())
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://x.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "svc-key",
            },
            clear=True,
        ):
            self.assertTrue(vs.is_configured())


class UploadFinalVideoTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://xyz.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "svc-key",
            },
            clear=True,
        )
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_uploads_to_bucket_path_with_service_key(self):
        response = MagicMock()
        response.ok = True
        response.status_code = 200
        with patch("app.services.video_storage.requests.post", return_value=response) as post:
            with patch("builtins.open", MagicMock()):
                result = vs.upload_final_video(
                    "u1/faceless/task-7/final-1.mp4", "/tmp/final-1.mp4"
                )
        self.assertEqual(result, "u1/faceless/task-7/final-1.mp4")
        args, kwargs = post.call_args
        self.assertEqual(
            args[0],
            "https://xyz.supabase.co/storage/v1/object/videos/u1/faceless/task-7/final-1.mp4",
        )
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer svc-key")
        self.assertEqual(kwargs["headers"]["Content-Type"], "video/mp4")

    def test_upload_failure_is_best_effort_and_returns_none(self):
        response = MagicMock()
        response.ok = False
        response.status_code = 500
        response.text = "boom"
        with patch("app.services.video_storage.requests.post", return_value=response):
            with patch("builtins.open", MagicMock()):
                self.assertIsNone(
                    vs.upload_final_video("u1/faceless/t/final-1.mp4", "/tmp/final-1.mp4")
                )

    def test_upload_skipped_when_not_configured(self):
        with patch.dict(os.environ, {}, clear=True):
            with patch("app.services.video_storage.requests.post") as post:
                self.assertIsNone(vs.upload_final_video("p", "/tmp/f.mp4"))
                post.assert_not_called()


class CreateSignedUrlTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://xyz.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "svc-key",
            },
            clear=True,
        )
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_returns_signed_url(self):
        response = MagicMock()
        response.ok = True
        response.json.return_value = {
            "signedURL": "https://xyz.supabase.co/storage/v1/object/sign/videos/p?token=abc"
        }
        with patch("app.services.video_storage.requests.post", return_value=response) as post:
            url = vs.create_signed_url("u1/faceless/t/final-1.mp4", expires_in=600)
        self.assertEqual(
            url, "https://xyz.supabase.co/storage/v1/object/sign/videos/p?token=abc"
        )
        args, kwargs = post.call_args
        self.assertIn("/storage/v1/object/sign/videos/u1/faceless/t/final-1.mp4", args[0])
        self.assertEqual(kwargs["json"], {"expiresIn": 600})

    def test_failure_returns_none(self):
        response = MagicMock()
        response.ok = False
        response.status_code = 404
        response.text = "not found"
        with patch("app.services.video_storage.requests.post", return_value=response):
            self.assertIsNone(vs.create_signed_url("u1/faceless/t/final-1.mp4"))

    def test_not_configured_returns_none(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(vs.create_signed_url("u1/faceless/t/final-1.mp4"))


if __name__ == "__main__":
    unittest.main()

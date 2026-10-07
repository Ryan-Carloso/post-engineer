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


class R2IsConfiguredTests(unittest.TestCase):
    """R2 needs account id + key id + secret; any one missing is unconfigured."""

    def test_requires_all_three_r2_env_vars(self):
        full = {
            "MPT_VIDEO_STORAGE": "r2",
            "R2_ACCOUNT_ID": "acct",
            "R2_ACCESS_KEY_ID": "key-id",
            "R2_SECRET_ACCESS_KEY": "secret",
        }
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(vs.r2_is_configured())
        # Drop one at a time: a partial config must never be treated as ready,
        # or the archive silently switches to an unsigned/half-configured client.
        for missing in full:
            env = {k: v for k, v in full.items() if k != missing}
            with patch.dict(os.environ, env, clear=True):
                self.assertFalse(vs.r2_is_configured())
        with patch.dict(os.environ, full, clear=True):
            self.assertTrue(vs.r2_is_configured())

    def test_r2_endpoint_is_derived_from_account_id(self):
        with patch.dict(
            os.environ,
            {
                "MPT_VIDEO_STORAGE": "r2",
                "R2_ACCOUNT_ID": "acct123",
                "R2_ACCESS_KEY_ID": "k",
                "R2_SECRET_ACCESS_KEY": "s",
            },
            clear=True,
        ):
            self.assertEqual(
                vs.r2_endpoint(), "https://acct123.r2.cloudflarestorage.com"
            )

    def test_blank_values_are_treated_as_unset(self):
        with patch.dict(
            os.environ,
            {
                "MPT_VIDEO_STORAGE": "r2",
                "R2_ACCOUNT_ID": "acct",
                "R2_ACCESS_KEY_ID": "",
                "R2_SECRET_ACCESS_KEY": "s",
            },
            clear=True,
        ):
            self.assertFalse(vs.r2_is_configured())


class R2UploadTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(
            os.environ,
            {
                "MPT_VIDEO_STORAGE": "r2",
                "R2_ACCOUNT_ID": "acct",
                "R2_ACCESS_KEY_ID": "key-id",
                "R2_SECRET_ACCESS_KEY": "secret",
            },
            clear=True,
        )
        self.env.start()
        self.addCleanup(self.env.stop)
        # The archive is a precondition of a servable video, so the upload path
        # now stats the local file and HEADs the object back. Both are mocked:
        # a size that matches is what makes the upload count as verified.
        self.stat = patch(
            "app.services.video_storage.os.path.getsize", return_value=1024
        )
        self.stat.start()
        self.addCleanup(self.stat.stop)

    def _client(self, remote_bytes=1024):
        client = MagicMock()
        client.put_object.return_value = {"ETag": '"abc"'}
        client.head_object.return_value = {"ContentLength": remote_bytes}
        return client

    def test_uploads_object_and_returns_path_only_after_verification(self):
        client = self._client()
        with patch("app.services.video_storage._r2_client", return_value=client):
            with patch("builtins.open", MagicMock()):
                result = vs.upload_final_video_r2(
                    "u1/faceless/task-7/final-1.mp4", "/tmp/final-1.mp4"
                )
        self.assertEqual(result, "u1/faceless/task-7/final-1.mp4")
        client.put_object.assert_called_once()
        kwargs = client.put_object.call_args.kwargs
        self.assertEqual(kwargs["Bucket"], vs.STORAGE_BUCKET)
        self.assertEqual(kwargs["Key"], "u1/faceless/task-7/final-1.mp4")
        self.assertEqual(kwargs["ContentType"], "video/mp4")
        # Verification is not optional: a successful PUT alone is not proof.
        client.head_object.assert_called_once_with(
            Bucket=vs.STORAGE_BUCKET, Key="u1/faceless/task-7/final-1.mp4"
        )

    def test_truncated_object_is_rejected_even_though_put_succeeded(self):
        """A short object must not be recorded as stored.

        put_object can answer 200 for a truncated body; accepting it would
        leave a video marked as archived that cannot actually be played.
        """
        client = self._client(remote_bytes=500)
        with patch("app.services.video_storage._r2_client", return_value=client):
            with patch("builtins.open", MagicMock()):
                self.assertIsNone(
                    vs.upload_final_video_r2("u1/faceless/t/final-1.mp4", "/tmp/f.mp4")
                )

    def test_verification_failure_returns_none(self):
        client = self._client()
        client.head_object.side_effect = RuntimeError("head failed")
        with patch("app.services.video_storage._r2_client", return_value=client):
            with patch("builtins.open", MagicMock()):
                self.assertIsNone(
                    vs.upload_final_video_r2("u1/faceless/t/final-1.mp4", "/tmp/f.mp4")
                )

    def test_missing_local_file_returns_none_without_uploading(self):
        with patch(
            "app.services.video_storage.os.path.getsize",
            side_effect=OSError("missing"),
        ):
            with patch("app.services.video_storage._r2_client") as factory:
                self.assertIsNone(
                    vs.upload_final_video_r2("u1/faceless/t/final-1.mp4", "/tmp/f.mp4")
                )
                factory.assert_not_called()

    def test_upload_failure_is_best_effort_and_returns_none(self):
        client = self._client()
        client.put_object.side_effect = RuntimeError("boom")
        with patch("app.services.video_storage._r2_client", return_value=client):
            with patch("builtins.open", MagicMock()):
                self.assertIsNone(
                    vs.upload_final_video_r2("u1/faceless/t/final-1.mp4", "/tmp/f.mp4")
                )

    def test_upload_skipped_when_not_configured(self):
        with patch.dict(os.environ, {}, clear=True):
            with patch("app.services.video_storage._r2_client") as factory:
                self.assertIsNone(vs.upload_final_video_r2("p", "/tmp/f.mp4"))
                factory.assert_not_called()


class R2SignedUrlTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(
            os.environ,
            {
                "MPT_VIDEO_STORAGE": "r2",
                "R2_ACCOUNT_ID": "acct",
                "R2_ACCESS_KEY_ID": "key-id",
                "R2_SECRET_ACCESS_KEY": "secret",
            },
            clear=True,
        )
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_presigned_url_targets_r2_endpoint(self):
        client = MagicMock()
        client.generate_presigned_url.return_value = (
            "https://acct.r2.cloudflarestorage.com/videos/p?X-Amz-Signature=abc"
        )
        with patch("app.services.video_storage._r2_client", return_value=client):
            url = vs.create_signed_url_r2("u1/faceless/t/final-1.mp4", expires_in=600)
        self.assertIn("X-Amz-Signature", url)
        kwargs = client.generate_presigned_url.call_args.kwargs
        self.assertEqual(kwargs["Params"]["Bucket"], vs.STORAGE_BUCKET)
        self.assertEqual(kwargs["Params"]["Key"], "u1/faceless/t/final-1.mp4")
        self.assertEqual(kwargs["ExpiresIn"], 600)

    def test_failure_returns_none(self):
        client = MagicMock()
        client.generate_presigned_url.side_effect = RuntimeError("boom")
        with patch("app.services.video_storage._r2_client", return_value=client):
            self.assertIsNone(vs.create_signed_url_r2("u1/faceless/t/final-1.mp4"))

    def test_not_configured_returns_none(self):
        with patch.dict(os.environ, {}, clear=True):
            with patch("app.services.video_storage._r2_client") as factory:
                self.assertIsNone(vs.create_signed_url_r2("p"))
                factory.assert_not_called()


class ArchiveFinalVideosAlertTests(unittest.TestCase):
    """An unarchived video must be recorded, not silently skipped.

    R2 is the only source for serving, so a failed upload/verify means the
    video is gone the moment the local disk is recycled. Recording the reason
    on the task is what makes that recoverable instead of invisible.
    """

    def test_failed_archive_records_video_storage_error(self):
        from app.services import task as task_mod

        with patch.object(task_mod.sm.state, "get_task", return_value={"user_id": "u1"}):
            with patch.object(
                task_mod.video_storage, "upload_final_video", return_value=None
            ):
                with patch.object(task_mod, "_update_task") as update:
                    task_mod.archive_final_videos(
                        "task-1", ["/tmp/final-1.mp4"], _params(_faceless_persona())
                    )
        update.assert_called_once()
        kwargs = update.call_args.kwargs
        self.assertEqual(kwargs["video_storage_error"], "u1/faceless/task-1/final-1.mp4")
        self.assertNotIn("video_storage_path", kwargs)

    def test_verified_archive_records_path_and_no_error(self):
        from app.services import task as task_mod

        with patch.object(task_mod.sm.state, "get_task", return_value={"user_id": "u1"}):
            with patch.object(
                task_mod.video_storage,
                "upload_final_video",
                return_value="u1/faceless/task-1/final-1.mp4",
            ):
                with patch.object(task_mod, "_update_task") as update:
                    task_mod.archive_final_videos(
                        "task-1", ["/tmp/final-1.mp4"], _params(_faceless_persona())
                    )
        update.assert_called_once_with(
            "task-1", video_storage_path="u1/faceless/task-1/final-1.mp4"
        )


if __name__ == "__main__":
    unittest.main()

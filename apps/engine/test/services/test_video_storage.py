"""R2 archive for final videos (app/services/video_storage.py).

Only the FINAL video (final-1.mp4, post audio-mux) is archived — never
intermediates (combined-1.mp4), caches, or pre-audio renders. Layout:
    videos/{user_id}/{persona_id|faceless}/{task_id}/final-1.mp4
so R2 objects can be scoped to their owning user by path prefix.
"""

import os
import sys
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models.schema import PersonaParams, VideoParams
from app.services import video_storage as vs


@contextmanager
def _isolated_environ(overrides):
    """Isolated os.environ that stays honest under mutmut.

    Equivalent to patch.dict(os.environ, overrides, clear=True), except it
    preserves mutmut's MUTANT_UNDER_TEST variable. mutmut 3.x activates the
    mutant under test through that env var, read at call time by its
    trampoline; a plain clear=True wipes it, so every mutant trivially
    "survives" (the original code always runs) and the stats run associates
    no tests to the mutated functions. Outside mutmut the variable is unset
    and this behaves exactly like patch.dict(clear=True).
    """
    sentinel = os.environ.get("MUTANT_UNDER_TEST")
    with patch.dict(os.environ, overrides, clear=True):
        if sentinel is not None:
            os.environ["MUTANT_UNDER_TEST"] = sentinel
        yield


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

    def test_persona_with_only_avatar_url_uses_persona_id(self):
        # has_visuals must come from avatar_url alone: guards the getattr
        # attribute names (a typo'd "XXavatar_urlXX" would silently flip a
        # visual persona into the faceless folder).
        persona = PersonaParams(
            id="persona-3", name="A", avatar_url="https://x/a.jpg", voice_id="v1"
        )
        task = {"user_id": "u1", "persona_id": "persona-3"}
        self.assertEqual(vs.persona_folder(task, _params(persona)), "persona-3")

    def test_no_persona_at_all_goes_to_faceless_folder(self):
        self.assertEqual(vs.persona_folder({"user_id": "u1"}, _params()), "faceless")
        self.assertEqual(vs.persona_folder({}, _params()), "faceless")


class R2ConfigurationTests(unittest.TestCase):
    """R2 credentials are mandatory; missing values fail explicitly."""

    def test_r2_endpoint_is_derived_from_account_id(self):
        with _isolated_environ(
            {
                "R2_ACCOUNT_ID": "acct123",
                "R2_ACCESS_KEY_ID": "k",
                "R2_SECRET_ACCESS_KEY": "s",
            }
        ):
            self.assertEqual(
                vs.r2_endpoint(), "https://acct123.r2.cloudflarestorage.com"
            )

    def test_missing_credentials_fail_explicitly(self):
        with _isolated_environ({}):
            with self.assertRaises(RuntimeError) as ctx:
                vs.require_r2_configuration()
        self.assertEqual(
            str(ctx.exception),
            "R2 video storage is required; "
            "missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY",
        )

    def test_each_missing_credential_is_named_exactly(self):
        # The message names the missing variable: a typo'd name in the
        # (name, value) pairs would silently misreport which key to set.
        full = {
            "R2_ACCOUNT_ID": "acct",
            "R2_ACCESS_KEY_ID": "k",
            "R2_SECRET_ACCESS_KEY": "s",
        }
        for missing in full:
            env = {k: v for k, v in full.items() if k != missing}
            with _isolated_environ(env):
                with self.assertRaises(RuntimeError) as ctx:
                    vs.require_r2_configuration()
            self.assertEqual(
                str(ctx.exception),
                f"R2 video storage is required; missing {missing}",
            )

    def test_blank_values_are_treated_as_unset(self):
        with _isolated_environ(
            {
                "R2_ACCOUNT_ID": "acct",
                "R2_ACCESS_KEY_ID": "",
                "R2_SECRET_ACCESS_KEY": "s",
            }
        ):
            with self.assertRaises(RuntimeError) as ctx:
                vs.require_r2_configuration()
        self.assertEqual(
            str(ctx.exception),
            "R2 video storage is required; missing R2_ACCESS_KEY_ID",
        )

    def test_unset_account_id_resolves_to_empty_string(self):
        # Guards the "" fallback: a truthy fallback would make the endpoint
        # builder produce a bogus host instead of failing explicitly.
        with _isolated_environ({}):
            self.assertEqual(vs._r2_account_id(), "")


class R2UploadTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(_isolated_environ({
                    "R2_ACCOUNT_ID": "acct",
                "R2_ACCESS_KEY_ID": "key-id",
                "R2_SECRET_ACCESS_KEY": "secret",
            }))
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
            with patch("builtins.open", MagicMock()) as open_mock:
                result = vs.upload_final_video_r2(
                    "u1/faceless/task-7/final-1.mp4", "/tmp/final-1.mp4"
                )
        self.assertEqual(result, "u1/faceless/task-7/final-1.mp4")
        # The local file must be opened in binary mode; the exact handle is
        # what gets uploaded (a Body=None or dropped kwarg must fail).
        open_mock.assert_called_once_with("/tmp/final-1.mp4", "rb")
        handle = open_mock.return_value.__enter__.return_value
        client.put_object.assert_called_once()
        kwargs = client.put_object.call_args.kwargs
        self.assertEqual(kwargs["Bucket"], vs.STORAGE_BUCKET)
        self.assertEqual(kwargs["Key"], "u1/faceless/task-7/final-1.mp4")
        self.assertIs(kwargs["Body"], handle)
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

    def test_missing_content_length_counts_as_zero_bytes(self):
        # A HEAD without ContentLength means "nothing stored": the fallback
        # must be 0, so a zero-byte expectation verifies and anything else
        # does not (guards the `or 0` against `or 1`-style mutants).
        client = MagicMock()
        client.head_object.return_value = {}
        self.assertTrue(vs._verify_r2_object(client, "p", 0))
        self.assertFalse(vs._verify_r2_object(client, "p", 10))

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
        with _isolated_environ({}):
            with patch("app.services.video_storage._r2_client") as factory:
                with self.assertRaisesRegex(RuntimeError, "R2 video storage is required"):
                    vs.upload_final_video_r2("p", "/tmp/f.mp4")
                factory.assert_not_called()

    def test_wrapper_delegates_to_r2_upload_with_both_paths(self):
        # upload_final_video is a thin wrapper; the object path must reach
        # the R2 upload unchanged (a None-swapped argument must fail).
        with patch.object(
            vs, "upload_final_video_r2", return_value="u1/f/t/final-1.mp4"
        ) as upload:
            self.assertEqual(
                vs.upload_final_video("u1/f/t/final-1.mp4", "/tmp/final-1.mp4"),
                "u1/f/t/final-1.mp4",
            )
            upload.assert_called_once_with("u1/f/t/final-1.mp4", "/tmp/final-1.mp4")


class R2SignedUrlTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(_isolated_environ({
                    "R2_ACCOUNT_ID": "acct",
                "R2_ACCESS_KEY_ID": "key-id",
                "R2_SECRET_ACCESS_KEY": "secret",
            }))

    def test_presigned_url_targets_r2_endpoint(self):
        client = MagicMock()
        client.generate_presigned_url.return_value = (
            "https://acct.r2.cloudflarestorage.com/videos/p?X-Amz-Signature=abc"
        )
        with patch("app.services.video_storage._r2_client", return_value=client):
            url = vs.create_signed_url_r2("u1/faceless/t/final-1.mp4", expires_in=600)
        self.assertIn("X-Amz-Signature", url)
        # The S3 operation name is positional: signing anything but
        # "get_object" would mint an unusable URL.
        self.assertEqual(
            client.generate_presigned_url.call_args[0][0], "get_object"
        )
        kwargs = client.generate_presigned_url.call_args.kwargs
        self.assertEqual(kwargs["Params"]["Bucket"], vs.STORAGE_BUCKET)
        self.assertEqual(kwargs["Params"]["Key"], "u1/faceless/t/final-1.mp4")
        self.assertEqual(kwargs["ExpiresIn"], 600)

    def test_failure_returns_none(self):
        client = MagicMock()
        client.generate_presigned_url.side_effect = RuntimeError("boom")
        with patch("app.services.video_storage._r2_client", return_value=client):
            self.assertIsNone(vs.create_signed_url_r2("u1/faceless/t/final-1.mp4"))

    def test_not_configured_raises(self):
        with _isolated_environ({}):
            with patch("app.services.video_storage._r2_client") as factory:
                with self.assertRaisesRegex(RuntimeError, "R2 video storage is required"):
                    vs.create_signed_url_r2("p")
                factory.assert_not_called()

    def test_serving_wrapper_returns_none_when_unconfigured(self):
        # The serving-facing wrapper degrades to None (callers 404); only
        # create_signed_url_r2 fails fast.
        with _isolated_environ({}):
            with patch("app.services.video_storage._r2_client") as factory:
                self.assertIsNone(vs.create_signed_url("u1/faceless/t/final-1.mp4"))
                factory.assert_not_called()

    def test_serving_wrapper_delegates_with_path_and_ttl(self):
        # The wrapper must forward both arguments unchanged; a dropped or
        # None-swapped argument would sign the wrong object (or TTL).
        with patch.object(
            vs, "create_signed_url_r2", return_value="https://signed"
        ) as sign:
            self.assertEqual(
                vs.create_signed_url("u1/f/t/final-1.mp4", expires_in=123),
                "https://signed",
            )
            sign.assert_called_once_with("u1/f/t/final-1.mp4", 123)


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


class ReadFinalVideoR2Tests(unittest.TestCase):
    def setUp(self):
        self.enterContext(_isolated_environ({
                "R2_ACCOUNT_ID": "acct",
                "R2_ACCESS_KEY_ID": "key-id",
                "R2_SECRET_ACCESS_KEY": "secret",
            }))

    def test_reads_and_closes_r2_body(self):
        body = MagicMock()
        body.read.return_value = b"archived-mp4"
        client = MagicMock()
        client.get_object.return_value = {"Body": body}
        with patch.object(vs, "_r2_client", return_value=client):
            result = vs.read_final_video_r2("u/f/task/final-1.mp4")
        self.assertEqual(result, b"archived-mp4")
        client.get_object.assert_called_once_with(
            Bucket=vs.STORAGE_BUCKET, Key="u/f/task/final-1.mp4"
        )
        body.close.assert_called_once()

    def test_refuses_to_read_when_r2_is_not_configured(self):
        with _isolated_environ({}):
            with self.assertRaisesRegex(RuntimeError, "R2 video storage is required"):
                vs.read_final_video_r2("u/f/task/final-1.mp4")

    def test_does_not_return_an_empty_object(self):
        body = MagicMock()
        body.read.return_value = b""
        client = MagicMock()
        client.get_object.return_value = {"Body": body}
        with patch.object(vs, "_r2_client", return_value=client):
            with self.assertRaisesRegex(RuntimeError, "is empty"):
                vs.read_final_video_r2("u/f/task/final-1.mp4")

    def test_r2_read_failure_raises_explicitly(self):
        # A failed GET must surface as an explicit RuntimeError naming the
        # object — never a swallowed None or an empty message.
        client = MagicMock()
        client.get_object.side_effect = RuntimeError("boom")
        with patch.object(vs, "_r2_client", return_value=client):
            with self.assertRaises(RuntimeError) as ctx:
                vs.read_final_video_r2("u/f/task/final-1.mp4")
        self.assertEqual(
            str(ctx.exception),
            "could not read archived video u/f/task/final-1.mp4 from R2",
        )


if __name__ == "__main__":
    unittest.main()

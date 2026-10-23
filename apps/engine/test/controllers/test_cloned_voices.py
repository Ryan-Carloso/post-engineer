"""HTTP tests for cloned voice endpoints (registry + store mocked)."""

import io
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.asgi import app


class ClonedVoicesControllerTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.headers = {
            "authorization": "Bearer test-shared-secret",
            "x-user-id": "user-uuid-1",
        }
        patcher = patch.dict("os.environ", {"MONEYPRINT_API_SECRET": "test-shared-secret"})
        patcher.start()
        self.addCleanup(patcher.stop)

    @patch("app.controllers.v1.cloned_voices.ClonedVoiceService")
    def test_create_returns_202_and_schedules_background(self, mock_service_cls):
        service = MagicMock()
        mock_service_cls.return_value = service
        service.create_from_upload.return_value = {
            "row": {
                "id": "clone-1",
                "status": "pending",
                "engine_voice_key": "uabc_clone1",
                "language": "en",
                "consent_at": "2026-01-01T00:00:00Z",
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
            },
            "wav_bytes": b"wav",
            "language": "en",
        }

        response = self.client.post(
            "/api/v1/cloned-voices",
            headers=self.headers,
            data={"language": "en", "consent": "true", "denoise": "true"},
            files={"file": ("sample.wav", io.BytesIO(b"data"), "audio/wav")},
        )

        self.assertEqual(response.status_code, 202)
        body = response.json()
        self.assertEqual(body["status"], 202)
        self.assertEqual(body["body"]["id"], "clone-1")
        service.create_from_upload.assert_called_once()
        # TestClient runs background tasks before returning, so the scheduled
        # registration must already have fired with the created payload.
        service.complete_registration.assert_called_once_with(
            "user-uuid-1", "clone-1", b"wav", "en"
        )

    @patch("app.controllers.v1.cloned_voices.ClonedVoiceService")
    def test_create_rejects_language_with_toml_breaking_characters(self, mock_service_cls):
        service = MagicMock()
        mock_service_cls.return_value = service

        response = self.client.post(
            "/api/v1/cloned-voices",
            headers=self.headers,
            data={"language": "en\n[injected]", "consent": "true", "denoise": "true"},
            files={"file": ("sample.wav", io.BytesIO(b"data"), "audio/wav")},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["message"], "language is invalid")
        service.create_from_upload.assert_not_called()

    @patch("app.controllers.v1.cloned_voices.ClonedVoiceService")
    def test_create_rejects_malformed_language_codes(self, mock_service_cls):
        service = MagicMock()
        mock_service_cls.return_value = service

        for language in ("e", "english", "en us", "en-", "-en", "en-u"):
            with self.subTest(language=language):
                response = self.client.post(
                    "/api/v1/cloned-voices",
                    headers=self.headers,
                    data={"language": language, "consent": "true", "denoise": "true"},
                    files={"file": ("sample.wav", io.BytesIO(b"data"), "audio/wav")},
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["message"], "language is invalid")
        service.create_from_upload.assert_not_called()

    @patch("app.controllers.v1.cloned_voices.ClonedVoiceService")
    def test_create_accepts_region_language_code(self, mock_service_cls):
        service = MagicMock()
        mock_service_cls.return_value = service
        service.create_from_upload.return_value = {
            "row": {
                "id": "clone-1",
                "status": "pending",
                "engine_voice_key": "uabc_clone1",
                "language": "en-GB",
                "consent_at": "2026-01-01T00:00:00Z",
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
            },
            "wav_bytes": b"wav",
            "language": "en-GB",
        }

        response = self.client.post(
            "/api/v1/cloned-voices",
            headers=self.headers,
            data={"language": "en-GB", "consent": "true", "denoise": "true"},
            files={"file": ("sample.wav", io.BytesIO(b"data"), "audio/wav")},
        )

        self.assertEqual(response.status_code, 202)
        service.create_from_upload.assert_called_once_with(
            "user-uuid-1", b"data", "en-GB", consent_acknowledged=True, denoise=True
        )

    @patch("app.controllers.v1.cloned_voices.ClonedVoiceService")
    def test_create_rejects_non_english_languages(self, mock_service_cls):
        service = MagicMock()
        mock_service_cls.return_value = service

        for language in ("pt", "pt-BR", "es", "fr", "enx"):
            with self.subTest(language=language):
                response = self.client.post(
                    "/api/v1/cloned-voices",
                    headers=self.headers,
                    data={"language": language, "consent": "true", "denoise": "true"},
                    files={"file": ("sample.wav", io.BytesIO(b"data"), "audio/wav")},
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(
                    response.json()["message"],
                    "Voice cloning is only available in English for now",
                )
        service.create_from_upload.assert_not_called()

    @patch("app.controllers.v1.cloned_voices.ClonedVoiceService")
    def test_create_accepts_english_language_variants(self, mock_service_cls):
        service = MagicMock()
        mock_service_cls.return_value = service
        service.create_from_upload.return_value = {
            "row": {
                "id": "clone-1",
                "status": "pending",
                "engine_voice_key": "uabc_clone1",
                "language": "en",
                "consent_at": "2026-01-01T00:00:00Z",
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
            },
            "wav_bytes": b"wav",
            "language": "en",
        }

        for language in ("en", "en-US", "EN", "En-Gb"):
            with self.subTest(language=language):
                service.create_from_upload.reset_mock()
                response = self.client.post(
                    "/api/v1/cloned-voices",
                    headers=self.headers,
                    data={"language": language, "consent": "true", "denoise": "true"},
                    files={"file": ("sample.wav", io.BytesIO(b"data"), "audio/wav")},
                )
                self.assertEqual(response.status_code, 202)
                service.create_from_upload.assert_called_once()

    def test_list_requires_auth(self):
        response = self.client.get("/api/v1/cloned-voices")
        self.assertEqual(response.status_code, 401)

    @patch("app.controllers.v1.cloned_voices.ClonedVoiceService")
    @patch("app.controllers.v1.cloned_voices.MAX_REFERENCE_BYTES", 4)
    def test_create_rejects_oversized_upload_before_buffering(self, mock_service_cls):
        service = MagicMock()
        mock_service_cls.return_value = service

        response = self.client.post(
            "/api/v1/cloned-voices",
            headers=self.headers,
            data={"language": "en", "consent": "true", "denoise": "true"},
            files={"file": ("sample.wav", io.BytesIO(b"0123456789"), "audio/wav")},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["body"]["error_code"], "audio_too_large")
        service.create_from_upload.assert_not_called()

    @patch("app.controllers.v1.cloned_voices.ClonedVoiceService")
    def test_get_returns_public_row(self, mock_service_cls):
        service = MagicMock()
        mock_service_cls.return_value = service
        service._store.get_for_user.return_value = {
            "id": "clone-1",
            "status": "ready",
            "engine_voice_key": "uabc_clone1",
            "language": "pt",
            "consent_at": "2026-01-01T00:00:00Z",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }
        response = self.client.get("/api/v1/cloned-voices/clone-1", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["body"]["voice_id"], "chatterbox:uabc_clone1")

    @patch("app.controllers.v1.cloned_voices.ClonedVoiceService")
    def test_get_missing_returns_404(self, mock_service_cls):
        service = MagicMock()
        mock_service_cls.return_value = service
        service._store.get_for_user.return_value = None
        response = self.client.get("/api/v1/cloned-voices/missing", headers=self.headers)
        self.assertEqual(response.status_code, 404)

    @patch("app.controllers.v1.cloned_voices.ClonedVoiceService")
    def test_delete_returns_404_when_not_found(self, mock_service_cls):
        service = MagicMock()
        mock_service_cls.return_value = service
        service.delete.return_value = False
        response = self.client.delete("/api/v1/cloned-voices/clone-1", headers=self.headers)
        self.assertEqual(response.status_code, 404)

    @patch("app.controllers.v1.cloned_voices.ClonedVoiceService")
    def test_create_passes_denoise_flag_to_service(self, mock_service_cls):
        service = MagicMock()
        mock_service_cls.return_value = service
        service.create_from_upload.return_value = {
            "row": {"id": "clone-1", "status": "pending"},
            "wav_bytes": b"wav",
            "language": "en",
        }
        for raw, expected in (("true", True), ("FALSE", False)):
            service.create_from_upload.reset_mock()
            response = self.client.post(
                "/api/v1/cloned-voices",
                headers=self.headers,
                data={"language": "en", "consent": "true", "denoise": raw},
                files={"file": ("sample.wav", io.BytesIO(b"data"), "audio/wav")},
            )
            self.assertEqual(response.status_code, 202)
            self.assertIs(service.create_from_upload.call_args.kwargs["denoise"], expected)

    @patch("app.controllers.v1.cloned_voices.ClonedVoiceService")
    def test_create_rejects_missing_or_malformed_denoise(self, mock_service_cls):
        service = MagicMock()
        mock_service_cls.return_value = service
        for data in (
            {"language": "en", "consent": "true"},
            {"language": "en", "consent": "true", "denoise": "yes"},
        ):
            response = self.client.post(
                "/api/v1/cloned-voices",
                headers=self.headers,
                data=data,
                files={"file": ("sample.wav", io.BytesIO(b"data"), "audio/wav")},
            )
            self.assertIn(response.status_code, (400, 422))
        service.create_from_upload.assert_not_called()

    @patch("app.controllers.v1.cloned_voices.normalize_reference_audio")
    def test_denoise_preview_returns_cleaned_wav(self, mock_normalize):
        mock_normalize.return_value = MagicMock(wav_bytes=b"clean-wav")
        response = self.client.post(
            "/api/v1/cloned-voices/denoise-preview",
            headers=self.headers,
            files={"file": ("sample.webm", io.BytesIO(b"raw"), "audio/webm")},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"clean-wav")
        self.assertEqual(response.headers.get("content-type"), "audio/wav")
        mock_normalize.assert_called_once_with(b"raw", denoise=True)

    @patch("app.controllers.v1.cloned_voices.normalize_reference_audio")
    def test_denoise_preview_maps_reference_errors_to_400(self, mock_normalize):
        from app.services.cloned_voices.audio import ReferenceAudioError

        mock_normalize.side_effect = ReferenceAudioError("invalid_audio", "could not decode reference audio")
        response = self.client.post(
            "/api/v1/cloned-voices/denoise-preview",
            headers=self.headers,
            files={"file": ("sample.webm", io.BytesIO(b"raw"), "audio/webm")},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["body"]["error_code"], "invalid_audio")

    @patch("app.controllers.v1.cloned_voices.normalize_reference_audio")
    def test_reference_errors_never_echo_the_exception_text(self, mock_normalize):
        from app.services.cloned_voices.audio import ReferenceAudioError

        mock_normalize.side_effect = ReferenceAudioError("invalid_audio", "ffmpeg: /tmp/secret-path failed")
        response = self.client.post(
            "/api/v1/cloned-voices/denoise-preview",
            headers=self.headers,
            files={"file": ("sample.webm", io.BytesIO(b"raw"), "audio/webm")},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["message"], "could not decode reference audio")
        self.assertNotIn("secret-path", response.text)

    @patch("app.controllers.v1.cloned_voices.ClonedVoiceService")
    def test_preview_unknown_error_code_gets_generic_message(self, mock_service_cls):
        from app.services.cloned_voices.audio import ReferenceAudioError

        service = MagicMock()
        mock_service_cls.return_value = service
        service.preview_mp3.side_effect = ReferenceAudioError("something_new", "internal detail")
        response = self.client.post("/api/v1/cloned-voices/clone-1/preview", headers=self.headers)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["message"], "cloned voice request failed")
        self.assertEqual(response.json()["body"]["error_code"], "request_failed")

    def test_denoise_preview_requires_auth(self):
        response = self.client.post(
            "/api/v1/cloned-voices/denoise-preview",
            files={"file": ("sample.webm", io.BytesIO(b"raw"), "audio/webm")},
        )
        self.assertIn(response.status_code, (401, 403))

    @patch("app.controllers.v1.cloned_voices.ClonedVoiceService")
    def test_preview_returns_mpeg(self, mock_service_cls):
        service = MagicMock()
        mock_service_cls.return_value = service
        service.preview_mp3.return_value = b"mp3"
        response = self.client.post(
            "/api/v1/cloned-voices/clone-1/preview",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"mp3")
        self.assertEqual(response.headers.get("content-type"), "audio/mpeg")

    @patch("app.controllers.v1.cloned_voices.ClonedVoiceService")
    def test_preview_rejects_non_english_language(self, mock_service_cls):
        service = MagicMock()
        mock_service_cls.return_value = service

        for language in ("pt", "pt-BR", "es", "enx"):
            with self.subTest(language=language):
                response = self.client.post(
                    "/api/v1/cloned-voices/clone-1/preview",
                    headers=self.headers,
                    params={"language": language},
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(
                    response.json()["message"],
                    "Voice cloning is only available in English for now",
                )
        service.preview_mp3.assert_not_called()

    @patch("app.controllers.v1.cloned_voices.ClonedVoiceService")
    def test_preview_accepts_english_language_override(self, mock_service_cls):
        service = MagicMock()
        mock_service_cls.return_value = service
        service.preview_mp3.return_value = b"mp3"
        response = self.client.post(
            "/api/v1/cloned-voices/clone-1/preview",
            headers=self.headers,
            params={"language": "en-US"},
        )
        self.assertEqual(response.status_code, 200)
        service.preview_mp3.assert_called_once_with(
            "user-uuid-1", "clone-1", language="en-US"
        )

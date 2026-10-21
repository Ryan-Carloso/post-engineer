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
            data={"language": "en", "consent": "true"},
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
            data={"language": "en\n[injected]", "consent": "true"},
            files={"file": ("sample.wav", io.BytesIO(b"data"), "audio/wav")},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["message"], "language is invalid")
        service.create_from_upload.assert_not_called()

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
            data={"language": "en", "consent": "true"},
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

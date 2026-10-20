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

    @patch("app.controllers.v1.cloned_voices.ClonedVoiceService")
    def test_list_requires_auth(self, _mock_service_cls):
        response = self.client.get("/api/v1/cloned-voices")
        self.assertEqual(response.status_code, 401)

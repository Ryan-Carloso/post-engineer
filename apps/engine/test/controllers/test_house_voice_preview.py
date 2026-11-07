"""HTTP tests for the house voice preview endpoint (synthesis mocked)."""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.asgi import app
from app.services.cloned_voices.preview_text import PREVIEW_TEXT_INVALID_MESSAGE
from app.services.persona import HouseVoicePreviewError


class HouseVoicePreviewControllerTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.headers = {
            "authorization": "Bearer test-shared-secret",
            "x-user-id": "user-uuid-1",
        }
        patcher = patch.dict("os.environ", {"MONEYPRINT_API_SECRET": "test-shared-secret"})
        patcher.start()
        self.addCleanup(patcher.stop)

    @patch("app.services.persona.preview_house_voice_mp3")
    def test_preview_returns_mpeg_with_custom_text(self, mock_preview):
        mock_preview.return_value = b"mp3"
        response = self.client.post(
            "/api/v1/personas/voices/chatterbox:phonon_zoey/preview",
            headers=self.headers,
            json={"text": "Hello world"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "audio/mpeg")
        self.assertEqual(response.content, b"mp3")
        mock_preview.assert_called_once_with(
            "user-uuid-1", "chatterbox:phonon_zoey", text="Hello world"
        )

    @patch("app.services.persona.preview_house_voice_mp3")
    def test_preview_without_body_uses_fixed_sample(self, mock_preview):
        mock_preview.return_value = b"mp3"
        response = self.client.post(
            "/api/v1/personas/voices/chatterbox:phonon_zoey/preview",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        mock_preview.assert_called_once_with("user-uuid-1", "chatterbox:phonon_zoey", text=None)

    @patch("app.services.persona.preview_house_voice_mp3")
    def test_preview_unknown_voice_is_404(self, mock_preview):
        mock_preview.side_effect = HouseVoicePreviewError(404, "voice not found")
        response = self.client.post(
            "/api/v1/personas/voices/chatterbox:nope/preview",
            headers=self.headers,
            json={"text": "Hello world"},
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["message"], "voice not found")

    @patch("app.services.persona.preview_house_voice_mp3")
    def test_preview_overlong_text_is_400_with_stable_message(self, mock_preview):
        mock_preview.side_effect = HouseVoicePreviewError(400, PREVIEW_TEXT_INVALID_MESSAGE)
        response = self.client.post(
            "/api/v1/personas/voices/chatterbox:phonon_zoey/preview",
            headers=self.headers,
            json={"text": "x" * 301},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["message"], PREVIEW_TEXT_INVALID_MESSAGE)
        # The rejection never echoes the submitted text.
        self.assertNotIn("x" * 10, response.text)

    @patch("app.services.persona.preview_house_voice_mp3")
    def test_preview_synthesis_failure_is_502(self, mock_preview):
        mock_preview.side_effect = HouseVoicePreviewError(502, "voice preview failed")
        response = self.client.post(
            "/api/v1/personas/voices/chatterbox:phonon_zoey/preview",
            headers=self.headers,
            json={"text": "Hello world"},
        )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["message"], "voice preview failed")

    @patch("app.services.persona.preview_house_voice_mp3")
    def test_preview_requires_auth(self, mock_preview):
        response = self.client.post(
            "/api/v1/personas/voices/chatterbox:phonon_zoey/preview",
            json={"text": "Hello world"},
        )
        self.assertEqual(response.status_code, 401)
        mock_preview.assert_not_called()

    @patch("app.services.persona.preview_house_voice_mp3")
    def test_preview_non_string_text_is_400(self, mock_preview):
        response = self.client.post(
            "/api/v1/personas/voices/chatterbox:phonon_zoey/preview",
            headers=self.headers,
            json={"text": 42},
        )
        self.assertEqual(response.status_code, 400)
        mock_preview.assert_not_called()

    def test_openapi_documents_mpeg_success_and_error_responses(self):
        # The endpoint streams MP3, not JSON: the committed spec must say
        # audio/mpeg for 200 and document the 400/404/502 the handler
        # returns. The spec's 422 is FastAPI's auto-documented default for
        # body params; the app's handler (app/asgi.py) maps actual
        # validation failures to 400, so no 422 is ever returned.
        responses = app.openapi()["paths"][
            "/api/v1/personas/voices/{voice_id}/preview"
        ]["post"]["responses"]
        self.assertEqual(set(responses["200"]["content"]), {"audio/mpeg"})
        self.assertEqual(
            responses["200"]["content"]["audio/mpeg"]["schema"],
            {"type": "string", "format": "binary"},
        )
        for status in ("400", "404", "422", "502"):
            self.assertIn(status, responses)
            self.assertEqual(
                set(responses[status]["content"]),
                {"application/json"},
            )

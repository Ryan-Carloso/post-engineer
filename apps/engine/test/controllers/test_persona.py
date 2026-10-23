"""Persona endpoints wrap their payload under the `body` envelope key.

The engine's {status, data, message} envelope was renamed to
{status, body, message}; these tests pin that the persona endpoints
return BaseResponse with the payload under `body`.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.controllers.v1 import persona as persona_controller


class PersonaEnvelopeTests(unittest.TestCase):
    def test_house_voices_wrapped_in_body(self):
        from unittest.mock import MagicMock, patch

        from app.controllers.base import AuthContext

        request = MagicMock()
        request.state.auth = AuthContext(user_id="test-user")
        with patch(
            "app.services.cloned_voices.service.list_catalog_entries",
            return_value=[],
        ):
            resp = persona_controller.list_house_voices_endpoint(request)
        self.assertIsInstance(resp.body, list)
        self.assertGreater(len(resp.body), 0)

    def test_sample_languages_wrapped_in_body(self):
        resp = persona_controller.list_sample_languages_endpoint()
        self.assertIsInstance(resp.body, list)
        self.assertGreater(len(resp.body), 0)

    def test_voice_sample_returns_audio_for_catalog_voice(self):
        from unittest.mock import patch

        with patch(
            "app.controllers.v1.persona.persona_service.get_voice_sample",
            return_value=b"mp3-bytes",
        ):
            resp = persona_controller.voice_sample_endpoint("phonon:Zoey")
        self.assertEqual(resp.media_type, "audio/mpeg")
        self.assertEqual(resp.body, b"mp3-bytes")

    def test_voice_sample_400_when_unavailable(self):
        from unittest.mock import patch

        with patch(
            "app.controllers.v1.persona.persona_service.get_voice_sample",
            return_value=None,
        ):
            resp = persona_controller.voice_sample_endpoint("elevenlabs:nope")
        self.assertEqual(resp.status_code, 400)

    def test_validate_persona_wraps_normalized_in_body(self):
        request = persona_controller.PersonaRequest(
            name="Ana",
            avatar_url="https://example.com/avatar.png",
            voice_id="v1",
        )
        resp = persona_controller.validate_persona_endpoint(request)
        self.assertIsInstance(resp.body, dict)
        self.assertEqual(resp.body.get("name"), "Ana")


class PersonaSampleAuthHttpTests(unittest.TestCase):
    """HTTP-level auth for the voice sample route.

    The handler itself takes no Request: it is authenticated by the
    router-level Depends(verify_token) that new_router() sets and
    FastAPI propagates to routes included via include_router. These
    tests pin that propagation end to end — a regression here would
    expose paid local synthesis (and first-call model downloads) to
    anyone who can reach the engine port.
    """

    def setUp(self):
        from unittest.mock import patch

        from fastapi.testclient import TestClient

        from app.asgi import app

        self.client = TestClient(app)
        patcher = patch.dict(
            "os.environ", {"MONEYPRINT_API_SECRET": "test-shared-secret"}
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.headers = {
            "authorization": "Bearer test-shared-secret",
            "x-user-id": "user-uuid-1",
        }
        self.url = "/api/v1/personas/voices/phonon:Zoey/sample"

    def test_sample_requires_authentication(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 401)

    def test_sample_rejects_a_wrong_secret(self):
        headers = dict(self.headers, authorization="Bearer wrong-secret")
        response = self.client.get(self.url, headers=headers)
        self.assertEqual(response.status_code, 401)

    def test_sample_serves_audio_to_an_authenticated_caller(self):
        from unittest.mock import patch

        with patch(
            "app.controllers.v1.persona.persona_service.get_voice_sample",
            return_value=b"mp3-bytes",
        ):
            response = self.client.get(self.url, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "audio/mpeg")
        self.assertEqual(response.content, b"mp3-bytes")

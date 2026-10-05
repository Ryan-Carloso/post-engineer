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
        resp = persona_controller.list_house_voices_endpoint()
        self.assertIsInstance(resp.body, list)
        self.assertGreater(len(resp.body), 0)

    def test_sample_languages_wrapped_in_body(self):
        resp = persona_controller.list_sample_languages_endpoint()
        self.assertIsInstance(resp.body, list)
        self.assertGreater(len(resp.body), 0)

    def test_validate_persona_wraps_normalized_in_body(self):
        request = persona_controller.PersonaRequest(
            name="Ana",
            avatar_url="https://example.com/avatar.png",
            voice_id="v1",
        )
        resp = persona_controller.validate_persona_endpoint(request)
        self.assertIsInstance(resp.body, dict)
        self.assertEqual(resp.body.get("name"), "Ana")

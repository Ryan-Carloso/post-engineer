"""Unit tests for HttpChatterboxVoiceRegistry."""

import base64
import unittest
from unittest.mock import MagicMock

from app.services.cloned_voices.chatterbox_registry import (
    HttpChatterboxVoiceRegistry,
    RegistryNotConfiguredError,
)


class ChatterboxRegistryClientTest(unittest.TestCase):
    def test_register_posts_json_payload(self) -> None:
        requests = MagicMock()
        response = MagicMock()
        response.status_code = 201
        requests.post.return_value = response
        registry = HttpChatterboxVoiceRegistry(
            base_url="https://chatterbox.example",
            api_key="secret",
            requests_module=requests,
        )
        wav = b"RIFF....WAVE"
        registry.register_voice("uabc_def012", "pt", wav)
        requests.post.assert_called_once()
        args, kwargs = requests.post.call_args
        self.assertEqual(args[0], "https://chatterbox.example/v1/voices")
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer secret")
        payload = kwargs["json"]
        self.assertEqual(payload["voice"], "uabc_def012")
        self.assertEqual(payload["language_id"], "pt")
        self.assertEqual(base64.b64decode(payload["reference_wav_base64"]), wav)

    def test_register_raises_on_http_error(self) -> None:
        requests = MagicMock()
        response = MagicMock()
        response.status_code = 500
        requests.post.return_value = response
        registry = HttpChatterboxVoiceRegistry(
            base_url="https://chatterbox.example",
            api_key="",
            requests_module=requests,
        )
        with self.assertRaises(RuntimeError):
            registry.register_voice("voice1", "en", b"wav")

    def test_delete_treats_404_as_success(self) -> None:
        requests = MagicMock()
        response = MagicMock()
        response.status_code = 404
        requests.delete.return_value = response
        registry = HttpChatterboxVoiceRegistry(
            base_url="https://chatterbox.example",
            api_key="k",
            requests_module=requests,
        )
        registry.delete_voice("gone")
        requests.delete.assert_called_once_with(
            "https://chatterbox.example/v1/voices/gone",
            headers={"Content-Type": "application/json", "Authorization": "Bearer k"},
            timeout=60,
        )

    def test_missing_base_url_raises_not_configured(self) -> None:
        registry = HttpChatterboxVoiceRegistry(base_url="", api_key="k", requests_module=MagicMock())
        with self.assertRaises(RegistryNotConfiguredError):
            registry.register_voice("v", "pt", b"x")

    def test_delete_raises_on_server_error(self) -> None:
        requests = MagicMock()
        response = MagicMock()
        response.status_code = 503
        requests.delete.return_value = response
        registry = HttpChatterboxVoiceRegistry(
            base_url="https://chatterbox.example",
            api_key="",
            requests_module=requests,
        )
        with self.assertRaises(RuntimeError):
            registry.delete_voice("voice1")

    def test_register_omits_auth_header_without_api_key(self) -> None:
        requests = MagicMock()
        response = MagicMock()
        response.status_code = 201
        requests.post.return_value = response
        registry = HttpChatterboxVoiceRegistry(
            base_url="https://chatterbox.example",
            api_key="",
            requests_module=requests,
        )
        registry.register_voice("uabc_def012", "en", b"wav")
        headers = requests.post.call_args.kwargs["headers"]
        self.assertEqual(headers, {"Content-Type": "application/json"})
        self.assertNotIn("Authorization", headers)


if __name__ == "__main__":
    unittest.main()

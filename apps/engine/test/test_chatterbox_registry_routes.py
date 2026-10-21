"""Route tests for the Modal chatterbox registry endpoints (POST/DELETE /v1/voices)."""

import base64
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from chatterbox_registry_volume import load_voices_toml
from modal_chatterbox_registry_routes import mount_chatterbox_registry_routes

WAV_BYTES = b"RIFF" + b"\x24\x00\x00\x00" + b"WAVE" + b"fmt " + b"\x00" * 28


class ChatterboxRegistryRoutesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.voices_dir = Path(self.work.name) / "voices"
        self.voices_dir.mkdir()
        self.config_path = self.voices_dir / "voices.toml"
        self.events: list[str] = []
        self.authorized = True

        def authorize(_request: object) -> JSONResponse | None:
            if self.authorized:
                return None
            return JSONResponse(status_code=401, content={"error": "unauthorized"})

        app = FastAPI()
        mount_chatterbox_registry_routes(
            app,
            voices_dir=str(self.voices_dir),
            voices_config_path=str(self.config_path),
            commit_volume=lambda: self.events.append("commit"),
            authorize=authorize,
            reload_volume=lambda: self.events.append("reload"),
        )
        self.client = TestClient(app)

    def _payload(self, **overrides: object) -> dict[str, object]:
        payload: dict[str, object] = {
            "voice": "u0123456789ab_0123456789ab",
            "language_id": "en",
            "reference_wav_base64": base64.b64encode(WAV_BYTES).decode("ascii"),
        }
        payload.update(overrides)
        return payload

    def test_register_writes_voice_and_reloads_before_commit(self) -> None:
        response = self.client.post("/v1/voices", json=self._payload())
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json(), {"voice": "u0123456789ab_0123456789ab", "language_id": "en"})
        self.assertTrue((self.voices_dir / "u0123456789ab_0123456789ab" / "reference.wav").is_file())
        self.assertEqual(load_voices_toml(self.config_path)["u0123456789ab_0123456789ab"]["language_id"], "en")
        self.assertEqual(self.events, ["reload", "commit"])

    def test_register_rejects_invalid_voice_name(self) -> None:
        response = self.client.post("/v1/voices", json=self._payload(voice="../evil"))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.events, [])

    def test_register_rejects_non_wav_payload(self) -> None:
        response = self.client.post(
            "/v1/voices",
            json=self._payload(
                reference_wav_base64=base64.b64encode(b"not audio").decode("ascii")
            ),
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("not a WAV file", response.json()["error"])
        self.assertEqual(self.events, [])

    def test_register_rejects_language_with_toml_breaking_characters(self) -> None:
        response = self.client.post(
            "/v1/voices", json=self._payload(language_id="en\n[injected]")
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("not a valid language code", response.json()["error"])
        self.assertFalse(self.config_path.is_file())
        self.assertFalse((self.voices_dir / "u0123456789ab_0123456789ab" / "reference.wav").exists())
        # The volume reload ran, but a rejected registration never commits.
        self.assertEqual(self.events, ["reload"])

    def test_register_rejects_invalid_json(self) -> None:
        response = self.client.post(
            "/v1/voices",
            content="{not json",
            headers={"content-type": "application/json"},
        )
        self.assertEqual(response.status_code, 400)

    def test_register_requires_authorization(self) -> None:
        self.authorized = False
        response = self.client.post("/v1/voices", json=self._payload())
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.events, [])
        self.assertFalse(self.config_path.is_file())

    def test_delete_removes_voice_and_reloads_before_commit(self) -> None:
        self.client.post("/v1/voices", json=self._payload())
        self.events.clear()
        response = self.client.delete("/v1/voices/u0123456789ab_0123456789ab")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"voice": "u0123456789ab_0123456789ab", "deleted": True})
        self.assertNotIn("u0123456789ab_0123456789ab", load_voices_toml(self.config_path))
        self.assertEqual(self.events, ["reload", "commit"])

    def test_register_rejects_house_voice_name(self) -> None:
        response = self.client.post("/v1/voices", json=self._payload(voice="ryan"))
        self.assertEqual(response.status_code, 400)
        self.assertIn("user clone key", response.json()["error"])
        self.assertFalse(self.config_path.is_file())
        self.assertEqual(self.events, [])

    def test_delete_rejects_house_voice_name(self) -> None:
        response = self.client.delete("/v1/voices/ryan")
        self.assertEqual(response.status_code, 400)
        self.assertIn("user clone key", response.json()["error"])
        self.assertEqual(self.events, [])

    def test_delete_missing_voice_returns_404(self) -> None:
        response = self.client.delete("/v1/voices/u0123456789ab_ffffffffffff")
        self.assertEqual(response.status_code, 404)

    def test_routes_work_without_a_reload_hook(self) -> None:
        app = FastAPI()
        mount_chatterbox_registry_routes(
            app,
            voices_dir=str(self.voices_dir),
            voices_config_path=str(self.config_path),
            commit_volume=lambda: self.events.append("commit"),
            authorize=lambda _request: None,
        )
        client = TestClient(app)
        response = client.post("/v1/voices", json=self._payload())
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.events, ["commit"])


if __name__ == "__main__":
    unittest.main()

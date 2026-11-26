"""docker-compose.yml and the Dockerfile run only the publish worker.

The engine no longer renders video or speech: the `tts` service is gone (so
`docker compose up --remove-orphans` stops `mpt-tts-cpu` on the next deploy),
and the image carries no ffmpeg, fonts, songs or model volumes.
"""

import unittest
from pathlib import Path


def _compose_path() -> Path:
    here = Path(__file__).resolve()
    for parent in (here.parent, *here.parents):
        candidate = parent / "docker-compose.yml"
        if candidate.is_file():
            return candidate
    raise FileNotFoundError("docker-compose.yml not found above the test file")


def _compose() -> str:
    return _compose_path().read_text(encoding="utf-8")


def _dockerfile() -> str:
    return _compose_path().with_name("Dockerfile").read_text(encoding="utf-8")


class DockerComposeTest(unittest.TestCase):
    def test_runs_only_the_engine_service(self) -> None:
        compose = _compose()
        self.assertIn("\n  engine:\n", compose)
        self.assertNotIn("\n  tts:\n", compose)
        self.assertNotIn("mpt-tts-cpu", compose)
        self.assertNotIn("depends_on", compose)

    def test_passes_no_tts_or_model_settings(self) -> None:
        compose = _compose()
        for name in ("CHATTERBOX", "CLONED_VOICES", "whisper_models", "tts_voices", "tts_models", "MPT_STATE_BACKEND"):
            self.assertNotIn(name, compose)

    def test_health_check_uses_the_health_route(self) -> None:
        self.assertIn("http://127.0.0.1:8080/health", _compose())
        self.assertIn("http://127.0.0.1:8080/health", _dockerfile())

    def test_image_ships_no_render_assets(self) -> None:
        dockerfile = _dockerfile()
        for asset in ("ffmpeg", "resource/fonts", "resource/songs", "/app/models"):
            self.assertNotIn(asset, dockerfile)


if __name__ == "__main__":
    unittest.main()

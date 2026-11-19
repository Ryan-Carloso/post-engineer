"""docker-compose.yml: the engine service persists its Whisper models.

The faster-whisper model downloads from HuggingFace on first subtitle use
and lives under /app/models in the container. Without a named volume a
redeploy wipes it and the next render re-downloads it (~3 GB for large-v3).
"""

import unittest
from pathlib import Path

import yaml


def _compose_path() -> Path:
    here = Path(__file__).resolve()
    for parent in (here.parent, *here.parents):
        candidate = parent / "docker-compose.yml"
        if candidate.is_file():
            return candidate
    raise FileNotFoundError("docker-compose.yml not found above the test file")


def _load_compose() -> dict:
    return yaml.safe_load(_compose_path().read_text(encoding="utf-8"))


class DockerComposeTest(unittest.TestCase):
    def test_engine_service_mounts_whisper_models_volume(self) -> None:
        compose = _load_compose()
        volumes = compose["services"]["engine"]["volumes"]
        self.assertIn("whisper_models:/app/models", volumes)

    def test_whisper_models_volume_is_declared(self) -> None:
        compose = _load_compose()
        self.assertIn("whisper_models", compose["volumes"])


if __name__ == "__main__":
    unittest.main()

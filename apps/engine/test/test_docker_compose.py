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


def _dockerfile_path() -> Path:
    return _compose_path().with_name("Dockerfile")


class DockerComposeTest(unittest.TestCase):
    def test_engine_service_mounts_whisper_models_volume(self) -> None:
        compose = _load_compose()
        volumes = compose["services"]["engine"]["volumes"]
        self.assertIn("whisper_models:/app/models", volumes)

    def test_whisper_models_volume_is_declared(self) -> None:
        compose = _load_compose()
        self.assertIn("whisper_models", compose["volumes"])

    def test_dockerfile_creates_the_models_dir_before_dropping_privileges(self) -> None:
        """A named volume mounted on a path the image lacks is root-owned.

        The engine runs as uid 10001, so the mount point must exist in the
        image (owned by that user) or the model download fails with EACCES.
        """
        dockerfile = _dockerfile_path().read_text(encoding="utf-8")
        mkdir_line = next(line for line in dockerfile.splitlines() if "mkdir -p" in line)
        self.assertIn("/app/models", mkdir_line)
        self.assertLess(dockerfile.index("/app/models"), dockerfile.index("USER engine"))


if __name__ == "__main__":
    unittest.main()

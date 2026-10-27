"""config.example.toml documents the visual verifier the way the code behaves."""

import tomllib
from pathlib import Path

from app.services import siglip_model

EXAMPLE = Path(__file__).resolve().parents[2] / "config.example.toml"


def test_example_keeps_verification_off_by_default():
    app = tomllib.loads(EXAMPLE.read_text(encoding="utf-8"))["app"]
    assert app["material_verification_enabled"] is False
    assert app["material_verification_model_path"] == ""


def test_example_names_the_model_file_and_the_docker_path():
    text = EXAMPLE.read_text(encoding="utf-8")
    assert f"/app/storage/models/siglip/{siglip_model.MODEL_FILE}" in text
    assert "preview image" in text

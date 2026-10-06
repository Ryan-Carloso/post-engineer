"""Tests for build-metadata reporting: GET /version and GET /health.

Both endpoints are unauthenticated on purpose: they let anyone verify which
exact build is live (version + CI build number + commit SHA, e.g. after a
merge + deploy) without a session or API key.

Build metadata comes from the VERSION/BUILD/COMMIT env vars injected at
build/deploy time (CI sets them from the repo-root VERSION file, the CI run
number, and the commit SHA). Precedence:

  1. VERSION/BUILD/COMMIT env vars (injected, authoritative)
  2. the repo-root VERSION file mounted into the container (version only)
  3. "dev" for the version; null for build/commit

Reporting must never break the app: malformed values degrade to the
fallback instead of raising.
"""

import os
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import asgi


def _write_version(tmp_path, content: str) -> str:
    version_file = tmp_path / "VERSION"
    version_file.write_text(content, encoding="utf-8")
    return str(version_file)


def _clear_build_env(monkeypatch):
    for var in ("VERSION", "BUILD", "COMMIT"):
        monkeypatch.delenv(var, raising=False)


def _get_json(path: str) -> dict:
    client = TestClient(asgi.app)
    response = client.get(path)
    assert response.status_code == 200
    return response.json()


def test_version_reports_injected_build_metadata(tmp_path, monkeypatch):
    monkeypatch.setattr(asgi, "VERSION_FILE", _write_version(tmp_path, "1.5.0\n"))
    with patch.dict(
        os.environ,
        {"VERSION": "1.8.0", "BUILD": "502", "COMMIT": "abc123"},
        clear=False,
    ):
        assert _get_json("/version") == {
            "version": "1.8.0",
            "build": 502,
            "commit": "abc123",
        }


def test_health_includes_build_metadata(tmp_path, monkeypatch):
    monkeypatch.setattr(asgi, "VERSION_FILE", _write_version(tmp_path, "1.5.0\n"))
    with patch.dict(
        os.environ,
        {"VERSION": "1.8.0", "BUILD": "502", "COMMIT": "abc123"},
        clear=False,
    ):
        assert _get_json("/health") == {
            "status": "ok",
            "version": "1.8.0",
            "build": 502,
            "commit": "abc123",
        }


def test_env_version_beats_version_file(tmp_path, monkeypatch):
    monkeypatch.setattr(asgi, "VERSION_FILE", _write_version(tmp_path, "1.5.0\n"))
    with patch.dict(os.environ, {"VERSION": "9.9.9"}, clear=False):
        _clear_build_env(monkeypatch)
        monkeypatch.setenv("VERSION", "9.9.9")
        assert _get_json("/health")["version"] == "9.9.9"


def test_version_file_fallback_without_env(tmp_path, monkeypatch):
    monkeypatch.setattr(asgi, "VERSION_FILE", _write_version(tmp_path, "1.5.0\n"))
    _clear_build_env(monkeypatch)
    assert _get_json("/version") == {
        "version": "1.5.0",
        "build": None,
        "commit": None,
    }


def test_version_defaults_to_dev_without_file_or_env(tmp_path, monkeypatch):
    monkeypatch.setattr(asgi, "VERSION_FILE", str(tmp_path / "MISSING"))
    _clear_build_env(monkeypatch)
    assert _get_json("/health") == {
        "status": "ok",
        "version": "dev",
        "build": None,
        "commit": None,
    }


def test_malformed_build_degrades_to_null(tmp_path, monkeypatch):
    monkeypatch.setattr(asgi, "VERSION_FILE", str(tmp_path / "MISSING"))
    _clear_build_env(monkeypatch)
    monkeypatch.setenv("VERSION", "1.8.0")
    monkeypatch.setenv("BUILD", "not-a-number")
    assert _get_json("/version")["build"] is None


def test_blank_commit_degrades_to_null(tmp_path, monkeypatch):
    monkeypatch.setattr(asgi, "VERSION_FILE", str(tmp_path / "MISSING"))
    _clear_build_env(monkeypatch)
    monkeypatch.setenv("VERSION", "1.8.0")
    monkeypatch.setenv("COMMIT", "   ")
    assert _get_json("/version")["commit"] is None


def test_get_build_info_trims_values(tmp_path, monkeypatch):
    monkeypatch.setattr(asgi, "VERSION_FILE", str(tmp_path / "MISSING"))
    _clear_build_env(monkeypatch)
    monkeypatch.setenv("VERSION", "  1.8.0\n")
    monkeypatch.setenv("BUILD", " 502 ")
    monkeypatch.setenv("COMMIT", " abc123\n")
    assert asgi.get_build_info() == {
        "version": "1.8.0",
        "build": 502,
        "commit": "abc123",
    }

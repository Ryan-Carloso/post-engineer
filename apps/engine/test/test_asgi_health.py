"""Tests for the public /health endpoint (deployed version reporting).

/health is unauthenticated on purpose: it lets anyone verify which commit
is live (e.g. after a merge + deploy) without a session or API key.
"""

import os
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import asgi


def _get_health_json() -> dict:
    client = TestClient(asgi.app)
    response = client.get("/health")
    assert response.status_code == 200
    return response.json()


def test_health_reports_baked_version():
    with patch.dict(os.environ, {"APP_VERSION": "abc123"}):
        assert _get_health_json() == {"status": "ok", "version": "abc123"}


def test_health_defaults_to_dev_without_version():
    with patch.dict(os.environ, {"APP_VERSION": ""}):
        assert _get_health_json()["version"] == "dev"


def test_get_deployed_version_prefers_env():
    with patch.dict(os.environ, {"APP_VERSION": "deadbee"}):
        assert asgi.get_deployed_version() == "deadbee"


def test_get_deployed_version_defaults_to_dev():
    with patch.dict(os.environ, {"APP_VERSION": ""}):
        assert asgi.get_deployed_version() == "dev"

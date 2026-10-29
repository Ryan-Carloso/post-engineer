"""Make the engine package importable in normal and mutmut test runs."""

from pathlib import Path
import sys
from unittest.mock import MagicMock

import pytest

from app.config import config
from app.services import analytics, web_search_facts


TEST_ROOT = Path(__file__).resolve().parent.parent
if str(TEST_ROOT) not in sys.path:
    sys.path.insert(0, str(TEST_ROOT))


@pytest.fixture(autouse=True)
def _no_real_web_search(monkeypatch: pytest.MonkeyPatch):
    """Never let a test call a paid search API.

    A dev machine has TAVILY_API_KEY / EXA_API_KEY in .env and may have
    [search] enabled = true in config.toml, so every test that reaches
    place photos would make a real search call. The lookup is off for
    every test; place-photos tests opt in by patching the section itself.
    """
    monkeypatch.setattr(web_search_facts, "_search_section", {"enabled": False})


@pytest.fixture(autouse=True)
def _no_real_visual_verifier(monkeypatch: pytest.MonkeyPatch):
    """Never let a test load the SigLIP model or score real preview images.

    A dev machine and production set material_verification_enabled = true,
    which would route every material test through the verifier. It is off
    for every test; verification tests pass their own config and scorer.
    """
    monkeypatch.setitem(config.app, "material_verification_enabled", False)


@pytest.fixture(autouse=True)
def _no_real_posthog_client(monkeypatch: pytest.MonkeyPatch):
    """Never let a test construct a real PostHog client.

    Telemetry must never escape the test suite: even with POSTHOG_API_KEY
    set (common on dev machines), every test sees a mock PostHog class, so
    track_event/track_ai_request capture into a MagicMock instead of the
    network. Patching posthog.Posthog — rather than track_event itself —
    keeps the analytics unit tests meaningful: they still exercise
    scrubbing, distinct_id selection and the never-raise contract against
    the mock's capture call args. Test-level patches of posthog.Posthog
    keep working: they stack on top of this fixture for the test's
    duration.
    """
    analytics.reset_for_testing()
    monkeypatch.setattr("posthog.Posthog", MagicMock(name="Posthog"))
    yield
    analytics.reset_for_testing()



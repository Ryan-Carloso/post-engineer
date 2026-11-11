"""Make the engine package importable in normal and mutmut test runs."""

from pathlib import Path
import sys
from unittest.mock import MagicMock

import pytest

from app.services import analytics


TEST_ROOT = Path(__file__).resolve().parent.parent
if str(TEST_ROOT) not in sys.path:
    sys.path.insert(0, str(TEST_ROOT))


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

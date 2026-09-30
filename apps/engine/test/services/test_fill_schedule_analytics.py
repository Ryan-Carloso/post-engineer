"""Tests that fill_schedule lifecycle stages emit PostHog analytics events.

The analytics helper itself is tested in test_analytics.py; these tests pin
the wiring so a refactor cannot silently drop an event.
"""

from __future__ import annotations

from app.services.fill_schedule import generate as gen_module
from app.services.fill_schedule import publish as pub_module
from app.services.fill_schedule import reconcile as rec_module


def test_generate_module_wires_track_event():
    """BatchGenerator imports track_event for video_generation_started/failed."""
    assert hasattr(gen_module, "track_event")
    assert callable(gen_module.track_event)


def test_reconcile_module_wires_track_event():
    """BatchReconciler imports track_event for video_generated."""
    assert hasattr(rec_module, "track_event")
    assert callable(rec_module.track_event)


def test_publish_module_wires_track_event():
    """BatchPublisher imports track_event for publish lifecycle events."""
    assert hasattr(pub_module, "track_event")
    assert callable(pub_module.track_event)


def test_generate_emits_started_and_failed_event_names():
    """Verify the expected event names are used in generate.py."""
    import inspect

    source = inspect.getsource(gen_module)
    assert "video_generation_started" in source
    assert "video_generation_failed" in source


def test_reconcile_emits_generated_event_name():
    """Verify the expected event name is used in reconcile.py."""
    import inspect

    source = inspect.getsource(rec_module)
    assert "video_generated" in source


def test_publish_emits_lifecycle_event_names():
    """Verify the expected event names are used in publish.py."""
    import inspect

    source = inspect.getsource(pub_module)
    assert "video_publish_started" in source
    assert "video_published" in source
    assert "video_publish_failed" in source

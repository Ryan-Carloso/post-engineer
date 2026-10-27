"""[search] place_photos: opt-in switch, read through web_search_facts."""

import os
from unittest.mock import patch

from loguru import logger

from app.services import web_search_facts as w

ON = {"enabled": True, "place_photos": True}


def test_the_switch_needs_search_on_the_literal_true_and_a_tavily_key():
    with patch.dict(os.environ, {"TAVILY_API_KEY": "k"}):
        with patch.object(w, "_search_section", ON):
            assert w.place_photos_enabled() is True
        with patch.object(w, "_search_section", {"enabled": True}):
            assert w.place_photos_enabled() is False
        with patch.object(w, "_search_section", {"place_photos": True}):
            assert w.place_photos_enabled() is False
        with patch.object(w, "_search_section", {"enabled": True, "place_photos": "yes"}):
            assert w.place_photos_enabled() is False
    with patch.dict(os.environ, {"TAVILY_API_KEY": ""}), patch.object(w, "_search_section", ON):
        assert w.place_photos_enabled() is False


def test_tests_run_with_photos_off_by_default():
    assert w.place_photos_enabled() is False


def test_boot_warns_but_does_not_fail_when_photos_lack_a_tavily_key():
    messages = []
    sink = logger.add(messages.append, level="WARNING")
    section = {"enabled": True, "place_photos": True, "providers": ["exa"]}
    try:
        with patch.dict(os.environ, {"EXA_API_KEY": "k", "TAVILY_API_KEY": ""}), patch.object(
            w, "_search_section", section
        ):
            w.validate_config()
    finally:
        logger.remove(sink)
    assert "place_photos needs TAVILY_API_KEY" in "".join(messages)

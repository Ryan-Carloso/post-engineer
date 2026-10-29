"""config.example.toml ships the search lookup switched off.

enabled = true makes the engine refuse to boot when no search API key is in
the environment (web_search_facts.validate_config), and a fresh install
copies this file as its config: with the switch on, a self-hoster with no
Tavily/Exa key could not start the engine at all. The feature is opt-in, so
the shipped default is off; an operator turns it on together with the key.
The section now documents only the place-photos client (Phase 5 PR 5
deleted the pre-script fact lookup and its max_facts limit).
"""

import tomllib
from pathlib import Path

example_config = Path(__file__).parent.parent.parent / "config.example.toml"


def _search_section() -> dict:
    with example_config.open("rb") as handle:
        return tomllib.load(handle)["search"]


def test_search_is_off_in_the_shipped_example():
    assert _search_section()["enabled"] is False


def test_example_still_documents_the_providers_and_limits():
    section = _search_section()
    assert section["providers"] == ["tavily", "exa"]
    assert section["timeout_seconds"] == 8.0
    assert "max_facts" not in section


def test_example_comment_says_the_switch_is_opt_in():
    text = example_config.read_text(encoding="utf-8")
    block = text[text.index("[search]"):]
    assert "Off by default" in block.splitlines()[1] + "\n" + block.splitlines()[2]


def test_place_photos_is_off_in_the_shipped_example():
    # One extra image search per named place and third-party photos in the
    # video: an operator opts in, never a default.
    assert _search_section()["place_photos"] is False


def test_place_photos_comment_covers_every_video_type():
    text = example_config.read_text(encoding="utf-8")
    block = text[text.index("# Photos of named places"):text.index("place_photos = false")]
    assert "drawings, stock footage and persona videos" in block
    assert "svg mode" not in block

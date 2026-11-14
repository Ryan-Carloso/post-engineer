"""The overlay text limits live in the engine validator and the shared TS validator.

Both reject what the other rejects, so a limit changed on one side only would
make check_script (action: validate) accept a card the engine refuses (or the reverse). The
shared TS file is the source the web and MCP copies are generated from.
"""

import re
from pathlib import Path

from app.services import script_segments


def _shared_ts() -> Path:
    # Walk up instead of counting parents: mutmut runs the suite from a
    # copied tree (mutants/), which shifts every fixed parent index.
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "shared" / "script-segments" / "script-segments.ts"
        if candidate.is_file():
            return candidate
    raise AssertionError("shared script-segments.ts not found from the test file location")


def _ts_constant(name: str) -> int:
    text = _shared_ts().read_text(encoding="utf-8")
    line = next(
        (line for line in text.splitlines() if line.startswith(f"export const {name} = ")),
        None,
    )
    assert line is not None, f"{name} is not exported by the shared segments validator"
    match = re.search(r"=\s*(\d+);", line)
    assert match is not None, f"{name} is not a plain integer in the shared validator"
    return int(match.group(1))


def test_title_limit_matches_the_shared_validator():
    assert _ts_constant("MAX_OVERLAY_TITLE_CHARS") == script_segments.MAX_OVERLAY_TITLE_CHARS


def test_subtitle_limit_matches_the_shared_validator():
    assert _ts_constant("MAX_OVERLAY_SUBTITLE_CHARS") == script_segments.MAX_OVERLAY_SUBTITLE_CHARS


def test_badge_limit_matches_the_shared_validator():
    assert _ts_constant("MAX_OVERLAY_BADGE_CHARS") == script_segments.MAX_OVERLAY_BADGE_CHARS


def test_a_realistic_card_at_every_limit_fits_the_card():
    # The longest text each field allows must still lay out: a limit the
    # renderer refuses would turn a validated script into a dropped card.
    from PIL import ImageFont

    from app.services import media_overlay

    realistic = {
        "title": ("Restaurante Casa de Pasto " * 3)[: script_segments.MAX_OVERLAY_TITLE_CHARS].strip(),
        "subtitle": ("Rua das Carmelitas 144, 4050-161 Porto " * 3)[: script_segments.MAX_OVERLAY_SUBTITLE_CHARS].strip(),
        "badge": ("about 35 EUR per person " * 2)[: script_segments.MAX_OVERLAY_BADGE_CHARS].strip(),
    }
    assert len(realistic["title"]) > script_segments.MAX_OVERLAY_TITLE_CHARS - 10
    assert media_overlay.measure_card(realistic, lambda size: ImageFont.load_default(size), 1.0, (0, 0, 1000, 730)) is not None

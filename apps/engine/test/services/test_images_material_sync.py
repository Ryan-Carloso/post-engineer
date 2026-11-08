"""The images material lives in the engine validator and the shared TS validator.

The web and the MCP validate segments with the shared TS file (generated
copies) before charging, and the engine validates again on the request. The
material name, the media cap and the cap of the other materials must agree,
or one side accepts an images video the other rejects.
"""

import re
from pathlib import Path

from app.services import faceless_material, script_segments


def _shared_text() -> str:
    # Walk up instead of counting parents: mutmut runs the suite from a copied tree.
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "shared" / "script-segments" / "script-segments.ts"
        if candidate.is_file():
            return candidate.read_text(encoding="utf-8")
    raise AssertionError("shared script-segments.ts not found from the test file location")


def _export_line(name: str) -> str:
    line = next((line for line in _shared_text().splitlines() if line.startswith(f"export const {name} = ")), None)
    assert line is not None, f"{name} is not exported by the shared segments validator"
    return line


def test_material_name_matches_the_shared_validator():
    match = re.search(r"=\s*'([a-z]+)';", _export_line("IMAGES_MATERIAL"))
    assert match is not None and match.group(1) == faceless_material.IMAGES


def test_images_media_cap_is_one_per_segment_on_both_sides():
    assert _export_line("MAX_IMAGES_MODE_MEDIAS").endswith("= MAX_SEGMENTS;")
    assert script_segments.MAX_IMAGES_MODE_MEDIAS == script_segments.MAX_SEGMENTS
    segments_line = _export_line("MAX_SEGMENTS")
    assert segments_line == f"export const MAX_SEGMENTS = {script_segments.MAX_SEGMENTS};"


def test_other_materials_media_cap_matches_the_shared_validator():
    assert _export_line("MAX_MEDIAS") == f"export const MAX_MEDIAS = {script_segments.MAX_MEDIAS};"

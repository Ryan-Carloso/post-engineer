"""The requested photo-duration bounds live in one place per side.

The engine validator, the Pydantic request shape and the shared TS
validator must reject the same values: a bound changed on one side
only would make check_script (action: validate) accept a duration the engine
refuses (or the reverse), after the caller was already charged. The
shared TS file is the source the web and MCP copies are generated
from, and the MCP zod shape reads the same constants from its copy.
"""

import re
from pathlib import Path

from app.models.segments import SegmentMedia
from app.services import segment_photo_duration


def _repo_file(*parts: str) -> Path:
    for parent in Path(__file__).resolve().parents:
        candidate = parent.joinpath(*parts)
        if candidate.is_file():
            return candidate
    raise AssertionError(f"{'/'.join(parts)} not found from the test file location")


def _ts_constant(name: str) -> float:
    text = _repo_file("shared", "script-segments", "script-segments.ts").read_text(
        encoding="utf-8"
    )
    line = next(
        (line for line in text.splitlines() if line.startswith(f"export const {name} = ")),
        None,
    )
    assert line is not None, f"{name} is not exported by the shared segments validator"
    match = re.search(r"=\s*(\d+(?:\.\d+)?);", line)
    assert match is not None, f"{name} is not a plain number in the shared validator"
    return float(match.group(1))


def test_minimum_matches_the_shared_validator():
    assert (
        _ts_constant("MIN_REQUESTED_PHOTO_SECONDS")
        == segment_photo_duration.MIN_REQUESTED_PHOTO_SECONDS
    )


def test_maximum_matches_the_shared_validator():
    assert (
        _ts_constant("MAX_REQUESTED_PHOTO_SECONDS")
        == segment_photo_duration.MAX_REQUESTED_PHOTO_SECONDS
    )


def test_the_shared_validator_accepts_duration_as_a_media_key():
    text = _repo_file("shared", "script-segments", "script-segments.ts").read_text(
        encoding="utf-8"
    )
    assert "key !== 'duration'" in text


def test_the_mcp_tool_shape_reads_the_same_bounds():
    text = _repo_file("apps", "mcp", "src", "single-video-shape.ts").read_text(encoding="utf-8")
    assert "MIN_REQUESTED_PHOTO_SECONDS" in text
    assert "MAX_REQUESTED_PHOTO_SECONDS" in text
    assert "duration: z.number()" in text


def test_the_shared_contract_shape_accepts_duration():
    text = _repo_file("shared", "contracts", "videos.ts").read_text(encoding="utf-8")
    assert "duration: z" in text
    assert ".min(MIN_REQUESTED_PHOTO_SECONDS)" in text
    assert ".max(MAX_REQUESTED_PHOTO_SECONDS)" in text


def test_the_pydantic_shape_pins_the_same_bounds():
    fields = SegmentMedia.model_fields
    ge = [m.ge for m in fields["duration"].metadata if hasattr(m, "ge")]
    le = [m.le for m in fields["duration"].metadata if hasattr(m, "le")]
    assert ge == [segment_photo_duration.MIN_REQUESTED_PHOTO_SECONDS]
    assert le == [segment_photo_duration.MAX_REQUESTED_PHOTO_SECONDS]

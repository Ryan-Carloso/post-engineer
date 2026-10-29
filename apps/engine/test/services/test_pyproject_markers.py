"""Registered pytest markers must not reference deleted modules.

Phase 5 PR 6 deleted the LLM core, but the real_script_angle marker
kept pointing at llm.generate_script_angle with zero uses in the suite.
A marker naming deleted code sends a future reader hunting for a module
that no longer exists, so the registration itself is the bug.
"""

import sys
import tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

DELETED_MODULES = (
    "llm",
    "llm_providers",
    "script_prompts",
    "script_language_rules",
)


def _pyproject_path() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "pyproject.toml"
        if candidate.exists():
            return candidate
    raise FileNotFoundError("pyproject.toml not found above test file")


def test_no_registered_marker_references_a_deleted_module():
    with _pyproject_path().open("rb") as fh:
        data = tomllib.load(fh)
    markers = (
        data.get("tool", {})
        .get("pytest", {})
        .get("ini_options", {})
        .get("markers", [])
    )
    offenders = [m for m in markers if any(d in m for d in DELETED_MODULES)]
    assert offenders == []

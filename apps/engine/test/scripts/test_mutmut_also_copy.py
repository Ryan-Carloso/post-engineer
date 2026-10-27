"""Every repo script imported by a test must reach mutmut's mutants/ copy.

mutmut copies only app/ + test/ (+ also_copy) into mutants/, so a test
that imports scripts.<name> fails collection there and fails EVERY engine
mutation shard with "failed to collect stats" — even though the same test
passes in normal CI. This pins the also_copy entries for such imports.
"""

import re
import tomllib
from pathlib import Path

TEST_SCRIPTS = Path(__file__).resolve().parent
ENGINE_ROOT = TEST_SCRIPTS.parent.parent

_IMPORT_RE = re.compile(r"^from scripts\.(\w+) import|^import scripts\.(\w+)", re.MULTILINE)


def _scripts_imports() -> set[str]:
    imported = set()
    for path in TEST_SCRIPTS.glob("test_*.py"):
        for match in _IMPORT_RE.finditer(path.read_text(encoding="utf-8")):
            imported.add(match.group(1) or match.group(2))
    return imported


def test_scripts_imported_by_tests_are_in_mutmut_also_copy():
    with open(ENGINE_ROOT / "pyproject.toml", "rb") as handle:
        config = tomllib.load(handle)
    also_copy = config["tool"]["mutmut"]["also_copy"]
    missing = sorted(
        f"scripts/{name}.py" for name in _scripts_imports() if f"scripts/{name}.py" not in also_copy
    )
    assert not missing, f"scripts imported by tests but missing from mutmut also_copy: {missing}"

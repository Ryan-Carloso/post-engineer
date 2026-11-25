"""Every repo script or top-level module a test reaches must be in mutmut's mutants/ copy.

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


_TOP_LEVEL_IMPORT_RE = re.compile(r"^\s*(?:from|import) (\w+)", re.MULTILINE)


def _top_level_modules_reached_by_tests() -> set[str]:
    top_level = {path.stem for path in ENGINE_ROOT.glob("*.py")}
    reached: set[str] = set()
    pending = [path for path in (ENGINE_ROOT / "test").rglob("*.py")]
    while pending:
        source = pending.pop().read_text(encoding="utf-8")
        for name in _TOP_LEVEL_IMPORT_RE.findall(source):
            if name in top_level and name not in reached:
                reached.add(name)
                pending.append(ENGINE_ROOT / f"{name}.py")
    return reached


def test_top_level_modules_imported_by_tests_or_their_imports_are_in_also_copy():
    with open(ENGINE_ROOT / "pyproject.toml", "rb") as handle:
        config = tomllib.load(handle)
    also_copy = config["tool"]["mutmut"]["also_copy"]
    missing = sorted(
        f"{name}.py" for name in _top_level_modules_reached_by_tests() if f"{name}.py" not in also_copy
    )
    assert not missing, f"top-level modules reached by tests but missing from mutmut also_copy: {missing}"

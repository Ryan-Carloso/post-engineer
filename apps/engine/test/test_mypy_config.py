"""Pin the mypy config invariants that make import-not-found fatal.

The whole point of mypy in CI is to catch removed dependencies (like the
sentry_sdk removal that broke PR #33). These invariants must hold:
1. No global ignore_missing_imports in [tool.mypy] (would silence
   import-not-found for first-party modules too).
2. import-not-found (and import-untyped) never in disable_error_code.
3. app* never in the override module list (would silence first-party).
"""

import re
import tomllib
import unittest
from pathlib import Path

# Canonical mypy override pattern: a literal module path, optionally with
# a trailing ".*" or "*" (fnmatch). Anything else (e.g. bare "*", "a?",
# "[ab]c") is rejected — it could silently match first-party modules.
_CANONICAL_PATTERN = re.compile(r"[A-Za-z_][\w.]*\*?")


def _load_mypy_config() -> dict:
    pyproject = Path(__file__).parent.parent / "pyproject.toml"
    with pyproject.open("rb") as f:
        return tomllib.load(f)["tool"]["mypy"]


def _load_ci_mypy_targets() -> tuple:
    """Extract the mypy target list from the CI workflow.

    The first-party set must match what CI actually type-checks, so the
    test reads .github/workflows/ci.yml instead of hardcoding it.
    """
    ci_yml = (
        Path(__file__).parent.parent.parent.parent
        / ".github"
        / "workflows"
        / "ci.yml"
    )
    for line in ci_yml.read_text().splitlines():
        stripped = line.strip()
        if stripped.startswith("run: uv run mypy "):
            args = stripped[len("run: uv run mypy "):].split()
            # Map file targets to module names: "cli.py" -> "cli".
            return tuple(a[:-3] if a.endswith(".py") else a for a in args)
    raise AssertionError("Could not find 'uv run mypy' step in ci.yml")


class MypyConfigPinTests(unittest.TestCase):
    def test_no_global_ignore_missing_imports(self):
        config = _load_mypy_config()
        self.assertNotIn(
            "ignore_missing_imports",
            config,
            "Global ignore_missing_imports would silence import-not-found "
            "for first-party modules, defeating the CI gate.",
        )

    def test_import_not_found_not_disabled(self):
        config = _load_mypy_config()
        disabled = config.get("disable_error_code", [])
        self.assertNotIn("import-not-found", disabled)
        self.assertNotIn("import-untyped", disabled)

    def test_no_app_override(self):
        # Parse the TOML structure (not regex) so string-form modules and
        # quoting variants are all covered. The first-party set is derived
        # from the CI workflow so it can't drift from what CI type-checks.
        config = _load_mypy_config()
        overrides = config.get("overrides", [])
        # The overrides section must exist and be non-empty — a deleted
        # section would pass vacuously while CI goes red on stub-less deps.
        self.assertTrue(
            overrides,
            "mypy overrides section must exist with stub-less third-party modules.",
        )
        first_party = _load_ci_mypy_targets()
        self.assertTrue(
            first_party, "CI mypy step must declare at least one target."
        )
        for override in overrides:
            modules = override.get("module", [])
            # Normalize: module can be a string or a list of strings.
            if isinstance(modules, str):
                modules = [modules]
            for mod in modules:
                # Reject non-canonical fnmatch patterns — a bare "*" would
                # silence every module including first-party.
                self.assertIsNotNone(
                    _CANONICAL_PATTERN.fullmatch(mod),
                    f"Override module pattern is not a literal or literal.* form: {mod}",
                )
                base = mod.rstrip("*").rstrip(".")
                for pkg in first_party:
                    self.assertFalse(
                        base == pkg or base.startswith(pkg + "."),
                        f"Override must not silence first-party modules: {mod}",
                    )

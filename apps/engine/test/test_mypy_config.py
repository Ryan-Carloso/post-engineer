"""Pin the mypy config invariants that make import-not-found fatal.

The whole point of mypy in CI is to catch removed dependencies (like the
sentry_sdk removal that broke PR #33). These invariants must hold:
1. No global ignore_missing_imports in [tool.mypy] (would silence
   import-not-found for first-party modules too).
2. import-not-found (and import-untyped) never in disable_error_code.
3. app* never in the override module list (would silence first-party).
"""

import tomllib
import unittest
from pathlib import Path


def _load_mypy_config() -> dict:
    pyproject = Path(__file__).parent.parent / "pyproject.toml"
    with pyproject.open("rb") as f:
        return tomllib.load(f)["tool"]["mypy"]


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
        # The overrides are a list of tables; check via raw TOML structure
        pyproject = Path(__file__).parent.parent / "pyproject.toml"
        text = pyproject.read_text()
        # Simple check: no override module pattern starts with app
        import re

        for m in re.finditer(r'module\s*=\s*\[(.*?)\]', text, re.DOTALL):
            modules = m.group(1)
            self.assertNotRegex(
                modules,
                r'"app',
                "Override must not silence first-party app.* modules.",
            )

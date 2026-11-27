"""The engine's provider mirror (app/providers.py) against the shared list."""

from __future__ import annotations

import re
import tempfile
import unittest
from pathlib import Path

from app.providers import (
    COMMENT_PROVIDERS,
    PROVIDER_LABELS,
    SCHEDULE_ACCOUNT_COLUMNS,
    SOCIAL_PROVIDERS,
)


def _repo_root(start: Path | None = None) -> Path:
    here = (start if start is not None else Path(__file__)).resolve()
    for parent in (*([here] if here.is_dir() else []), *here.parents):
        if (parent / "shared/contracts/providers.ts").is_file():
            return parent
    raise AssertionError("repo root not found from the test file location")


REPO_ROOT = _repo_root()


def _shared_array(name: str) -> list[str]:
    text = (REPO_ROOT / "shared" / "contracts" / "providers.ts").read_text(encoding="utf-8")
    match = re.search(r"export const " + name + r" = \[(.*?)\]", text, re.S)
    assert match is not None, f"{name} not found in shared/contracts/providers.ts"
    return re.findall(r"'([^']+)'", match.group(1))


def _shared_map(name: str) -> dict[str, str]:
    text = (REPO_ROOT / "shared" / "contracts" / "providers.ts").read_text(encoding="utf-8")
    match = re.search(r"export const " + name + r"[^=]*= \{(.*?)\}", text, re.S)
    assert match is not None, f"{name} not found in shared/contracts/providers.ts"
    return {key: value for key, value in re.findall(r"'?([a-z0-9]+)'?: '([^']+)'", match.group(1))}


class ProvidersMirrorTest(unittest.TestCase):
    def test_social_providers_equal_the_shared_list_in_order(self) -> None:
        self.assertEqual(list(SOCIAL_PROVIDERS), _shared_array("SOCIAL_PROVIDERS"))

    def test_schedule_account_columns_equal_the_shared_map(self) -> None:
        self.assertEqual(SCHEDULE_ACCOUNT_COLUMNS, _shared_map("SCHEDULE_ACCOUNT_COLUMNS"))

    def test_every_provider_has_a_label(self) -> None:
        self.assertEqual(list(PROVIDER_LABELS), list(SOCIAL_PROVIDERS))
        self.assertTrue(all(label.strip() for label in PROVIDER_LABELS.values()))

    def test_comment_providers_equal_the_shared_subset(self) -> None:
        self.assertEqual(COMMENT_PROVIDERS, frozenset(_shared_array("COMMENT_PROVIDERS")))
        self.assertTrue(COMMENT_PROVIDERS <= set(SOCIAL_PROVIDERS))

    def test_repo_root_walks_up_past_mutants_tree(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "shared" / "contracts").mkdir(parents=True)
            (root / "shared" / "contracts" / "providers.ts").write_text("// fake")
            fake_test = (
                root / "apps" / "engine" / "mutants" / "test" / "services" / "test_providers.py"
            )
            fake_test.parent.mkdir(parents=True)
            self.assertEqual(_repo_root(fake_test), root)


if __name__ == "__main__":
    unittest.main()

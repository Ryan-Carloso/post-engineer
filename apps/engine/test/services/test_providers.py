"""The engine's provider mirror (app/providers.py) against the shared list."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from app.providers import (
    PROVIDER_LABELS,
    SCHEDULE_ACCOUNT_COLUMNS,
    SOCIAL_PROVIDERS,
    URL_MEDIA_PROVIDERS,
)

REPO_ROOT = Path(__file__).resolve().parents[4]


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

    def test_url_media_providers_are_known_providers(self) -> None:
        self.assertEqual(URL_MEDIA_PROVIDERS, frozenset({"instagram", "threads", "facebook"}))
        self.assertTrue(URL_MEDIA_PROVIDERS <= set(SOCIAL_PROVIDERS))


if __name__ == "__main__":
    unittest.main()

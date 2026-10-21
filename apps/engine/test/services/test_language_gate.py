"""Unit tests for the English-only launch language gate."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.language_gate import is_english_language


class IsEnglishLanguageTests(unittest.TestCase):
    def test_accepts_english_and_regional_variants(self):
        for language in ("en", "en-US", "en-GB", "EN", "En-Gb", "en_us", " en "):
            with self.subTest(language=language):
                self.assertTrue(is_english_language(language))

    def test_rejects_other_languages(self):
        for language in ("pt", "pt-BR", "es", "fr", "de", "enx"):
            with self.subTest(language=language):
                self.assertFalse(is_english_language(language))

    def test_rejects_missing_language(self):
        self.assertFalse(is_english_language(None))
        self.assertFalse(is_english_language(""))
        self.assertFalse(is_english_language("   "))


if __name__ == "__main__":
    unittest.main()

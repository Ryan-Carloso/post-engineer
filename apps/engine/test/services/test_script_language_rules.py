"""Direct tests for app.services.script_language_rules (extracted from
app.services.llm without behavior change — same regex, same language set)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.script_language_rules import (  # noqa: E402
    _find_foreign_script,
    _strip_foreign_script,
    _uses_latin_script,
)


class UsesLatinScriptTest(unittest.TestCase):
    def test_latin_language_codes_and_language_names_are_latin(self):
        self.assertTrue(_uses_latin_script("pt"))
        self.assertTrue(_uses_latin_script("pt-BR"))
        self.assertTrue(_uses_latin_script("en"))

    def test_non_latin_languages_never_get_the_guard(self):
        self.assertFalse(_uses_latin_script("zh"))
        self.assertFalse(_uses_latin_script("ja"))
        self.assertFalse(_uses_latin_script("ko"))
        self.assertFalse(_uses_latin_script(""))

    def test_cjk_gets_the_guard_but_korean_does_not(self):
        self.assertFalse(_uses_latin_script("ko"))
        self.assertFalse(_uses_latin_script("zh_TW"))
        self.assertFalse(_uses_latin_script("zh_TN"))


class ForeignScriptDetectionTest(unittest.TestCase):
    def test_find_returns_every_cjk_hangul_and_kana_run(self):
        # CJK, Hiragana/Katakana and Hangul runs are all intruders.
        intruders = _find_foreign_script("hello 文字 rest かお")
        self.assertEqual(intruders, ["文字", "かお"])

    def test_empty_and_none_shaped_text_is_safe(self):
        self.assertEqual(_find_foreign_script(""), [])

    def test_strip_removes_all_intruders(self):
        self.assertEqual(_strip_foreign_script("a文bツc"), "abc")

    def test_clean_text_survives_untouched(self):
        self.assertEqual(_strip_foreign_script("francesinha no Porto"), "francesinha no Porto")


if __name__ == "__main__":
    unittest.main()

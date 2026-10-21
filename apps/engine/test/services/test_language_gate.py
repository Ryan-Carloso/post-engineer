"""Unit tests for the English-only launch language gate."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from types import SimpleNamespace

from app.models.exception import HttpException
from app.services.language_gate import ensure_english_video_language, is_english_language


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


class EnsureEnglishVideoLanguageTests(unittest.TestCase):
    def test_rejects_a_non_english_video_language(self):
        body = SimpleNamespace(video_language="pt-BR")
        with self.assertRaises(HttpException) as caught:
            ensure_english_video_language(body, "req-9", "task-9")
        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(
            caught.exception.message, "req-9: Only English videos are supported for now"
        )
        self.assertEqual(caught.exception.task_id, "task-9")

    def test_accepts_english_video_languages(self):
        for language in ("en", "en-US", "EN-GB"):
            with self.subTest(language=language):
                body = SimpleNamespace(video_language=language)
                ensure_english_video_language(body, "req-9", "task-9")

    def test_unset_video_language_keeps_auto_detect(self):
        for language in ("", "   ", None):
            with self.subTest(language=language):
                body = SimpleNamespace(video_language=language)
                ensure_english_video_language(body, "req-9", "task-9")
        ensure_english_video_language(SimpleNamespace(), "req-9", "task-9")
        ensure_english_video_language(object(), "req-9", "task-9")


if __name__ == "__main__":
    unittest.main()

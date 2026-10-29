"""Direct unit tests for the extracted preview-text validator.

The engine's mutmut shard requires a test file written against this
module (endpoint/TestClient tests attribute elsewhere), so every branch
of validate_preview_text is pinned here.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.cloned_voices.preview_text import (
    CLONE_PREVIEW_TEXT_MAX_CHARS,
    validate_preview_text,
)

# The stable client-facing message: pinned verbatim so a rewording is a
# deliberate, visible change.
EXPECTED_MESSAGE = "preview text must be 1 to 300 characters after trimming"


class ValidatePreviewTextTests(unittest.TestCase):
    def test_none_means_no_caller_text(self):
        self.assertIsNone(validate_preview_text(None))

    def test_returns_the_trimmed_text(self):
        self.assertEqual(validate_preview_text("  hello world  "), "hello world")

    def test_accepts_exactly_max_chars(self):
        text = "a" * 300
        self.assertEqual(validate_preview_text(text), text)

    def test_rejects_text_empty_after_trim(self):
        with self.assertRaises(ValueError) as ctx:
            validate_preview_text("   ")
        self.assertEqual(str(ctx.exception), EXPECTED_MESSAGE)

    def test_rejects_over_length_text_without_truncating(self):
        over = "a" * (CLONE_PREVIEW_TEXT_MAX_CHARS + 1)
        with self.assertRaises(ValueError) as ctx:
            validate_preview_text(over)
        self.assertEqual(str(ctx.exception), EXPECTED_MESSAGE)

    def test_over_length_check_uses_the_trimmed_length(self):
        # 300 chars plus surrounding spaces: over the cap before trimming,
        # valid after — the bound applies to what is actually spoken.
        text = "   " + ("b" * 300) + "   "
        self.assertEqual(validate_preview_text(text), "b" * 300)


if __name__ == "__main__":
    unittest.main()

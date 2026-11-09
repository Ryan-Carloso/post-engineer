"""Direct unit tests for the extracted Bluesky caption helpers.

Moved from ``test_bluesky_publish`` when the helpers moved out of
``upload_publisher`` into ``app.services.bluesky_caption``: the
mutation shard attributes tests to the file they were written against,
so a helper in its own module needs its own test file.
"""

import unittest

from app.services.bluesky_caption import truncate_bluesky_caption


class BlueskyCaptionHelperTest(unittest.TestCase):
    """Grapheme-safe caption truncation helper."""

    def test_truncate_short_caption_unchanged(self) -> None:
        self.assertEqual(truncate_bluesky_caption("curta"), "curta")

    def test_truncate_exactly_300_unchanged(self) -> None:
        caption = "a" * 300
        self.assertEqual(truncate_bluesky_caption(caption), caption)

    def test_truncate_long_caption_with_ellipsis(self) -> None:
        result = truncate_bluesky_caption("a" * 320)
        self.assertEqual(len(result), 300)
        self.assertTrue(result.endswith("…"))

    def test_truncate_never_breaks_emoji(self) -> None:
        zwj = chr(0x200D)
        family = zwj.join(chr(cp) for cp in (0x1F468, 0x1F469, 0x1F467, 0x1F466))
        caption = "a" * 298 + family * 3
        result = truncate_bluesky_caption(caption)
        self.assertLessEqual(len(result), 300)


if __name__ == "__main__":
    unittest.main()

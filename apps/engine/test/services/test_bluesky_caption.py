"""Direct unit tests for the extracted Bluesky caption helpers.

Moved from ``test_bluesky_publish`` when the helpers moved out of
``upload_publisher`` into ``app.services.bluesky_caption``: the
mutation shard attributes tests to the file they were written against,
so a helper in its own module needs its own test file.
"""

import unittest

from app.services.bluesky_caption import count_graphemes, truncate_bluesky_caption


def _family_emoji() -> str:
    zwj = chr(0x200D)
    return zwj.join(chr(cp) for cp in (0x1F468, 0x1F469, 0x1F467, 0x1F466))


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
        family = _family_emoji()
        caption = "a" * 298 + family * 3
        result = truncate_bluesky_caption(caption)
        # The first family fits the 299-grapheme budget whole; the other two
        # are dropped, never cut in half.
        self.assertEqual(result, "a" * 298 + family + "…")
        self.assertEqual(count_graphemes(result), 300)

    def test_truncate_drops_whole_emoji_when_it_does_not_fit(self) -> None:
        family = _family_emoji()
        caption = "a" * 299 + family * 2
        result = truncate_bluesky_caption(caption)
        self.assertEqual(result, "a" * 299 + "…")
        self.assertNotIn(chr(0x1F468), result)


if __name__ == "__main__":
    unittest.main()

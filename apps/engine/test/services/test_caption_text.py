"""Direct unit tests for app.services.caption_text.

The helpers moved out of upload_publisher (file-size ratchet); these tests
pin the new module itself so the mutation shard attributes tests to it.
"""

import unittest

from app.services import caption_text


class CountGraphemesTest(unittest.TestCase):
    def test_counts_plain_text(self) -> None:
        self.assertEqual(caption_text.count_graphemes("curta"), 5)
        self.assertEqual(caption_text.count_graphemes(""), 0)

    def test_counts_a_combining_mark_with_its_base(self) -> None:
        # 'e' + combining acute accent is one user-perceived character.
        self.assertEqual(caption_text.count_graphemes("e\u0301"), 1)

    def test_counts_a_zwj_emoji_sequence_as_one(self) -> None:
        zwj = chr(0x200D)
        family = zwj.join(chr(cp) for cp in (0x1F468, 0x1F469, 0x1F467, 0x1F466))
        self.assertEqual(caption_text.count_graphemes(family), 1)


class TruncateBlueskyCaptionTest(unittest.TestCase):
    def test_short_and_exactly_300_captions_are_unchanged(self) -> None:
        self.assertEqual(caption_text.truncate_bluesky_caption("curta"), "curta")
        self.assertEqual(caption_text.truncate_bluesky_caption("a" * 300), "a" * 300)

    def test_long_caption_is_cut_to_300_with_an_ellipsis(self) -> None:
        result = caption_text.truncate_bluesky_caption("a" * 320)
        self.assertEqual(len(result), 300)
        self.assertTrue(result.endswith("…"))

    def test_truncate_never_breaks_emoji(self) -> None:
        zwj = chr(0x200D)
        family = zwj.join(chr(cp) for cp in (0x1F468, 0x1F469, 0x1F467, 0x1F466))
        caption = "a" * 298 + family * 3
        result = caption_text.truncate_bluesky_caption(caption)
        # The family starts at grapheme 299 and cannot fit whole: the cut
        # lands on the grapheme boundary, so the first person survives
        # intact and no partial ZWJ sequence (nor a dangling joiner) is
        # left in the result.
        self.assertEqual(result, "a" * 298 + chr(0x1F468) + "…")
        self.assertNotIn(zwj, result)


if __name__ == "__main__":
    unittest.main()

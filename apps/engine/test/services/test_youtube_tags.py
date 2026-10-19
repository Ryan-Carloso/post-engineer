"""Tests for language-aware YouTube tag derivation and publish pre-flight.

Tags are extracted from the topic text itself, so they always land in the
video's own language (Portuguese topic -> Portuguese tags, Hindi topic ->
Hindi tags). ``validate_publish_metadata`` rejects empty tags/title/
description so a slot fails BEFORE the video is generated instead of
burning GPU on a publish that YouTube would 400.
"""

import unittest

from app.services import upload_publisher
from app.services.fill_schedule import metadata as fs_metadata
from app.services.fill_schedule.youtube_tags import derive_tags_from_topic


def _youtube_metadata(**overrides):
    fields = {
        "title": "t",
        "description": "d",
        "tags": ("porto", "food"),
        "privacy_status": "public",
        "account_ids": ("acc_1",),
    }
    fields.update(overrides)
    return upload_publisher.YouTubeMetadata(**fields)


class DeriveTagsFromTopicTest(unittest.TestCase):
    def test_portuguese_topic_yields_portuguese_tags(self) -> None:
        tags = derive_tags_from_topic("Onde os locais comem no Porto")
        self.assertIn("porto", tags)
        self.assertIn("locais", tags)
        self.assertIn("comem", tags)
        # short stopwords are dropped, every tag stays Portuguese
        self.assertNotIn("os", tags)
        self.assertNotIn("no", tags)
        for tag in tags:
            self.assertTrue(tag.isalpha())

    def test_english_topic_yields_english_tags(self) -> None:
        self.assertEqual(
            derive_tags_from_topic("Where locals actually eat in Porto"),
            ("where", "locals", "actually", "eat", "porto"),
        )

    def test_hindi_topic_yields_hindi_tags(self) -> None:
        tags = derive_tags_from_topic("पोर्टो में स्थानीय लोग कहाँ खाते हैं")
        self.assertIn("पोर्टो", tags)
        self.assertIn("स्थानीय", tags)
        # no latin-script tag may sneak into a Hindi topic
        for tag in tags:
            self.assertFalse(tag.isascii())

    def test_dedupes_case_insensitively(self) -> None:
        self.assertEqual(derive_tags_from_topic("Porto porto PORTO"), ("porto",))

    def test_drops_digits_only_tokens(self) -> None:
        tags = derive_tags_from_topic("top 10 places to visit in 2026")
        self.assertNotIn("10", tags)
        self.assertNotIn("2026", tags)
        self.assertIn("places", tags)

    def test_strips_punctuation(self) -> None:
        self.assertEqual(derive_tags_from_topic("Porto, food!"), ("porto", "food"))

    def test_caps_number_of_tags(self) -> None:
        tags = derive_tags_from_topic(
            "one two three four five six seven eight nine ten eleven twelve"
        )
        self.assertEqual(len(tags), 8)

    def test_empty_topic_yields_no_tags(self) -> None:
        self.assertEqual(derive_tags_from_topic(""), ())
        self.assertEqual(derive_tags_from_topic("   "), ())
        self.assertEqual(derive_tags_from_topic("!!! ???"), ())

    def test_falls_back_to_cut_title_when_strict_yields_nothing(self) -> None:
        # "AI" is too short for the strict pass, so the fallback cuts the
        # title into raw words instead of failing the slot over tags.
        self.assertEqual(derive_tags_from_topic("AI"), ("ai",))
        self.assertEqual(derive_tags_from_topic("U2"), ("u2",))


class MetadataForTagsTest(unittest.TestCase):
    def test_youtube_tags_come_from_topic(self) -> None:
        metadata = fs_metadata.metadata_for("youtube", "Onde os locais comem no Porto", {})
        self.assertIsInstance(metadata, upload_publisher.YouTubeMetadata)
        self.assertEqual(metadata.tags, derive_tags_from_topic("Onde os locais comem no Porto"))
        self.assertTrue(len(metadata.tags) > 0)

    def test_youtube_tags_keep_topic_language(self) -> None:
        metadata = fs_metadata.metadata_for("youtube", "पोर्टो में स्थानीय लोग कहाँ खाते हैं", {})
        self.assertIn("पोर्टो", metadata.tags)


class ValidatePublishMetadataTagsTest(unittest.TestCase):
    def _assert_rejects(self, expected_message: str, **overrides) -> None:
        with self.assertRaises(ValueError) as caught:
            upload_publisher.validate_publish_metadata(
                providers=["youtube"],
                youtube=_youtube_metadata(**overrides),
                instagram=None,
            )
        self.assertEqual(str(caught.exception), expected_message)

    def test_rejects_empty_tags(self) -> None:
        self._assert_rejects(
            "youtube publish requires at least one tag",
            tags=(),
        )

    def test_rejects_empty_title(self) -> None:
        self._assert_rejects(
            "youtube publish requires a non-empty title",
            title="",
        )

    def test_rejects_whitespace_description(self) -> None:
        self._assert_rejects(
            "youtube publish requires a non-empty description",
            description="   ",
        )

    def test_accepts_valid_youtube_metadata(self) -> None:
        metadata = upload_publisher.validate_publish_metadata(
            providers=["youtube"],
            youtube=_youtube_metadata(),
            instagram=None,
        )
        self.assertEqual(metadata.youtube.tags, ("porto", "food"))


class ValidatePublishPlanTagsTest(unittest.TestCase):
    def test_rejects_topic_without_tags_before_generation(self) -> None:
        schedule = {"providers": ["youtube"], "youtube_account_ids": ["yt-1"]}
        with self.assertRaises(ValueError) as caught:
            fs_metadata.validate_publish_plan(schedule, "!!! ???")
        self.assertIn("tag", str(caught.exception))

    def test_accepts_topic_with_tags(self) -> None:
        schedule = {"providers": ["youtube"], "youtube_account_ids": ["yt-1"]}
        # does not raise: the slot may proceed to generation
        fs_metadata.validate_publish_plan(schedule, "Onde os locais comem no Porto")


if __name__ == "__main__":
    unittest.main()

"""Contract tests for Bluesky publish support.

Follows the same wire-contract style as ``test_upload_publisher_contract``:
they must fail until ``upload_publisher`` implements bluesky metadata,
validation and multipart building.
"""

import unittest

from app.services import upload_publisher


class BlueskyMetadataValidationTest(unittest.TestCase):
    """Validation rules for the bluesky provider."""

    def test_accepts_bluesky_with_valid_caption(self) -> None:
        metadata = upload_publisher.validate_publish_metadata(
            providers=["bluesky"],
            youtube=None,
            instagram=None,
            bluesky=upload_publisher.BlueskyMetadata(
                caption="Olá Bluesky! 🎬",
                account_ids=["did:plc:abc"],
            ),
        )
        self.assertEqual(metadata.providers, ("bluesky",))
        self.assertIsNotNone(metadata.bluesky)

    def test_rejects_bluesky_without_metadata(self) -> None:
        with self.assertRaises(ValueError) as caught:
            upload_publisher.validate_publish_metadata(
                providers=["bluesky"],
                youtube=None,
                instagram=None,
                bluesky=None,
            )
        self.assertEqual(str(caught.exception), "bluesky provider requires bluesky metadata")

    def test_rejects_bluesky_without_accounts(self) -> None:
        with self.assertRaises(ValueError) as caught:
            upload_publisher.validate_publish_metadata(
                providers=["bluesky"],
                youtube=None,
                instagram=None,
                bluesky=upload_publisher.BlueskyMetadata(
                    caption="c",
                    account_ids=[],
                ),
            )
        self.assertEqual(str(caught.exception), "bluesky publish requires at least one account id")

    def test_rejects_bluesky_caption_over_300_graphemes(self) -> None:
        with self.assertRaises(ValueError) as caught:
            upload_publisher.validate_publish_metadata(
                providers=["bluesky"],
                youtube=None,
                instagram=None,
                bluesky=upload_publisher.BlueskyMetadata(
                    caption="a" * 301,
                    account_ids=["did:plc:abc"],
                ),
            )
        self.assertEqual(str(caught.exception), "bluesky caption exceeds 300 graphemes")


class BlueskyPartsTest(unittest.TestCase):
    """Multipart contract for the bluesky internal route."""

    def test_build_bluesky_parts(self) -> None:
        parts = upload_publisher.build_bluesky_parts(
            upload_publisher.BlueskyMetadata(
                caption="meu vídeo",
                account_ids=["did:plc:abc", "did:plc:def"],
            )
        )
        self.assertEqual(
            parts.fields,
            [
                ("provider", "bluesky"),
                ("caption", "meu vídeo"),
                ("did", "did:plc:abc"),
                ("did", "did:plc:def"),
            ],
        )
        self.assertEqual(parts.tags, [])

    def test_bluesky_file_part_uses_video_field(self) -> None:
        import io

        field, fileobj, content_type = upload_publisher.build_video_file_part(
            io.BytesIO(b"x"), "clip.mp4", "video/mp4", "bluesky"
        )
        self.assertEqual(field, "video")
        self.assertEqual(content_type, "video/mp4")


if __name__ == "__main__":
    unittest.main()

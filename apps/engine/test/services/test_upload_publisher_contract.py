"""Contract tests for publishing videos through the internal upload API.

These tests define the wire contract with
``POST https://post-engineer.com/api/upload-content`` before the client
exists. They must fail on import until ``app/services/upload_publisher.py``
implements the documented types and validation rules.
"""

import io
import unittest

from app.services import upload_publisher


class PublishMetadataValidationTest(unittest.TestCase):
    """Provider, account and field validation rules for publish metadata."""

    def assert_validation_error(
        self,
        expected_message: str,
        providers: list[str],
        youtube: upload_publisher.YouTubeMetadata | None,
        instagram: upload_publisher.InstagramMetadata | None,
    ) -> None:
        """Assert the validation fails with exactly the given message."""
        with self.assertRaises(ValueError) as caught:
            upload_publisher.validate_publish_metadata(
                providers=providers,
                youtube=youtube,
                instagram=instagram,
            )
        self.assertEqual(str(caught.exception), expected_message)

    def test_rejects_empty_providers(self) -> None:
        self.assert_validation_error(
            "at least one publish provider is required",
            providers=[],
            youtube=None,
            instagram=None,
        )

    def test_rejects_unknown_provider(self) -> None:
        self.assert_validation_error(
            "unsupported publish provider: tiktok",
            providers=["tiktok"],
            youtube=None,
            instagram=None,
        )

    def test_rejects_provider_without_metadata(self) -> None:
        self.assert_validation_error(
            "youtube provider requires youtube metadata",
            providers=["youtube"],
            youtube=None,
            instagram=None,
        )

    def test_rejects_instagram_provider_without_metadata(self) -> None:
        self.assert_validation_error(
            "instagram provider requires instagram metadata",
            providers=["instagram"],
            youtube=None,
            instagram=None,
        )

    def test_rejects_youtube_without_accounts(self) -> None:
        self.assert_validation_error(
            "youtube publish requires at least one account id",
            providers=["youtube"],
            youtube=upload_publisher.YouTubeMetadata(
                title="t",
                description="d",
                tags=["a"],
                privacy_status="public",
                account_ids=[],
            ),
            instagram=None,
        )

    def test_rejects_youtube_with_invalid_privacy_status(self) -> None:
        self.assert_validation_error(
            "invalid youtube privacy status. Use public|private|unlisted",
            providers=["youtube"],
            youtube=upload_publisher.YouTubeMetadata(
                title="t",
                description="d",
                tags=[],
                privacy_status="sponsored",
                account_ids=["acc_1"],
            ),
            instagram=None,
        )

    def test_rejects_instagram_without_accounts(self) -> None:
        self.assert_validation_error(
            "instagram publish requires at least one account id",
            providers=["instagram"],
            youtube=None,
            instagram=upload_publisher.InstagramMetadata(
                caption="cap",
                account_ids=[],
            ),
        )

    def test_rejects_instagram_caption_over_limit(self) -> None:
        self.assert_validation_error(
            "instagram caption exceeds 2200 characters",
            providers=["instagram"],
            youtube=None,
            instagram=upload_publisher.InstagramMetadata(
                caption="x" * 2201,
                account_ids=["ig_1"],
            ),
        )

    def test_accepts_instagram_caption_at_limit(self) -> None:
        metadata = upload_publisher.validate_publish_metadata(
            providers=["instagram"],
            youtube=None,
            instagram=upload_publisher.InstagramMetadata(
                caption="x" * upload_publisher.INSTAGRAM_CAPTION_MAX_LENGTH,
                account_ids=["ig_1"],
            ),
        )
        self.assertEqual(len(metadata.instagram.caption), 2200)

    def test_accepts_valid_multi_provider_metadata(self) -> None:
        metadata = upload_publisher.validate_publish_metadata(
            providers=["youtube", "instagram"],
            youtube=upload_publisher.YouTubeMetadata(
                title="t",
                description="d",
                tags=["a"],
                privacy_status="public",
                account_ids=["acc_1", "acc_2"],
            ),
            instagram=upload_publisher.InstagramMetadata(
                caption="cap",
                account_ids=["ig_1"],
            ),
        )
        self.assertEqual(metadata.providers, ("youtube", "instagram"))
        self.assertIsNotNone(metadata.youtube)
        self.assertIsNotNone(metadata.instagram)


class PublishPartsContractTest(unittest.TestCase):
    """Multipart field names must match the Next.js route contract exactly."""

    def test_youtube_fields(self) -> None:
        parts = upload_publisher.build_youtube_parts(
            metadata=upload_publisher.YouTubeMetadata(
                title="My title",
                description="My description",
                tags=["one", "two"],
                privacy_status="unlisted",
                account_ids=["acc_1", "acc_2"],
            ),
        )
        fields = {name: value for name, value in parts.fields}
        self.assertEqual(fields.get("provider"), "youtube")
        self.assertEqual(fields.get("title"), "My title")
        self.assertEqual(fields.get("description"), "My description")
        self.assertEqual(fields.get("privacyStatus"), "unlisted")
        # accountIds is a repeated field, never a joined string.
        self.assertEqual(parts.fields.count(("accountIds", "acc_1")), 1)
        self.assertEqual(parts.fields.count(("accountIds", "acc_2")), 1)
        self.assertEqual(len(parts.tags), 1)
        tags_field, tags_value = parts.tags[0]
        self.assertEqual(tags_field, "tags")
        self.assertEqual(tags_value, "one,two")

    def test_instagram_fields(self) -> None:
        parts = upload_publisher.build_instagram_parts(
            metadata=upload_publisher.InstagramMetadata(
                caption="cap",
                account_ids=["ig_1", "ig_2"],
            ),
        )
        fields = {name: value for name, value in parts.fields}
        self.assertEqual(fields.get("provider"), "instagram")
        self.assertEqual(fields.get("caption"), "cap")
        self.assertEqual(parts.fields.count(("igAccountIds", "ig_1")), 1)
        self.assertEqual(parts.fields.count(("igAccountIds", "ig_2")), 1)


class PublishVideoFileContractTest(unittest.TestCase):
    """The video file field name and content type follow the route contract."""

    def test_video_file_part_for_youtube(self) -> None:
        payload = io.BytesIO(b"mp4-bytes")
        part = upload_publisher.build_video_file_part(
            fileobj=payload,
            filename="final.mp4",
            content_type="video/mp4",
            provider="youtube",
        )
        self.assertEqual(part[0], "video")
        self.assertEqual(part[2], "video/mp4")

    def test_video_file_part_for_instagram(self) -> None:
        payload = io.BytesIO(b"mp4-bytes")
        part = upload_publisher.build_video_file_part(
            fileobj=payload,
            filename="final.mp4",
            content_type="video/mp4",
            provider="instagram",
        )
        self.assertEqual(part[0], "file")
        self.assertEqual(part[2], "video/mp4")

    def test_video_file_part_for_linkedin(self) -> None:
        payload = io.BytesIO(b"mp4-bytes")
        part = upload_publisher.build_video_file_part(
            fileobj=payload,
            filename="final.mp4",
            content_type="video/mp4",
            provider="linkedin",
        )
        self.assertEqual(part[0], "video")
        self.assertEqual(part[2], "video/mp4")


class LinkedInPartsContractTest(unittest.TestCase):
    """LinkedIn multipart fields mirror lib/upload/linkedin-handler.ts."""

    def test_linkedin_fields(self) -> None:
        parts = upload_publisher.build_linkedin_parts(
            metadata=upload_publisher.LinkedInMetadata(
                caption="cap",
                account_ids=["urn:li:person:1", "urn:li:organization:2"],
            ),
        )
        fields = {name: value for name, value in parts.fields}
        self.assertEqual(fields.get("provider"), "linkedin")
        self.assertEqual(fields.get("caption"), "cap")
        self.assertEqual(parts.fields.count(("linkedinAccountIds", "urn:li:person:1")), 1)
        self.assertEqual(parts.fields.count(("linkedinAccountIds", "urn:li:organization:2")), 1)

    def test_linkedin_caption_over_limit(self) -> None:
        with self.assertRaises(ValueError) as caught:
            upload_publisher.validate_publish_metadata(
                providers=["linkedin"],
                youtube=None,
                instagram=None,
                linkedin=upload_publisher.LinkedInMetadata(
                    caption="x" * 3001,
                    account_ids=["urn:li:person:1"],
                ),
            )
        self.assertEqual(str(caught.exception), "linkedin caption exceeds 3000 characters")


class PublishVideoDispatchTest(unittest.TestCase):
    """publish_video builds provider-specific multipart requests."""

    def test_publish_video_dispatches_linkedin(self) -> None:
        import unittest.mock as mock

        metadata = upload_publisher.LinkedInMetadata(
            caption="cap",
            account_ids=["urn:li:person:1"],
        )
        response = mock.MagicMock(status_code=200)
        response.json.return_value = {"success": True}
        with mock.patch("requests.post", return_value=response) as post_mock:
            result = upload_publisher.publish_video(
                base_url="https://post-engineer.com",
                api_secret="secret",
                owner_user_id="user-1",
                metadata=metadata,
                video_path="final.mp4",
                video_bytes=b"mp4-bytes",
                content_type="video/mp4",
            )
        self.assertEqual(result, {"success": True})
        kwargs = post_mock.call_args.kwargs
        fields = dict(kwargs["data"])
        self.assertEqual(fields.get("provider"), "linkedin")
        self.assertEqual(fields.get("caption"), "cap")
        self.assertEqual(fields.get("userId"), "user-1")
        self.assertEqual(kwargs["data"].count(("linkedinAccountIds", "urn:li:person:1")), 1)
        file_field = next(iter(kwargs["files"]))
        self.assertEqual(file_field, "video")


if __name__ == "__main__":
    unittest.main()

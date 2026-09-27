"""Contract tests for LinkedIn publish support (engine side).

Covers PublishParams (schema), task_publish bridge and upload_publisher
metadata/multipart rules for the linkedin provider.
"""

import unittest

from app.models.publish import PublishParams, LinkedInPublish
from app.services import upload_publisher
from app.services import task_publish


class LinkedInPublishParamsTest(unittest.TestCase):
    """Schema-level validation for LinkedInPublish."""

    def test_accepts_linkedin_publish(self) -> None:
        params = PublishParams(
            providers=["linkedin"],
            linkedin=LinkedInPublish(caption="post", account_ids=["member-123"]),
        )
        self.assertEqual(params.providers, ["linkedin"])

    def test_rejects_linkedin_without_metadata(self) -> None:
        with self.assertRaises(ValueError):
            PublishParams(providers=["linkedin"])

    def test_rejects_linkedin_without_accounts(self) -> None:
        with self.assertRaises(ValueError):
            PublishParams(
                providers=["linkedin"],
                linkedin=LinkedInPublish(caption="post", account_ids=[]),
            )


class LinkedInMetadataTest(unittest.TestCase):
    """upload_publisher validation for the linkedin provider."""

    def test_accepts_linkedin_metadata(self) -> None:
        metadata = upload_publisher.validate_publish_metadata(
            providers=["linkedin"],
            youtube=None,
            instagram=None,
            bluesky=None,
            linkedin=upload_publisher.LinkedInMetadata(
                caption="post", account_ids=["member-123"],
            ),
        )
        self.assertEqual(metadata.providers, ("linkedin",))

    def test_rejects_linkedin_without_metadata(self) -> None:
        with self.assertRaises(ValueError) as caught:
            upload_publisher.validate_publish_metadata(
                providers=["linkedin"],
                youtube=None,
                instagram=None,
                bluesky=None,
                linkedin=None,
            )
        self.assertEqual(str(caught.exception), "linkedin provider requires linkedin metadata")

    def test_rejects_linkedin_without_accounts(self) -> None:
        with self.assertRaises(ValueError) as caught:
            upload_publisher.validate_publish_metadata(
                providers=["linkedin"],
                youtube=None,
                instagram=None,
                bluesky=None,
                linkedin=upload_publisher.LinkedInMetadata(caption="c", account_ids=[]),
            )
        self.assertEqual(str(caught.exception), "linkedin publish requires at least one account id")


class LinkedInPartsTest(unittest.TestCase):
    """Multipart contract for the linkedin internal route."""

    def test_build_linkedin_parts(self) -> None:
        parts = upload_publisher.build_linkedin_parts(
            upload_publisher.LinkedInMetadata(
                caption="meu post",
                account_ids=["member-123", "urn:li:organization:111"],
            )
        )
        self.assertEqual(
            parts.fields,
            [
                ("provider", "linkedin"),
                ("caption", "meu post"),
                ("linkedinAccountIds", "member-123"),
                ("linkedinAccountIds", "urn:li:organization:111"),
            ],
        )
        self.assertEqual(parts.tags, [])


class LinkedInBridgeTest(unittest.TestCase):
    """task_publish.to_client_metadata bridges LinkedInPublish params."""

    def test_bridge_maps_linkedin_metadata(self) -> None:
        params = PublishParams(
            providers=["linkedin"],
            linkedin=LinkedInPublish(caption="post", account_ids=["member-123"]),
        )
        metadata = task_publish.to_client_metadata(params)
        assert metadata is not None and metadata.linkedin is not None
        self.assertEqual(metadata.linkedin.caption, "post")
        self.assertEqual(metadata.linkedin.account_ids, ("member-123",))


if __name__ == "__main__":
    unittest.main()

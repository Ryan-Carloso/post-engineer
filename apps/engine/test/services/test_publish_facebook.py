"""Contract tests for Facebook Pages publish support (engine side).

Covers PublishParams (schema), the publish_facebook module directly (so the
mutation shard attributes tests to it), the upload_publisher wiring and the
publisher mapping for the facebook provider.
"""

import unittest


from app.providers import SOCIAL_PROVIDERS
from app.services import publish_facebook, upload_publisher
from app.services.publisher.metadata import metadata_for, validate_publish_plan


class PublishFacebookModuleTest(unittest.TestCase):
    def test_validate_requires_metadata_accounts_and_caption_limit(self) -> None:
        validate = publish_facebook.validate_facebook_metadata
        with self.assertRaisesRegex(ValueError, "facebook provider requires facebook metadata"):
            validate(None)
        with self.assertRaisesRegex(ValueError, "facebook publish requires at least one account id"):
            validate(publish_facebook.FacebookMetadata(caption="post", account_ids=()))
        with self.assertRaisesRegex(ValueError, "facebook caption exceeds 63206 characters"):
            validate(publish_facebook.FacebookMetadata(caption="a" * 63207, account_ids=("1",)))
        validate(publish_facebook.FacebookMetadata(caption="a" * 63206, account_ids=("1",)))

    def test_account_ids_are_normalized_to_a_tuple(self) -> None:
        metadata = publish_facebook.FacebookMetadata(caption="post", account_ids=["1", "2"])
        self.assertEqual(metadata.account_ids, ("1", "2"))

    def test_fields_use_the_route_field_names(self) -> None:
        fields = publish_facebook.facebook_fields(
            publish_facebook.FacebookMetadata(caption="post", account_ids=("1", "2"))
        )
        self.assertEqual(
            fields,
            [
                ("provider", "facebook"),
                ("caption", "post"),
                ("aiLabel", "false"),
                ("facebookAccountIds", "1"),
                ("facebookAccountIds", "2"),
            ],
        )

    def test_fields_carry_the_ai_label(self) -> None:
        fields = publish_facebook.facebook_fields(
            publish_facebook.FacebookMetadata(caption="post", account_ids=("1",), ai_label=True)
        )
        self.assertIn(("aiLabel", "true"), fields)


class FacebookPublisherWiringTest(unittest.TestCase):
    def test_validate_publish_metadata_runs_the_facebook_checks(self) -> None:
        validate = upload_publisher.validate_publish_metadata
        with self.assertRaisesRegex(ValueError, "requires facebook metadata"):
            validate(["facebook"], None, None)
        metadata = upload_publisher.FacebookMetadata(caption="post", account_ids=("1",))
        result = validate(["facebook"], None, None, facebook=metadata)
        self.assertIs(result.facebook, metadata)

    def test_provider_and_part_builder_are_registered(self) -> None:
        self.assertIn("facebook", SOCIAL_PROVIDERS)
        metadata_type, build = upload_publisher._PART_BUILDERS["facebook"]
        self.assertIs(metadata_type, upload_publisher.FacebookMetadata)
        parts = build(upload_publisher.FacebookMetadata(caption="post", account_ids=("9",)))
        self.assertEqual(parts.fields[0], ("provider", "facebook"))
        self.assertEqual(parts.tags, [])

    def test_video_is_sent_in_the_video_field(self) -> None:
        field_name, _, _ = upload_publisher.build_video_file_part(
            fileobj=None, filename="v.mp4", content_type="video/mp4", provider="facebook"
        )
        self.assertEqual(field_name, "video")


class FacebookPublishTest(unittest.TestCase):
    schedule = {"providers": ["facebook"], "facebook_account_ids": ["123"]}

    def test_metadata_reads_the_caption_and_accounts(self) -> None:
        metadata = metadata_for("facebook", "title", self.schedule, "Agent description.")
        self.assertIsInstance(metadata, upload_publisher.FacebookMetadata)
        self.assertEqual(metadata.caption, "Agent description.")
        self.assertEqual(metadata.account_ids, ("123",))

    def test_metadata_cuts_the_caption_to_the_limit(self) -> None:
        metadata = metadata_for("facebook", "title", self.schedule, "a" * 70000)
        self.assertEqual(len(metadata.caption), 63206)

    def test_preflight_passes_with_accounts_and_fails_without(self) -> None:
        validate_publish_plan(self.schedule, "title", "Agent description.")
        with self.assertRaisesRegex(ValueError, "at least one account id"):
            validate_publish_plan({"providers": ["facebook"]}, "title", "Agent description.")

    def test_slot_select_reads_the_facebook_column(self) -> None:
        from app.services.publisher.store import ScheduleStore

        columns = ScheduleStore.SLOT_IDENTITY_SELECT.split(",")
        self.assertIn("facebook_account_ids", columns)


if __name__ == "__main__":
    unittest.main()

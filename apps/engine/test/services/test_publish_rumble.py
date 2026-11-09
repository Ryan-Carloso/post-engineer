"""Contract tests for Rumble publish support (engine side).

Covers PublishParams (schema), the publish_rumble module directly (so the
mutation shard attributes tests to it), the upload_publisher wiring and the
fill-schedule mapping for the rumble provider.
"""

import unittest

from pydantic import ValidationError

from app.models.publish import PublishParams, RumblePublish
from app.services import publish_rumble, upload_publisher
from app.services.fill_schedule.metadata import metadata_for, validate_publish_plan


class RumblePublishParamsTest(unittest.TestCase):
    def test_accepts_rumble_publish(self) -> None:
        params = PublishParams(
            providers=["rumble"],
            rumble=RumblePublish(title="post", description="desc", account_ids=["123"]),
        )
        self.assertEqual(params.rumble.account_ids, ["123"])

    def test_rejects_provider_without_metadata(self) -> None:
        with self.assertRaisesRegex(ValidationError, "rumble provider requires rumble metadata"):
            PublishParams(providers=["rumble"])

    def test_rejects_title_over_limit(self) -> None:
        RumblePublish(title="a" * 100, description="desc", account_ids=["123"])
        with self.assertRaises(ValidationError):
            RumblePublish(title="a" * 101, description="desc", account_ids=["123"])

    def test_rejects_empty_description(self) -> None:
        with self.assertRaises(ValidationError):
            RumblePublish(title="post", description="", account_ids=["123"])


class PublishRumbleModuleTest(unittest.TestCase):
    def test_validate_requires_metadata_accounts_title_and_description(self) -> None:
        validate = publish_rumble.validate_rumble_metadata
        with self.assertRaisesRegex(ValueError, "rumble provider requires rumble metadata"):
            validate(None)
        with self.assertRaisesRegex(ValueError, "rumble publish requires at least one account id"):
            validate(publish_rumble.RumbleMetadata(title="post", description="desc", account_ids=()))
        with self.assertRaisesRegex(ValueError, "rumble publish requires a non-empty title"):
            validate(publish_rumble.RumbleMetadata(title="  ", description="desc", account_ids=("1",)))
        with self.assertRaisesRegex(ValueError, "rumble title exceeds 100 characters"):
            validate(publish_rumble.RumbleMetadata(title="a" * 101, description="desc", account_ids=("1",)))
        with self.assertRaisesRegex(ValueError, "rumble publish requires a non-empty description"):
            validate(publish_rumble.RumbleMetadata(title="post", description="  ", account_ids=("1",)))
        # At the title limit is valid.
        validate(publish_rumble.RumbleMetadata(title="a" * 100, description="desc", account_ids=("1",)))

    def test_account_ids_are_normalized_to_a_tuple(self) -> None:
        metadata = publish_rumble.RumbleMetadata(title="post", description="desc", account_ids=["1", "2"])
        self.assertEqual(metadata.account_ids, ("1", "2"))

    def test_fields_use_the_route_field_names_and_personal_use_license(self) -> None:
        fields = publish_rumble.rumble_fields(
            publish_rumble.RumbleMetadata(title="post", description="desc", account_ids=("1", "2"))
        )
        self.assertEqual(
            fields,
            [
                ("provider", "rumble"),
                ("title", "post"),
                ("description", "desc"),
                ("license_type", "0"),
                ("rumbleAccountIds", "1"),
                ("rumbleAccountIds", "2"),
            ],
        )


class RumblePublisherWiringTest(unittest.TestCase):
    def test_validate_publish_metadata_runs_the_rumble_checks(self) -> None:
        validate = upload_publisher.validate_publish_metadata
        with self.assertRaisesRegex(ValueError, "requires rumble metadata"):
            validate(["rumble"], None, None)
        metadata = upload_publisher.RumbleMetadata(title="post", description="desc", account_ids=("1",))
        result = validate(["rumble"], None, None, rumble=metadata)
        self.assertIs(result.rumble, metadata)

    def test_provider_and_part_builder_are_registered(self) -> None:
        self.assertIn("rumble", upload_publisher.VALID_PROVIDERS)
        metadata_type, build = upload_publisher._PART_BUILDERS["rumble"]
        self.assertIs(metadata_type, upload_publisher.RumbleMetadata)
        parts = build(upload_publisher.RumbleMetadata(title="post", description="desc", account_ids=("9",)))
        self.assertEqual(parts.fields[0], ("provider", "rumble"))
        self.assertEqual(parts.tags, [])

    def test_video_is_sent_in_the_video_field(self) -> None:
        field_name, _, _ = upload_publisher.build_video_file_part(
            fileobj=None, filename="v.mp4", content_type="video/mp4", provider="rumble"
        )
        self.assertEqual(field_name, "video")


class RumbleFillScheduleTest(unittest.TestCase):
    schedule = {"providers": ["rumble"], "rumble_account_ids": ["123"]}

    def test_metadata_reads_the_title_description_and_accounts(self) -> None:
        metadata = metadata_for("rumble", "title", self.schedule)
        self.assertIsInstance(metadata, upload_publisher.RumbleMetadata)
        self.assertEqual(metadata.title, "title")
        self.assertEqual(metadata.description, "title")
        self.assertEqual(metadata.account_ids, ("123",))

    def test_metadata_cuts_the_title_to_the_limit(self) -> None:
        metadata = metadata_for("rumble", "a" * 70000, self.schedule)
        self.assertEqual(len(metadata.title), 100)

    def test_preflight_passes_with_accounts_and_fails_without(self) -> None:
        validate_publish_plan(self.schedule, "title")
        with self.assertRaisesRegex(ValueError, "at least one account id"):
            validate_publish_plan({"providers": ["rumble"]}, "title")

    def test_slot_select_reads_the_rumble_column(self) -> None:
        from app.services.fill_schedule.store import ScheduleStore

        columns = ScheduleStore.SLOT_IDENTITY_SELECT.split(",")
        self.assertIn("rumble_account_ids", columns)


if __name__ == "__main__":
    unittest.main()

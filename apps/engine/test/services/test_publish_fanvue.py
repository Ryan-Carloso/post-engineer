"""Contract tests for Fanvue publish support (engine side).

Covers PublishParams (schema), the publish_fanvue module directly (so the
mutation shard attributes tests to it), the upload_publisher wiring and the
fill-schedule mapping for the fanvue provider.
"""

import unittest

from pydantic import ValidationError

from app.models.publish import FanvuePublish, PublishParams
from app.services import publish_fanvue, upload_publisher
from app.services.fill_schedule.metadata import metadata_for, validate_publish_plan


class FanvuePublishParamsTest(unittest.TestCase):
    def test_accepts_fanvue_publish(self) -> None:
        params = PublishParams(
            providers=["fanvue"],
            fanvue=FanvuePublish(
                title="My post", description="The description", account_ids=["user-9"]
            ),
        )
        self.assertEqual(params.fanvue.account_ids, ["user-9"])

    def test_rejects_provider_without_metadata(self) -> None:
        with self.assertRaisesRegex(ValidationError, "fanvue provider requires fanvue metadata"):
            PublishParams(providers=["fanvue"])

    def test_rejects_title_over_limit(self) -> None:
        FanvuePublish(title="a" * 100, description="d", account_ids=["user-9"])
        with self.assertRaises(ValidationError):
            FanvuePublish(title="a" * 101, description="d", account_ids=["user-9"])

    def test_rejects_description_over_limit(self) -> None:
        FanvuePublish(title="t", description="a" * 800, account_ids=["user-9"])
        with self.assertRaises(ValidationError):
            FanvuePublish(title="t", description="a" * 801, account_ids=["user-9"])


class PublishFanvueModuleTest(unittest.TestCase):
    def test_validate_requires_metadata_accounts_title_description_and_limits(self) -> None:
        validate = publish_fanvue.validate_fanvue_metadata
        with self.assertRaisesRegex(ValueError, "fanvue provider requires fanvue metadata"):
            validate(None)
        with self.assertRaisesRegex(ValueError, "fanvue publish requires at least one account id"):
            validate(publish_fanvue.FanvueMetadata(title="t", description="d", account_ids=()))
        with self.assertRaisesRegex(ValueError, "fanvue publish requires a non-empty title"):
            validate(publish_fanvue.FanvueMetadata(title="  ", description="d", account_ids=("1",)))
        with self.assertRaisesRegex(ValueError, "fanvue publish requires a non-empty description"):
            validate(publish_fanvue.FanvueMetadata(title="t", description="  ", account_ids=("1",)))
        with self.assertRaisesRegex(ValueError, "fanvue title exceeds 100 characters"):
            validate(
                publish_fanvue.FanvueMetadata(title="a" * 101, description="d", account_ids=("1",))
            )
        with self.assertRaisesRegex(ValueError, "fanvue description exceeds 800 characters"):
            validate(
                publish_fanvue.FanvueMetadata(title="t", description="a" * 801, account_ids=("1",))
            )
        # At the limits is valid.
        validate(
            publish_fanvue.FanvueMetadata(
                title="a" * 100, description="a" * 800, account_ids=("1",)
            )
        )

    def test_account_ids_are_normalized_to_a_tuple(self) -> None:
        metadata = publish_fanvue.FanvueMetadata(title="t", description="d", account_ids=["1", "2"])
        self.assertEqual(metadata.account_ids, ("1", "2"))

    def test_fields_use_the_route_field_names(self) -> None:
        fields = publish_fanvue.fanvue_fields(
            publish_fanvue.FanvueMetadata(title="t", description="d", account_ids=("1", "2"))
        )
        self.assertEqual(
            fields,
            [
                ("provider", "fanvue"),
                ("title", "t"),
                ("description", "d"),
                ("fanvueAccountIds", "1"),
                ("fanvueAccountIds", "2"),
            ],
        )


class FanvuePublisherWiringTest(unittest.TestCase):
    def test_provider_and_part_builder_are_registered(self) -> None:
        self.assertIn("fanvue", upload_publisher.VALID_PROVIDERS)
        metadata_type, build = upload_publisher._PART_BUILDERS["fanvue"]
        self.assertIs(metadata_type, upload_publisher.FanvueMetadata)
        parts = build(
            upload_publisher.FanvueMetadata(title="t", description="d", account_ids=("9",))
        )
        self.assertEqual(parts.fields[0], ("provider", "fanvue"))
        self.assertEqual(parts.tags, [])

    def test_video_is_sent_in_the_video_field(self) -> None:
        field_name, _, _ = upload_publisher.build_video_file_part(
            fileobj=None, filename="v.mp4", content_type="video/mp4", provider="fanvue"
        )
        self.assertEqual(field_name, "video")


class FanvueFillScheduleTest(unittest.TestCase):
    schedule = {
        "providers": ["fanvue"],
        "fanvue_account_ids": ["user-9"],
    }

    def test_metadata_reads_the_title_description_and_accounts(self) -> None:
        metadata = metadata_for("fanvue", "title", self.schedule, "Agent description.")
        self.assertIsInstance(metadata, upload_publisher.FanvueMetadata)
        self.assertEqual(metadata.title, "title")
        self.assertEqual(metadata.description, "Agent description.")
        self.assertEqual(metadata.account_ids, ("user-9",))

    def test_metadata_cuts_the_title_and_description_to_the_limits(self) -> None:
        metadata = metadata_for("fanvue", "a" * 900, self.schedule, "a" * 900)
        self.assertEqual(len(metadata.title), 100)
        self.assertEqual(len(metadata.description), 800)

    def test_preflight_passes_with_accounts_and_fails_without(self) -> None:
        validate_publish_plan(self.schedule, "title", "Agent description.")
        with self.assertRaisesRegex(ValueError, "at least one account id"):
            validate_publish_plan({"providers": ["fanvue"]}, "title", "Agent description.")

    def test_slot_select_reads_the_fanvue_columns(self) -> None:
        from app.services.fill_schedule.store import ScheduleStore

        columns = ScheduleStore.SLOT_IDENTITY_SELECT.split(",")
        self.assertIn("fanvue_account_ids", columns)


if __name__ == "__main__":
    unittest.main()

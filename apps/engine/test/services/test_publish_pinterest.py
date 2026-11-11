"""Contract tests for Pinterest publish support (engine side).

Covers PublishParams (schema), the publish_pinterest module directly (so the
mutation shard attributes tests to it), the upload_publisher wiring and the
fill-schedule mapping for the pinterest provider.
"""

import unittest

from pydantic import ValidationError

from app.models.publish import PinterestPublish, PublishParams
from app.services import publish_pinterest, upload_publisher
from app.services.fill_schedule.metadata import metadata_for, validate_publish_plan


class PinterestPublishParamsTest(unittest.TestCase):
    def test_accepts_pinterest_publish(self) -> None:
        params = PublishParams(
            providers=["pinterest"],
            pinterest=PinterestPublish(
                title="My pin", description="The description", board_id="b1", account_ids=["user-9"]
            ),
        )
        self.assertEqual(params.pinterest.account_ids, ["user-9"])

    def test_rejects_provider_without_metadata(self) -> None:
        with self.assertRaisesRegex(ValidationError, "pinterest provider requires pinterest metadata"):
            PublishParams(providers=["pinterest"])

    def test_rejects_title_over_limit(self) -> None:
        PinterestPublish(title="a" * 100, description="d", board_id="b1", account_ids=["user-9"])
        with self.assertRaises(ValidationError):
            PinterestPublish(title="a" * 101, description="d", board_id="b1", account_ids=["user-9"])

    def test_rejects_description_over_limit(self) -> None:
        PinterestPublish(title="t", description="a" * 800, board_id="b1", account_ids=["user-9"])
        with self.assertRaises(ValidationError):
            PinterestPublish(title="t", description="a" * 801, board_id="b1", account_ids=["user-9"])


class PublishPinterestModuleTest(unittest.TestCase):
    def test_validate_requires_metadata_accounts_board_and_limits(self) -> None:
        validate = publish_pinterest.validate_pinterest_metadata
        with self.assertRaisesRegex(ValueError, "pinterest provider requires pinterest metadata"):
            validate(None)
        with self.assertRaisesRegex(ValueError, "pinterest publish requires at least one account id"):
            validate(publish_pinterest.PinterestMetadata(title="t", description="d", board_id="b1", account_ids=()))
        with self.assertRaisesRegex(ValueError, "pinterest publish requires a board id"):
            validate(publish_pinterest.PinterestMetadata(title="t", description="d", board_id="  ", account_ids=("1",)))
        with self.assertRaisesRegex(ValueError, "pinterest title exceeds 100 characters"):
            validate(
                publish_pinterest.PinterestMetadata(title="a" * 101, description="d", board_id="b1", account_ids=("1",))
            )
        with self.assertRaisesRegex(ValueError, "pinterest description exceeds 800 characters"):
            validate(
                publish_pinterest.PinterestMetadata(title="t", description="a" * 801, board_id="b1", account_ids=("1",))
            )
        # At the limits is valid.
        validate(
            publish_pinterest.PinterestMetadata(
                title="a" * 100, description="a" * 800, board_id="b1", account_ids=("1",)
            )
        )

    def test_account_ids_are_normalized_to_a_tuple(self) -> None:
        metadata = publish_pinterest.PinterestMetadata(title="t", description="d", board_id="b1", account_ids=["1", "2"])
        self.assertEqual(metadata.account_ids, ("1", "2"))

    def test_fields_use_the_route_field_names(self) -> None:
        fields = publish_pinterest.pinterest_fields(
            publish_pinterest.PinterestMetadata(title="t", description="d", board_id="b1", account_ids=("1", "2"))
        )
        self.assertEqual(
            fields,
            [
                ("provider", "pinterest"),
                ("title", "t"),
                ("description", "d"),
                ("boardId", "b1"),
                ("pinterestAccountIds", "1"),
                ("pinterestAccountIds", "2"),
            ],
        )


class PinterestPublisherWiringTest(unittest.TestCase):
    def test_provider_and_part_builder_are_registered(self) -> None:
        self.assertIn("pinterest", upload_publisher.VALID_PROVIDERS)
        metadata_type, build = upload_publisher._PART_BUILDERS["pinterest"]
        self.assertIs(metadata_type, upload_publisher.PinterestMetadata)
        parts = build(
            upload_publisher.PinterestMetadata(title="t", description="d", board_id="b1", account_ids=("9",))
        )
        self.assertEqual(parts.fields[0], ("provider", "pinterest"))
        self.assertEqual(parts.tags, [])

    def test_video_is_sent_in_the_video_field(self) -> None:
        field_name, _, _ = upload_publisher.build_video_file_part(
            fileobj=None, filename="v.mp4", content_type="video/mp4", provider="pinterest"
        )
        self.assertEqual(field_name, "video")


class PinterestFillScheduleTest(unittest.TestCase):
    schedule = {
        "providers": ["pinterest"],
        "pinterest_account_ids": ["user-9"],
        "pinterest_board_id": "b1",
    }

    def test_metadata_reads_the_title_description_board_and_accounts(self) -> None:
        metadata = metadata_for("pinterest", "title", self.schedule, "Agent description.")
        self.assertIsInstance(metadata, upload_publisher.PinterestMetadata)
        self.assertEqual(metadata.title, "title")
        self.assertEqual(metadata.description, "Agent description.")
        self.assertEqual(metadata.board_id, "b1")
        self.assertEqual(metadata.account_ids, ("user-9",))

    def test_metadata_cuts_the_title_and_description_to_the_limits(self) -> None:
        metadata = metadata_for("pinterest", "a" * 900, self.schedule, "a" * 900)
        self.assertEqual(len(metadata.title), 100)
        self.assertEqual(len(metadata.description), 800)

    def test_preflight_passes_with_board_and_accounts_and_fails_without(self) -> None:
        validate_publish_plan(self.schedule, "title", "Agent description.")
        with self.assertRaisesRegex(ValueError, "at least one account id"):
            validate_publish_plan({"providers": ["pinterest"], "pinterest_board_id": "b1"}, "title", "Agent description.")
        with self.assertRaisesRegex(ValueError, "requires a board id"):
            validate_publish_plan({"providers": ["pinterest"], "pinterest_account_ids": ["user-9"]}, "title", "Agent description.")

    def test_slot_select_reads_the_pinterest_columns(self) -> None:
        from app.services.fill_schedule.store import ScheduleStore

        columns = ScheduleStore.SLOT_IDENTITY_SELECT.split(",")
        self.assertIn("pinterest_account_ids", columns)
        self.assertIn("pinterest_board_id", columns)


if __name__ == "__main__":
    unittest.main()

"""Contract tests for 3Speak (Hive) publish support (engine side).

Covers PublishParams (schema), the publish_threespeak module directly (so the
mutation shard attributes tests to it), the upload_publisher wiring and the
fill-schedule mapping for the 3speak provider.
"""

import unittest

from pydantic import ValidationError

from app.models.publish import PublishParams, ThreespeakPublish
from app.services import publish_threespeak, upload_publisher
from app.services.fill_schedule.metadata import metadata_for, validate_publish_plan


class ThreespeakPublishParamsTest(unittest.TestCase):
    def test_accepts_threespeak_publish(self) -> None:
        params = PublishParams(
            providers=["3speak"],
            threespeak=ThreespeakPublish(caption="post", account_ids=["alice"]),
        )
        self.assertEqual(params.threespeak.account_ids, ["alice"])

    def test_rejects_provider_without_metadata(self) -> None:
        with self.assertRaisesRegex(ValidationError, "3speak provider requires 3speak metadata"):
            PublishParams(providers=["3speak"])

    def test_accepts_a_long_caption_and_rejects_an_empty_one(self) -> None:
        # 3Speak has no documented caption cap: a 70k-character caption is
        # accepted whole, while an empty one is rejected.
        ThreespeakPublish(caption="a" * 70000, account_ids=["alice"])
        with self.assertRaises(ValidationError):
            ThreespeakPublish(caption="", account_ids=["alice"])


class PublishThreespeakModuleTest(unittest.TestCase):
    def test_validate_requires_metadata_accounts_and_a_caption(self) -> None:
        validate = publish_threespeak.validate_threespeak_metadata
        with self.assertRaisesRegex(ValueError, "3speak provider requires 3speak metadata"):
            validate(None)
        with self.assertRaisesRegex(ValueError, "3speak publish requires at least one account id"):
            validate(publish_threespeak.ThreespeakMetadata(caption="post", account_ids=()))
        with self.assertRaisesRegex(ValueError, "3speak publish requires a non-empty caption"):
            validate(publish_threespeak.ThreespeakMetadata(caption="   ", account_ids=("alice",)))
        # A long caption is valid: no cap to enforce.
        validate(publish_threespeak.ThreespeakMetadata(caption="a" * 70000, account_ids=("alice",)))

    def test_account_ids_are_normalized_to_a_tuple(self) -> None:
        metadata = publish_threespeak.ThreespeakMetadata(caption="post", account_ids=["alice", "bob"])
        self.assertEqual(metadata.account_ids, ("alice", "bob"))

    def test_fields_use_the_route_field_names(self) -> None:
        fields = publish_threespeak.threespeak_fields(
            publish_threespeak.ThreespeakMetadata(caption="post", account_ids=("alice", "bob"))
        )
        self.assertEqual(
            fields,
            [
                ("provider", "3speak"),
                ("caption", "post"),
                ("threespeakAccountIds", "alice"),
                ("threespeakAccountIds", "bob"),
            ],
        )


class ThreespeakPublisherWiringTest(unittest.TestCase):
    def test_validate_publish_metadata_runs_the_threespeak_checks(self) -> None:
        validate = upload_publisher.validate_publish_metadata
        with self.assertRaisesRegex(ValueError, "requires 3speak metadata"):
            validate(["3speak"], None, None)
        metadata = upload_publisher.ThreespeakMetadata(caption="post", account_ids=("alice",))
        result = validate(["3speak"], None, None, threespeak=metadata)
        self.assertIs(result.threespeak, metadata)

    def test_provider_and_part_builder_are_registered(self) -> None:
        self.assertIn("3speak", upload_publisher.VALID_PROVIDERS)
        metadata_type, build = upload_publisher._PART_BUILDERS["3speak"]
        self.assertIs(metadata_type, upload_publisher.ThreespeakMetadata)
        parts = build(upload_publisher.ThreespeakMetadata(caption="post", account_ids=("alice",)))
        self.assertEqual(parts.fields[0], ("provider", "3speak"))
        self.assertEqual(parts.tags, [])

    def test_video_is_sent_in_the_video_field(self) -> None:
        field_name, _, _ = upload_publisher.build_video_file_part(
            fileobj=None, filename="v.mp4", content_type="video/mp4", provider="3speak"
        )
        self.assertEqual(field_name, "video")


class ThreespeakFillScheduleTest(unittest.TestCase):
    schedule = {"providers": ["3speak"], "threespeak_account_ids": ["alice"]}

    def test_metadata_reads_the_caption_and_accounts(self) -> None:
        metadata = metadata_for("3speak", "title", self.schedule)
        self.assertIsInstance(metadata, upload_publisher.ThreespeakMetadata)
        self.assertEqual(metadata.caption, "title")
        self.assertEqual(metadata.account_ids, ("alice",))

    def test_metadata_keeps_a_long_title_whole(self) -> None:
        metadata = metadata_for("3speak", "a" * 70000, self.schedule)
        self.assertEqual(len(metadata.caption), 70000)

    def test_preflight_passes_with_accounts_and_fails_without(self) -> None:
        validate_publish_plan(self.schedule, "title")
        with self.assertRaisesRegex(ValueError, "at least one account id"):
            validate_publish_plan({"providers": ["3speak"]}, "title")

    def test_slot_select_reads_the_threespeak_column(self) -> None:
        from app.services.fill_schedule.store import ScheduleStore

        columns = ScheduleStore.SLOT_IDENTITY_SELECT.split(",")
        self.assertIn("threespeak_account_ids", columns)


if __name__ == "__main__":
    unittest.main()

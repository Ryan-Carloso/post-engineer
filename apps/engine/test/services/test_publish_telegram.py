"""Contract tests for Telegram publish support (engine side).

Covers PublishParams (schema), the publish_telegram module directly (so the
mutation shard attributes tests to it), the upload_publisher wiring, the
fill-schedule mapping for the telegram provider, and the caption ceiling
pinned against the web Bot API client.
"""

import re
import unittest
from pathlib import Path


from app.providers import SOCIAL_PROVIDERS
from app.services import publish_telegram, upload_publisher
from app.services.publisher.account_outcomes import _account_ids
from app.services.publisher.metadata import metadata_for, validate_publish_plan


def _repo_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "apps/web/lib/telegram.ts").is_file():
            return parent
    raise AssertionError("repo root not found from the test file location")


class PublishTelegramModuleTest(unittest.TestCase):
    def test_validate_requires_metadata_accounts_caption_and_limit(self) -> None:
        validate = publish_telegram.validate_telegram_metadata
        with self.assertRaisesRegex(ValueError, "telegram provider requires telegram metadata"):
            validate(None)
        with self.assertRaisesRegex(ValueError, "telegram publish requires at least one account id"):
            validate(publish_telegram.TelegramMetadata(caption="c", account_ids=()))
        with self.assertRaisesRegex(ValueError, "telegram publish requires a non-empty caption"):
            validate(publish_telegram.TelegramMetadata(caption="  ", account_ids=("-100",)))
        with self.assertRaisesRegex(ValueError, "telegram caption exceeds 1024 characters"):
            validate(publish_telegram.TelegramMetadata(caption="a" * 1025, account_ids=("-100",)))
        validate(publish_telegram.TelegramMetadata(caption="a" * 1024, account_ids=("-100",)))

    def test_account_ids_are_normalized_to_a_tuple(self) -> None:
        metadata = publish_telegram.TelegramMetadata(caption="c", account_ids=["-1", "-2"])
        self.assertEqual(metadata.account_ids, ("-1", "-2"))

    def test_fields_use_the_route_field_names(self) -> None:
        fields = publish_telegram.telegram_fields(
            publish_telegram.TelegramMetadata(caption="c", account_ids=("-1", "-2"))
        )
        self.assertEqual(
            fields,
            [
                ("provider", "telegram"),
                ("caption", "c"),
                ("telegramAccountIds", "-1"),
                ("telegramAccountIds", "-2"),
            ],
        )

    def test_caption_ceiling_matches_the_web_bot_api_client(self) -> None:
        text = (_repo_root() / "apps/web/lib/telegram.ts").read_text()
        match = re.search(r"TELEGRAM_CAPTION_MAX_LENGTH\s*=\s*(\d+)", text)
        self.assertIsNotNone(match)
        self.assertEqual(int(match.group(1)), publish_telegram.TELEGRAM_CAPTION_MAX_LENGTH)


class TelegramPublisherWiringTest(unittest.TestCase):
    def test_provider_and_part_builder_are_registered(self) -> None:
        self.assertIn("telegram", SOCIAL_PROVIDERS)
        metadata_type, build = upload_publisher._PART_BUILDERS["telegram"]
        self.assertIs(metadata_type, upload_publisher.TelegramMetadata)
        parts = build(upload_publisher.TelegramMetadata(caption="c", account_ids=("-9",)))
        self.assertEqual(parts.fields[0], ("provider", "telegram"))
        self.assertEqual(parts.tags, [])

    def test_video_is_sent_in_the_video_field(self) -> None:
        field_name, _, _ = upload_publisher.build_video_file_part(
            fileobj=None, filename="v.mp4", content_type="video/mp4", provider="telegram"
        )
        self.assertEqual(field_name, "video")

    def test_validate_publish_metadata_accepts_telegram_without_a_gate_here(self) -> None:
        upload_publisher.validate_publish_metadata(["telegram"], None, None)


class TelegramFillScheduleTest(unittest.TestCase):
    schedule = {
        "providers": ["telegram"],
        "telegram_account_ids": ["-1001234567890"],
    }

    def test_metadata_reads_the_description_and_accounts(self) -> None:
        metadata = metadata_for("telegram", "title", self.schedule, "Agent description.")
        self.assertIsInstance(metadata, upload_publisher.TelegramMetadata)
        self.assertEqual(metadata.caption, "Agent description.")
        self.assertEqual(metadata.account_ids, ("-1001234567890",))

    def test_metadata_cuts_the_caption_to_the_limit(self) -> None:
        metadata = metadata_for("telegram", "title", self.schedule, "a" * 2000)
        self.assertEqual(len(metadata.caption), 1024)

    def test_preflight_passes_with_accounts_and_fails_without(self) -> None:
        validate_publish_plan(self.schedule, "title", "Agent description.")
        with self.assertRaisesRegex(ValueError, "telegram publish requires at least one account id"):
            validate_publish_plan({"providers": ["telegram"]}, "title", "Agent description.")

    def test_slot_select_reads_the_telegram_column(self) -> None:
        from app.services.publisher.store import ScheduleStore

        columns = ScheduleStore.SLOT_IDENTITY_SELECT.split(",")
        self.assertIn("telegram_account_ids", columns)

    def test_account_outcomes_read_the_schedule_column(self) -> None:
        self.assertEqual(
            _account_ids("telegram", {"telegram_account_ids": ["-1", "-2"]}), ["-1", "-2"]
        )


if __name__ == "__main__":
    unittest.main()

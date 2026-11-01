"""Contract tests for Threads publish support (engine side).

Covers PublishParams (schema), upload_publisher metadata/multipart rules and
the fill-schedule mapping for the threads provider.
"""

import unittest

from pydantic import ValidationError

from app.models.publish import PublishParams, ThreadsPublish
from app.services import upload_publisher
from app.services.fill_schedule.metadata import metadata_for, validate_publish_plan


class ThreadsPublishParamsTest(unittest.TestCase):
    def test_accepts_threads_publish(self) -> None:
        params = PublishParams(
            providers=["threads"],
            threads=ThreadsPublish(caption="post", account_ids=["42"]),
        )
        self.assertEqual(params.threads.account_ids, ["42"])

    def test_rejects_provider_without_metadata(self) -> None:
        with self.assertRaisesRegex(ValidationError, "threads provider requires threads metadata"):
            PublishParams(providers=["threads"])

    def test_rejects_caption_over_limit(self) -> None:
        with self.assertRaises(ValidationError):
            ThreadsPublish(caption="a" * 501, account_ids=["42"])


class ThreadsPublisherTest(unittest.TestCase):
    def test_validates_required_metadata_and_limits(self) -> None:
        validate = upload_publisher.validate_publish_metadata
        with self.assertRaisesRegex(ValueError, "requires threads metadata"):
            validate(["threads"], None, None)
        no_accounts = upload_publisher.ThreadsMetadata(caption="post", account_ids=())
        with self.assertRaisesRegex(ValueError, "at least one account id"):
            validate(["threads"], None, None, threads=no_accounts)
        too_long = upload_publisher.ThreadsMetadata(caption="a" * 501, account_ids=("42",))
        with self.assertRaisesRegex(ValueError, "threads caption exceeds 500"):
            validate(["threads"], None, None, threads=too_long)

    def test_parts_use_the_route_field_names(self) -> None:
        parts = upload_publisher.build_threads_parts(
            upload_publisher.ThreadsMetadata(caption="post", account_ids=("1", "2"))
        )
        self.assertEqual(
            parts.fields,
            [
                ("provider", "threads"),
                ("caption", "post"),
                ("threadsAccountIds", "1"),
                ("threadsAccountIds", "2"),
            ],
        )
        self.assertIn("threads", upload_publisher.VALID_PROVIDERS)
        self.assertIn("threads", upload_publisher._PART_BUILDERS)


class ThreadsFillScheduleTest(unittest.TestCase):
    schedule = {"providers": ["threads"], "threads_account_ids": ["42"]}

    def test_metadata_cuts_the_title_to_the_limit_and_reads_accounts(self) -> None:
        metadata = metadata_for("threads", "a" * 600, self.schedule)
        self.assertIsInstance(metadata, upload_publisher.ThreadsMetadata)
        self.assertEqual(len(metadata.caption), 500)
        self.assertEqual(metadata.account_ids, ("42",))

    def test_preflight_passes_with_accounts_and_fails_without(self) -> None:
        validate_publish_plan(self.schedule, "title")
        with self.assertRaisesRegex(ValueError, "at least one account id"):
            validate_publish_plan({"providers": ["threads"]}, "title")


if __name__ == "__main__":
    unittest.main()

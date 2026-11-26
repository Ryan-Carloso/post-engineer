import unittest

from app.services.publisher.publish_events import (
    partial_failure_properties,
    provider_failed_properties,
    publish_failed_properties,
    publish_tracking_context,
)
from app.services.upload_publisher import PublishError

SLOT = {"id": "slot-1", "user_id": "user-1"}
SCHEDULE = {"id": "sched-1", "persona_id": "persona-1"}


class PublishTrackingContextTests(unittest.TestCase):
    def test_names_the_slot_owner_schedule_and_persona(self) -> None:
        self.assertEqual(
            publish_tracking_context(SLOT, SCHEDULE),
            {"slotId": "slot-1", "user_id": "user-1", "schedule_id": "sched-1", "persona_id": "persona-1"},
        )

    def test_omits_blank_identity_values(self) -> None:
        self.assertEqual(
            publish_tracking_context({"id": 7}, {"id": "", "persona_id": None}),
            {"slotId": "7"},
        )

    def test_reads_the_owner_from_the_schedule_embed(self) -> None:
        slot = {"id": "slot-1", "schedules": {"user_id": "user-9"}}
        self.assertEqual(publish_tracking_context(slot, {})["user_id"], "user-9")


class FailurePropertiesTests(unittest.TestCase):
    def test_provider_failure_carries_status_scrubbed_body_and_reason(self) -> None:
        exc = PublishError(
            "upload API returned HTTP 503",
            status_code=503,
            response_body="x" * 600,
        )
        props = provider_failed_properties(SLOT, SCHEDULE, "youtube", exc)
        self.assertEqual(props["provider"], "youtube")
        self.assertEqual(props["status_code"], 503)
        self.assertLessEqual(len(str(props["response_body"])), 500)
        self.assertEqual(props["reason"], "upload API returned HTTP 503")
        self.assertEqual(props["slotId"], "slot-1")

    def test_provider_failure_without_a_provider_is_unknown(self) -> None:
        props = provider_failed_properties(SLOT, SCHEDULE, None, OSError(""))
        self.assertEqual(props["provider"], "unknown")
        self.assertIsNone(props["status_code"])
        self.assertEqual(props["response_body"], "")
        self.assertEqual(props["reason"], "OSError")

    def test_publish_failure_falls_back_and_keeps_extra_fields(self) -> None:
        props = publish_failed_properties(SLOT, SCHEDULE, "", retryable=False, attempts=3)
        self.assertEqual(props["reason"], "Error")
        self.assertEqual(props["retryable"], False)
        self.assertEqual(props["attempts"], 3)

    def test_partial_failure_reason_prefers_the_first_error(self) -> None:
        props = partial_failure_properties(SLOT, SCHEDULE, ["bluesky"], ["youtube"], "boom")
        self.assertEqual(props["reason"], "boom")
        self.assertEqual(props["failed_providers"], ["bluesky"])
        self.assertEqual(props["published_providers"], ["youtube"])

    def test_partial_failure_reason_falls_back_to_the_failed_providers(self) -> None:
        self.assertEqual(partial_failure_properties(SLOT, SCHEDULE, ["a", "b"], [])["reason"], "a,b")
        self.assertEqual(partial_failure_properties(SLOT, SCHEDULE, [], [])["reason"], "partial_failure")


if __name__ == "__main__":
    unittest.main()

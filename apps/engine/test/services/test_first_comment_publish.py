"""First comment plumbing in the engine: the wire field, the slot hand-off
and the warning codes the web answers with."""

from __future__ import annotations

import os
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from http.server import HTTPServer

from app.providers import COMMENT_PROVIDERS
from app.services import upload_publisher
from app.services.publisher.account_outcomes import _publish_outcome
from app.services.publisher.publish_accounts import publish_slot_accounts
from test.services.test_upload_publisher_client import _MockHandler

NOW = datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)


def _bluesky_metadata() -> upload_publisher.BlueskyMetadata:
    return upload_publisher.BlueskyMetadata(caption="caption", account_ids=["did:plc:abc"])


def _pinterest_metadata() -> upload_publisher.PinterestMetadata:
    return upload_publisher.PinterestMetadata(
        title="title", description="description", board_id="board-1", account_ids=["pin-1"]
    )


class FirstCommentWireTest(unittest.TestCase):
    def setUp(self) -> None:
        self.server = HTTPServer(("127.0.0.1", 0), _MockHandler)
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        _MockHandler.responses = [(200, {"success": True})]
        _MockHandler.requests = []

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def _publish(self, metadata, first_comment):
        upload_publisher.publish_video(
            base_url=self.base_url,
            api_secret="secret-key",
            owner_user_id="user-1",
            metadata=metadata,
            video_path="final.mp4",
            video_bytes=b"mp4-bytes",
            content_type="video/mp4",
            timeout_seconds=5,
            sleep=lambda seconds: None,
            first_comment=first_comment,
        )
        return _MockHandler.requests[0]["body"]

    def test_sends_the_first_comment_field_for_a_comment_network(self) -> None:
        body = self._publish(_bluesky_metadata(), "Link in bio")
        self.assertIn(b'name="firstComment"', body)
        self.assertIn(b"Link in bio", body)

    def test_omits_the_field_for_a_network_without_a_comment_api(self) -> None:
        self.assertNotIn("pinterest", COMMENT_PROVIDERS)
        self.assertNotIn(b"firstComment", self._publish(_pinterest_metadata(), "Link in bio"))

    def test_omits_the_field_when_there_is_no_first_comment(self) -> None:
        self.assertNotIn(b"firstComment", self._publish(_bluesky_metadata(), None))
        _MockHandler.responses = [(200, {"success": True})]
        _MockHandler.requests = []
        self.assertNotIn(b"firstComment", self._publish(_bluesky_metadata(), ""))


class FirstCommentSlotTest(unittest.TestCase):
    def setUp(self) -> None:
        handle, self.video_path = tempfile.mkstemp(suffix=".mp4")
        with os.fdopen(handle, "wb") as video_file:
            video_file.write(b"fake-video-bytes")
        self.addCleanup(os.unlink, self.video_path)

    def _run(self, publish, first_comment):
        schedule = {
            "id": "sched-1",
            "user_id": "user-1",
            "providers": ["bluesky"],
            "bluesky_account_ids": ["bsky-1"],
        }
        slot = {"id": "slot-1", "title": "Porto", "schedules": schedule}

        def persist(saved, fields):
            slot["publish_outcomes"] = [dict(item) for item in saved]

        kwargs = {} if first_comment is None else {"first_comment": first_comment}
        result = publish_slot_accounts(
            slot, schedule, [self.video_path], lambda: b"fake-video-bytes",
            NOW, "Porto", "Porto description.",
            base_url="https://post-engineer.com", api_secret="s", publish_video=publish,
            persist_outcomes=persist, **kwargs,
        )
        return result

    def test_hands_the_first_comment_to_the_publish_call(self) -> None:
        seen: list[dict] = []

        def publish(**kwargs):
            seen.append(kwargs)
            return {"results": [{"accountId": "bsky-1", "success": True, "postId": "at://x"}]}

        self._run(publish, "Link in bio")
        self.assertEqual(seen[0]["first_comment"], "Link in bio")

    def test_does_not_pass_the_argument_when_the_slot_has_no_comment(self) -> None:
        seen: list[dict] = []

        def publish(**kwargs):
            seen.append(kwargs)
            return {"results": [{"accountId": "bsky-1", "success": True, "postId": "at://x"}]}

        self._run(publish, None)
        self.assertNotIn("first_comment", seen[0])

    def test_keeps_the_warning_code_on_a_published_outcome(self) -> None:
        def publish(**kwargs):
            return {
                "results": [{
                    "accountId": "bsky-1", "success": True, "postId": "at://x",
                    "warnings": ["FIRST_COMMENT_RECONNECT_REQUIRED"],
                }],
            }

        result = self._run(publish, "Link in bio")
        outcome = result.outcomes[0]
        self.assertEqual(outcome["status"], "published")
        self.assertEqual(outcome["warnings"], ["FIRST_COMMENT_RECONNECT_REQUIRED"])
        self.assertTrue(result.any_published)
        self.assertEqual(result.failed_providers, [])


class PublishOutcomeWarningsTest(unittest.TestCase):
    def test_copies_string_warnings_only(self) -> None:
        outcome: dict = {"provider": "youtube"}
        _publish_outcome(outcome, {"postId": "abc", "warnings": ["FIRST_COMMENT_FAILED", 7, "", None]})
        self.assertEqual(outcome["warnings"], ["FIRST_COMMENT_FAILED"])

    def test_clears_stale_warnings_when_the_result_has_none(self) -> None:
        outcome: dict = {"provider": "youtube", "warnings": ["FIRST_COMMENT_FAILED"]}
        _publish_outcome(outcome, {"postId": "abc"})
        self.assertNotIn("warnings", outcome)

    def test_ignores_a_warnings_value_that_is_not_a_list(self) -> None:
        outcome: dict = {"provider": "youtube"}
        _publish_outcome(outcome, {"postId": "abc", "warnings": "FIRST_COMMENT_FAILED"})
        self.assertNotIn("warnings", outcome)


if __name__ == "__main__":
    unittest.main()

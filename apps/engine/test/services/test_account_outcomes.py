"""Direct tests for fill_schedule/account_outcomes.py (issue #500)."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from app.services.fill_schedule.account_outcomes import (
    USER_CODES,
    _fail_outcome,
    _targets_from_body,
    exhaust_outcome,
    user_notice,
)

NOW = datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)


def _outcome(attempts: int) -> dict:
    return {"provider": "threads", "accountId": "th-1", "video": "v.mp4", "attempts": attempts}


class UserNoticeTests(unittest.TestCase):
    def test_email_notice_names_the_provider_in_the_fix(self) -> None:
        self.assertEqual(
            user_notice("bluesky", "email_not_verified"),
            "Bluesky did not publish because the email on this account is not verified. "
            "This is a problem with your account. Only you can fix it: verify the email on Bluesky.",
        )

    def test_reconnect_notice_for_every_other_user_code(self) -> None:
        for code in USER_CODES - {"email_not_verified"}:
            self.assertEqual(
                user_notice("threads", code),
                "Threads did not publish because the account needs to be reconnected. "
                "This is a problem with your account. Only you can fix it: reconnect Threads.",
            )

    def test_no_user_notice_for_engine_codes(self) -> None:
        self.assertIsNone(user_notice("youtube", "retries_exhausted"))
        self.assertIsNone(user_notice("youtube", "publish_rejected"))


class FailOutcomeTests(unittest.TestCase):
    def test_text_never_turns_a_rejection_into_a_user_failure(self) -> None:
        outcome = _outcome(1)
        _fail_outcome(outcome, "Media ID not found", "publish_rejected", 200, NOW)
        self.assertEqual(outcome["code"], "publish_rejected")
        self.assertFalse(outcome["requiresUser"])
        self.assertEqual(outcome["status"], "failed")

    def test_transient_under_the_cap_waits(self) -> None:
        outcome = _outcome(1)
        _fail_outcome(outcome, "credential service unavailable", None, 503, NOW)
        self.assertEqual(outcome["status"], "retrying")
        self.assertEqual(outcome["retryAt"], "2026-09-07T12:00:30+00:00")
        self.assertFalse(outcome["requiresUser"])

    def test_transient_at_the_cap_is_exhausted(self) -> None:
        outcome = _outcome(3)
        _fail_outcome(outcome, "upload URL expired", "transient", 200, NOW)
        self.assertEqual(outcome["code"], "retries_exhausted")
        self.assertEqual(outcome["notice"], "Threads did not publish after 3 attempts.")

    def test_exhaust_outcome_is_terminal_without_user_copy(self) -> None:
        outcome = {**_outcome(3), "status": "retrying", "retryAt": "x", "requiresUser": True}
        exhaust_outcome(outcome)
        self.assertEqual(
            (outcome["status"], outcome["code"], outcome["requiresUser"], outcome["retryAt"]),
            ("failed", "retries_exhausted", False, None),
        )


class TargetsFromBodyTests(unittest.TestCase):
    def test_unlabeled_failure_applies_to_all_pending_accounts(self) -> None:
        body = {"results": [{"success": False, "error": "Caption is required", "errorCode": "publish_rejected"}]}
        assigned = _targets_from_body(["a", "b"], body)
        for account_id in ("a", "b"):
            kind, source = assigned[account_id]
            self.assertEqual(kind, "failed")
            self.assertEqual(source["errorCode"], "publish_rejected")
            self.assertEqual(source["error"], "Caption is required")

    def test_unlabeled_success_is_not_spread_over_several_accounts(self) -> None:
        body = {"results": [{"success": True, "postId": "p1"}]}
        assigned = _targets_from_body(["a", "b"], body)
        self.assertEqual(assigned["a"][0], "failed")
        self.assertEqual(assigned["b"][0], "failed")

    def test_labeled_results_win_over_the_unlabeled_one(self) -> None:
        body = {
            "results": [
                {"accountId": "a", "success": True, "postId": "p1"},
                {"success": False, "error": "x", "errorCode": "publish_rejected"},
            ]
        }
        assigned = _targets_from_body(["a", "b"], body)
        self.assertEqual(assigned["a"][0], "published")
        self.assertEqual(assigned["b"][1]["errorCode"], "publish_rejected")


if __name__ == "__main__":
    unittest.main()

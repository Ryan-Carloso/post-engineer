"""Direct tests for fill_schedule/account_outcomes.py (issue #500)."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from app.services.fill_schedule.account_outcomes import (
    MAX_IN_PROGRESS_WAIT_SECONDS,
    USER_CODES,
    _account_ids,
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

    def test_facebook_notice_names_the_provider(self) -> None:
        self.assertEqual(
            user_notice("facebook", "token_expired"),
            "Facebook did not publish because the account needs to be reconnected. "
            "This is a problem with your account. Only you can fix it: reconnect Facebook.",
        )

    def test_pinterest_notice_names_the_provider(self) -> None:
        self.assertEqual(
            user_notice("pinterest", "token_expired"),
            "Pinterest did not publish because the account needs to be reconnected. "
            "This is a problem with your account. Only you can fix it: reconnect Pinterest.",
        )

    def test_rumble_notice_names_the_provider(self) -> None:
        self.assertEqual(
            user_notice("rumble", "token_expired"),
            "Rumble did not publish because the account needs to be reconnected. "
            "This is a problem with your account. Only you can fix it: reconnect Rumble.",
        )

    def test_fanvue_notice_names_the_provider(self) -> None:
        self.assertEqual(
            user_notice("fanvue", "token_expired"),
            "Fanvue did not publish because the account needs to be reconnected. "
            "This is a problem with your account. Only you can fix it: reconnect Fanvue.",
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

    def test_in_progress_waits_without_spending_an_attempt(self) -> None:
        # The web route is still publishing this account under an earlier
        # request that outlived the engine's 600s timeout. The retry waits
        # for that attempt instead of starting a second publish, so the
        # attempt is not spent: a slow upload cannot exhaust the budget.
        outcome = _outcome(2)
        _fail_outcome(outcome, "publish still running on the web", "publish_in_progress", 200, NOW)
        self.assertEqual(outcome["status"], "retrying")
        self.assertEqual(outcome["code"], "publish_in_progress")
        self.assertEqual(outcome["attempts"], 1)
        self.assertEqual(outcome["retryAt"], "2026-09-07T12:01:00+00:00")
        self.assertFalse(outcome["requiresUser"])
        self.assertIsNone(outcome["notice"])

    def test_in_progress_at_the_cap_still_waits(self) -> None:
        # Even a third recorded try waits when the web says the first
        # attempt is still in flight — the slot must not fail (and refund)
        # while its post is about to go live.
        outcome = _outcome(3)
        _fail_outcome(outcome, "publish still running on the web", "publish_in_progress", 200, NOW)
        self.assertEqual(
            (outcome["status"], outcome["code"], outcome["attempts"]),
            ("retrying", "publish_in_progress", 2),
        )

    def test_in_progress_records_waited_seconds(self) -> None:
        outcome = _outcome(2)
        _fail_outcome(outcome, "publish still running on the web", "publish_in_progress", 200, NOW)
        self.assertEqual(outcome["status"], "retrying")
        self.assertEqual(outcome["inProgressWaitSeconds"], 60)
        self.assertEqual(outcome["attempts"], 1)

    def test_in_progress_below_the_wait_cap_keeps_waiting(self) -> None:
        outcome = _outcome(1)
        outcome["inProgressWaitSeconds"] = MAX_IN_PROGRESS_WAIT_SECONDS - 120
        _fail_outcome(outcome, "publish still running on the web", "publish_in_progress", 200, NOW)
        self.assertEqual(outcome["status"], "retrying")
        self.assertEqual(outcome["code"], "publish_in_progress")
        self.assertEqual(outcome["inProgressWaitSeconds"], MAX_IN_PROGRESS_WAIT_SECONDS - 60)

    def test_in_progress_at_the_wait_cap_fails_as_unknown(self) -> None:
        # The wait is bounded: past the cap the account fails terminally
        # as publish_unknown — the first post may already be live, so only
        # a human who checked the provider may post again, and the token
        # is not refunded. The attempt is not handed back: the slot did
        # spend one publish try (the timed-out first call).
        outcome = _outcome(1)
        outcome["inProgressWaitSeconds"] = MAX_IN_PROGRESS_WAIT_SECONDS - 60
        _fail_outcome(outcome, "publish still running on the web", "publish_in_progress", 200, NOW)
        self.assertEqual(outcome["status"], "failed")
        self.assertEqual(outcome["code"], "publish_unknown")
        self.assertTrue(outcome["requiresUser"])
        self.assertEqual(outcome["notice"], user_notice("threads", "publish_unknown"))
        self.assertIsNone(outcome["retryAt"])
        self.assertEqual(outcome["attempts"], 1)

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

    def test_single_non_dict_result_for_synthetic_target_fails_without_crashing(self) -> None:
        assigned = _targets_from_body([""], {"results": ["garbage"]})
        self.assertEqual(assigned[""], ("failed", {"error": "upload API reported account failure", "errorCode": None}))


class AccountIdsTests(unittest.TestCase):
    def test_facebook_reads_the_schedule_column_not_the_synthetic_target(self) -> None:
        self.assertEqual(_account_ids("facebook", {"facebook_account_ids": ["123", "456"]}), ["123", "456"])

    def test_pinterest_reads_the_schedule_column_not_the_synthetic_target(self) -> None:
        self.assertEqual(_account_ids("pinterest", {"pinterest_account_ids": ["123", "456"]}), ["123", "456"])

    def test_rumble_reads_the_schedule_column_not_the_synthetic_target(self) -> None:
        self.assertEqual(_account_ids("rumble", {"rumble_account_ids": ["123", "456"]}), ["123", "456"])

    def test_fanvue_reads_the_schedule_column_not_the_synthetic_target(self) -> None:
        self.assertEqual(_account_ids("fanvue", {"fanvue_account_ids": ["123", "456"]}), ["123", "456"])

    def test_no_account_list_is_one_synthetic_target(self) -> None:
        self.assertEqual(_account_ids("threads", {}), [""])


if __name__ == "__main__":
    unittest.main()

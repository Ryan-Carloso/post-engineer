"""Direct unit tests for the extracted upload failure reason helper."""

from __future__ import annotations

import unittest

from app.services.upload_publisher_failure import application_failure_reason


class ApplicationFailureReasonTests(unittest.TestCase):
    def test_top_level_failure_reports_failure(self) -> None:
        self.assertEqual(
            application_failure_reason({"success": False, "error": "boom"}),
            "upload API reported failure",
        )

    def test_top_level_success_reports_none(self) -> None:
        self.assertIsNone(application_failure_reason({"success": True}))

    def test_every_account_failed_reports_failure(self) -> None:
        self.assertEqual(
            application_failure_reason(
                {
                    "success": True,
                    "results": [
                        {"accountId": "a", "success": False},
                        {"accountId": "b", "success": False},
                    ],
                }
            ),
            "upload API reported failure for every account",
        )

    def test_one_account_posted_reports_none(self) -> None:
        self.assertIsNone(
            application_failure_reason(
                {
                    "success": True,
                    "results": [
                        {"accountId": "a", "success": False},
                        {"accountId": "b", "success": True},
                    ],
                }
            )
        )

    def test_empty_results_reports_none(self) -> None:
        self.assertIsNone(application_failure_reason({"success": True, "results": []}))

    def test_non_dict_results_reports_none(self) -> None:
        self.assertIsNone(application_failure_reason({"success": True, "results": "nope"}))


if __name__ == "__main__":
    unittest.main()

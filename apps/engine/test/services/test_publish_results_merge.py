"""merge_prior_published must keep one published entry per account.

A retry records the whole ``publish_results`` key again, so the merge
keeps prior published entries the new attempt did not repost. Keying
only on (provider, video) drops the first account's link when a second
account of the same provider publishes the same video.
"""

from __future__ import annotations

from unittest import TestCase

from app.services.fill_schedule.publish_results import merge_prior_published


class MergePriorPublishedTests(TestCase):
    def test_second_account_of_same_provider_keeps_the_first_link(self) -> None:
        existing = [
            {
                "provider": "youtube",
                "video": "final-1.mp4",
                "status": "published",
                "accountId": "chan-1",
                "url": "https://youtube.invalid/a",
            }
        ]
        new = [
            {
                "provider": "youtube",
                "video": "final-1.mp4",
                "status": "published",
                "accountId": "chan-2",
                "url": "https://youtube.invalid/b",
            }
        ]
        merged = merge_prior_published(existing, new)
        self.assertEqual(
            [entry.get("accountId") for entry in merged], ["chan-1", "chan-2"]
        )

    def test_repost_of_the_same_account_replaces_its_prior_entry(self) -> None:
        existing = [
            {
                "provider": "youtube",
                "video": "final-1.mp4",
                "status": "published",
                "accountId": "chan-1",
                "url": "https://youtube.invalid/old",
            }
        ]
        new = [
            {
                "provider": "youtube",
                "video": "final-1.mp4",
                "status": "published",
                "accountId": "chan-1",
                "url": "https://youtube.invalid/new",
            }
        ]
        merged = merge_prior_published(existing, new)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["url"], "https://youtube.invalid/new")

    def test_entries_without_an_account_still_dedupe_by_provider_and_video(self) -> None:
        # Top-level link bodies carry no accountId: two such entries for
        # the same provider/video are the same post, not two accounts.
        existing = [
            {
                "provider": "youtube",
                "video": "final-1.mp4",
                "status": "published",
                "url": "https://youtube.invalid/old",
            }
        ]
        new = [
            {
                "provider": "youtube",
                "video": "final-1.mp4",
                "status": "published",
                "url": "https://youtube.invalid/new",
            }
        ]
        merged = merge_prior_published(existing, new)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["url"], "https://youtube.invalid/new")

    def test_failed_entries_are_never_preserved(self) -> None:
        existing = [
            {
                "provider": "youtube",
                "video": "final-1.mp4",
                "status": "failed",
                "accountId": "chan-1",
                "error": "boom",
            }
        ]
        merged = merge_prior_published(existing, [])
        self.assertEqual(merged, [])

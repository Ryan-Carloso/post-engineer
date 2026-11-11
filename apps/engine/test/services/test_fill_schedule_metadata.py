"""Provider metadata with agent-supplied publish copy (issue #542 follow-up).

metadata_for builds each provider's publish copy from the slot title and
the agent-supplied description. The description is REQUIRED and is used
verbatim wherever the provider takes one — there is no fallback to the
title. A blank description fails loudly with a RuntimeError, so a slot
that could never publish is caught by the pre-flight before GPU is spent.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.fill_schedule.metadata import metadata_for, validate_publish_plan

SCHEDULE = {
    "youtube_account_ids": ["yt-1"],
    "linkedin_account_ids": ["li-1"],
    "threads_account_ids": ["th-1"],
    "facebook_account_ids": ["fb-1"],
    "pinterest_account_ids": ["pin-1"],
    "pinterest_board_id": "board-1",
    "threespeak_account_ids": ["hive-1"],
    "rumble_account_ids": ["rum-1"],
    "fanvue_account_ids": ["fv-1"],
    "instagram_account_ids": ["ig-1"],
    "bluesky_account_ids": ["did:1"],
}


class MetadataForDescriptionTests(unittest.TestCase):
    def test_youtube_uses_the_agent_title_and_description(self):
        metadata = metadata_for("youtube", "Slot title", SCHEDULE, "Agent description.")
        self.assertEqual(metadata.title, "Slot title")
        self.assertEqual(metadata.description, "Agent description.")

    def test_pinterest_uses_the_agent_description(self):
        metadata = metadata_for("pinterest", "Slot title", SCHEDULE, "Agent description.")
        self.assertEqual(metadata.title, "Slot title")
        self.assertEqual(metadata.description, "Agent description.")

    def test_rumble_uses_the_agent_description(self):
        metadata = metadata_for("rumble", "Slot title", SCHEDULE, "Agent description.")
        self.assertEqual(metadata.description, "Agent description.")

    def test_fanvue_uses_the_agent_description(self):
        metadata = metadata_for("fanvue", "Slot title", SCHEDULE, "Agent description.")
        self.assertEqual(metadata.title, "Slot title")
        self.assertEqual(metadata.description, "Agent description.")

    def test_caption_providers_use_the_agent_description(self):
        for provider in ("linkedin", "threads", "facebook", "3speak", "instagram", "bluesky"):
            with self.subTest(provider=provider):
                metadata = metadata_for(provider, "Slot title", SCHEDULE, "Agent description.")
                self.assertEqual(metadata.caption, "Agent description.")

    def test_blank_description_fails_loudly(self):
        for blank in ("", "   "):
            with self.subTest(blank=blank):
                with self.assertRaisesRegex(RuntimeError, "video description"):
                    metadata_for("youtube", "Slot title", SCHEDULE, blank)

    def test_validate_publish_plan_rejects_a_blank_description(self):
        schedule = dict(SCHEDULE, providers=["youtube", "pinterest"])
        with self.assertRaisesRegex(RuntimeError, "video description"):
            validate_publish_plan(schedule, "Slot title", "")

    def test_validate_publish_plan_accepts_a_description(self):
        schedule = dict(SCHEDULE, providers=["youtube", "pinterest"])
        validate_publish_plan(schedule, "Slot title", "Agent description.")

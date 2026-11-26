import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.fill_schedule.metadata import metadata_for

SCHEDULE = {
    "youtube_account_ids": ["yt-1"],
    "instagram_account_ids": ["ig-1"],
}


class PersonaAiLabelTests(unittest.TestCase):
    def test_youtube_and_instagram_carry_the_persona_ai_label(self):
        schedule = dict(SCHEDULE, personas={"ai_label": True})
        self.assertTrue(metadata_for("youtube", "Slot title", schedule, "Copy.").ai_label)
        self.assertTrue(metadata_for("instagram", "Slot title", schedule, "Copy.").ai_label)

    def test_ai_label_defaults_off_without_a_persona(self):
        self.assertFalse(metadata_for("youtube", "Slot title", SCHEDULE, "Copy.").ai_label)
        self.assertFalse(metadata_for("instagram", "Slot title", SCHEDULE, "Copy.").ai_label)

    def test_ai_label_requires_literal_true(self):
        for value in (False, None, "true", 1):
            with self.subTest(value=value):
                schedule = dict(SCHEDULE, personas={"ai_label": value})
                self.assertFalse(metadata_for("youtube", "Slot title", schedule, "Copy.").ai_label)


if __name__ == "__main__":
    unittest.main()

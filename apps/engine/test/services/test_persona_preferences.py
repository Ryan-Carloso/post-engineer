import unittest

from pydantic import ValidationError

from app.config import config
from app.models.schema import TaskVideoRequest


class TestPersonaPreferences(unittest.TestCase):
    def test_task_accepts_persona_and_all_content_preferences(self):
        request = TaskVideoRequest(
            video_subject="Morning in Lisbon",
            video_language="pt",
            video_aspect="16:9",
            video_script_prompt="Storytelling with a strong hook.",
            paragraph_number=3,
            persona={
                "name": "Ana",
                "photo_url": "https://cdn.example.test/ana.png",
                "voice_id": "calm",
            },
        )

        self.assertEqual(request.video_language, "pt")
        self.assertEqual(request.video_aspect, "16:9")
        self.assertEqual(request.video_script_prompt, "Storytelling with a strong hook.")
        self.assertEqual(request.paragraph_number, 3)
        self.assertEqual(request.persona.name, "Ana")

    def test_missing_preferences_keep_moneyprint_defaults(self):
        request = TaskVideoRequest(
            video_subject="Morning in Lisbon",
            persona={
                "name": "Ana",
                "photo_url": "https://cdn.example.test/ana.png",
                "voice_id": "calm",
            },
        )

        self.assertEqual(request.video_language, "")
        self.assertEqual(request.video_aspect, "9:16")
        self.assertEqual(
            request.video_script_prompt,
            config.app.get("default_video_script_prompt", ""),
        )
        self.assertIsNone(request.paragraph_number)

    def test_invalid_video_aspect_is_rejected(self):
        with self.assertRaises(ValidationError):
            TaskVideoRequest(video_subject="test", video_aspect="4:3")

    def test_paragraph_number_must_be_between_one_and_ten(self):
        with self.assertRaises(ValidationError):
            TaskVideoRequest(video_subject="test", paragraph_number=0)
        with self.assertRaises(ValidationError):
            TaskVideoRequest(video_subject="test", paragraph_number=11)


if __name__ == "__main__":
    unittest.main()

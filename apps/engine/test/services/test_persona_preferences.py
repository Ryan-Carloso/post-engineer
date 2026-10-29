import unittest

from pydantic import ValidationError

from app.models.schema import TaskVideoRequest


class TestPersonaPreferences(unittest.TestCase):
    def test_task_accepts_persona_and_all_content_preferences(self):
        request = TaskVideoRequest(
            video_subject="Morning in Lisbon",
            video_language="pt",
            video_aspect="16:9",
            paragraph_number=3,
            persona={
                "name": "Ana",
                "photo_url": "https://cdn.example.test/ana.png",
                "voice_id": "calm",
            },
        )

        self.assertEqual(request.video_language, "pt")
        self.assertEqual(request.video_aspect, "16:9")
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
        self.assertIsNone(request.paragraph_number)

    def test_script_prompt_fields_are_gone_from_the_generation_request(self):
        # Phase 5-4: scripts come from segments only. The generation
        # request no longer carries a script prompt or a system prompt.
        self.assertNotIn("video_script_prompt", TaskVideoRequest.model_fields)
        self.assertNotIn("custom_system_prompt", TaskVideoRequest.model_fields)

    def test_stale_script_prompt_fields_are_ignored_not_rejected(self):
        # A direct engine caller that still sends the removed fields must
        # not break the segments pipeline: pydantic's default extra
        # behaviour drops them instead of failing the request.
        request = TaskVideoRequest(
            video_subject="Morning in Lisbon",
            persona={
                "name": "Ana",
                "photo_url": "https://cdn.example.test/ana.png",
                "voice_id": "calm",
            },
            video_script_prompt="Stale prompt from an old caller.",
            custom_system_prompt="Stale system prompt from an old caller.",
        )

        self.assertNotIn("video_script_prompt", request.model_dump())
        self.assertNotIn("custom_system_prompt", request.model_dump())
        self.assertFalse(hasattr(request, "video_script_prompt"))
        self.assertFalse(hasattr(request, "custom_system_prompt"))

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

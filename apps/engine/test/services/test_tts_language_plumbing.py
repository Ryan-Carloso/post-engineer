"""The job's video language must reach TTS.

Regression: ``generate_audio`` never passed ``params.video_language`` to
``voice.tts``, so the Edge TTS fallback (test accounts) had no language to
pick a voice from and always used the pt-BR default — an English video was
read aloud with a Portuguese voice.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models.schema import VideoParams
from app.services import task as tm
from app.services.voice_providers import TtsResult


class TestGenerateAudioForwardsLanguage(unittest.TestCase):
    def test_video_language_reaches_voice_tts(self):
        params = VideoParams(
            video_subject="Port wine cellars",
            video_language="en",
            voice_name="chatterbox:en_us_male_01",
        )
        ok_result = TtsResult(sub_maker=MagicMock())
        with (
            patch.object(tm.sm.state, "get_task", return_value={"user_id": "u1"}),
            patch.object(tm.voice, "tts", return_value=ok_result) as mock_tts,
            patch.object(tm.voice, "get_audio_duration", return_value=5),
        ):
            audio_file, audio_duration, _sub_maker = tm.generate_audio(
                "task-lang", params, "An English script about Porto."
            )

        self.assertIsNotNone(audio_file)
        self.assertEqual(audio_duration, 5)
        self.assertEqual(mock_tts.call_args.kwargs.get("language"), "en")


if __name__ == "__main__":
    unittest.main()

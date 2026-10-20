import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.cloned_voices.audio import (
    ReferenceAudioError,
    normalize_reference_audio,
)
from app.services.cloned_voices.constants import ERROR_AUDIO_TOO_LONG


class ClonedVoiceAudioTests(unittest.TestCase):
    def test_rejects_empty_bytes(self):
        with self.assertRaises(ReferenceAudioError) as ctx:
            normalize_reference_audio(b"")
        self.assertEqual(ctx.exception.error_code, "invalid_audio")

    @patch("app.services.cloned_voices.audio.subprocess.run")
    def test_rejects_audio_over_duration_limit(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout='{"streams":[{"codec_type":"audio"}],"format":{"duration":"120"}}',
            stderr="",
        )

        with patch("pathlib.Path.is_file", return_value=True):
            with patch("pathlib.Path.read_bytes", return_value=b"wav"):
                with self.assertRaises(ReferenceAudioError) as ctx:
                    normalize_reference_audio(b"not-empty")
        self.assertEqual(ctx.exception.error_code, ERROR_AUDIO_TOO_LONG)

import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.cloned_voices.audio import (
    DENOISE_FILTER,
    ReferenceAudioError,
    normalize_reference_audio,
)
from app.services.cloned_voices.constants import ERROR_AUDIO_TOO_LONG


class ClonedVoiceAudioTests(unittest.TestCase):
    def test_rejects_empty_bytes(self):
        with self.assertRaises(ReferenceAudioError) as ctx:
            normalize_reference_audio(b"", denoise=False)
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
                    normalize_reference_audio(b"not-empty", denoise=False)
        self.assertEqual(ctx.exception.error_code, ERROR_AUDIO_TOO_LONG)

    def test_over_duration_source_is_rejected_before_any_ffmpeg_pass(self):
        # The denoise filter chain is CPU-heavy: an over-long upload must be
        # rejected from the cheap source probe, not after the full pass.
        calls = []

        def fake_run(args, **_kwargs):
            calls.append(args)
            return subprocess.CompletedProcess(
                args=args,
                returncode=0,
                stdout='{"streams":[{"codec_type":"audio"}],"format":{"duration":"120"}}',
                stderr="",
            )

        with patch("app.services.cloned_voices.audio.subprocess.run", side_effect=fake_run):
            with self.assertRaises(ReferenceAudioError) as ctx:
                normalize_reference_audio(b"not-empty", denoise=True)
        self.assertEqual(ctx.exception.error_code, ERROR_AUDIO_TOO_LONG)
        self.assertFalse([args for args in calls if args[0] == "ffmpeg"])

    def _ffmpeg_args(self, denoise):
        calls = []

        def fake_run(args, **_kwargs):
            calls.append(args)
            if args[0] == "ffprobe":
                return subprocess.CompletedProcess(
                    args=args, returncode=0, stdout='{"streams":[{"codec_type":"audio"}],"format":{"duration":"12"}}', stderr=""
                )
            return subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")

        with patch("app.services.cloned_voices.audio.subprocess.run", side_effect=fake_run):
            with patch("pathlib.Path.is_file", return_value=True):
                with patch("pathlib.Path.read_bytes", return_value=b"wav"):
                    result = normalize_reference_audio(b"not-empty", denoise=denoise)
        self.assertEqual(result.wav_bytes, b"wav")
        return next(args for args in calls if args[0] == "ffmpeg")

    def test_denoise_adds_the_cleanup_filter_chain(self):
        args = self._ffmpeg_args(denoise=True)
        self.assertIn("-af", args)
        self.assertEqual(args[args.index("-af") + 1], DENOISE_FILTER)

    def test_without_denoise_the_audio_is_only_resampled(self):
        args = self._ffmpeg_args(denoise=False)
        self.assertNotIn("-af", args)
        self.assertIn("24000", args)


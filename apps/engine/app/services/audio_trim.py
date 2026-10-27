"""Cut trailing silence off a generated voiceover.

The final video is cut to the audio file's length, so a TTS file that ends
with seconds of silence (seen with Chatterbox: ~6s) leaves the visuals
playing over nothing after the call to action. The silence after the last
spoken word is cut, keeping KEEP_SECONDS of breath. Best effort: any
failure keeps the original file and never fails the task.
"""

import os
import re
import subprocess
from collections.abc import Sequence
from typing import Optional

from loguru import logger

# Quieter than this, for at least SILENCE_MIN_SECONDS, counts as silence.
SILENCE_THRESHOLD_DB = -40
SILENCE_MIN_SECONDS = 0.5
# Breath kept after the trailing silence / after the last spoken word, and the
# shortest tail worth cutting.
KEEP_SECONDS = 0.4
KEEP_AFTER_WORD_SECONDS = 0.6
MIN_CUT_SECONDS = 1.0

_END_TOLERANCE_SECONDS = 0.05
_SILENCE_START = re.compile(r"silence_start:\s*([0-9.]+)")
_SILENCE_END = re.compile(r"silence_end:\s*([0-9.]+)")


def speech_end_seconds(silencedetect_log: str, duration: float) -> Optional[float]:
    """Start of the silence that runs to the end of the file, if any.

    Depending on the ffmpeg version, a silence lasting until the end of the
    input has no silence_end, or one at the file's duration.
    """
    starts = [float(m.group(1)) for m in _SILENCE_START.finditer(silencedetect_log)]
    ends = [float(m.group(1)) for m in _SILENCE_END.finditer(silencedetect_log)]
    if not starts:
        return None
    if len(starts) > len(ends) or ends[-1] >= duration - _END_TOLERANCE_SECONDS:
        return starts[-1]
    return None


def _duration(path: str) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def media_duration(path: str) -> float:
    """Length in seconds of any audio or video file (ffprobe)."""
    return _duration(path)


def _cut(audio_file: str, new_length: float) -> None:
    root, ext = os.path.splitext(audio_file)
    trimmed = f"{root}.trimmed{ext}"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", audio_file, "-t", f"{new_length:.3f}", trimmed],
        check=True,
        capture_output=True,
    )
    os.replace(trimmed, audio_file)


def trim_trailing_silence(audio_file: str) -> Optional[float]:
    """Cut the trailing silence in place; return the new length, or None if untouched."""
    try:
        detect = subprocess.run(
            [
                "ffmpeg", "-nostats", "-i", audio_file,
                "-af", f"silencedetect=n={SILENCE_THRESHOLD_DB}dB:d={SILENCE_MIN_SECONDS}",
                "-f", "null", "-",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        duration = _duration(audio_file)
        speech_end = speech_end_seconds(detect.stderr, duration)
        if speech_end is None or speech_end <= 0:
            logger.info(f"voiceover tail: no trailing silence in the {duration:.2f}s file")
            return None
        if duration - speech_end < MIN_CUT_SECONDS:
            logger.info(f"voiceover tail: silence after {speech_end:.2f}s is under {MIN_CUT_SECONDS:g}s; kept")
            return None
        new_length = speech_end + KEEP_SECONDS
        _cut(audio_file, new_length)
    except (subprocess.CalledProcessError, OSError, ValueError) as exc:
        logger.warning(f"trailing silence trim skipped for {os.path.basename(audio_file)}: {type(exc).__name__}")
        return None
    logger.info(f"voiceover tail: silence cut, audio now {new_length:.2f}s (was {duration:.2f}s)")
    return new_length


def trim_after_last_word(audio_file: str, words: Sequence[tuple[str, float, float]]) -> Optional[float]:
    """Cut the voiceover KEEP_AFTER_WORD_SECONDS after the last spoken word.

    `words` are the Whisper word boundaries (subtitle.file_to_words). Unlike
    the silence scan this does not depend on the tail's loudness: a TTS tail
    with noise or breath above the silence threshold survived it, and the
    video kept playing 3-4s past the last word. No words, or a tail under
    MIN_CUT_SECONDS, leaves the file alone.
    """
    if not words:
        return None
    last_end = max(end for _, _, end in words)
    try:
        duration = _duration(audio_file)
        new_length = last_end + KEEP_AFTER_WORD_SECONDS
        if duration - new_length < MIN_CUT_SECONDS:
            logger.info(f"voiceover tail: last word ends at {last_end:.2f}s of {duration:.2f}s; kept")
            return None
        _cut(audio_file, new_length)
    except (subprocess.CalledProcessError, OSError, ValueError) as exc:
        logger.warning(f"word-based trim skipped for {os.path.basename(audio_file)}: {type(exc).__name__}")
        return None
    logger.info(
        f"voiceover tail: last word ends at {last_end:.2f}s of {duration:.2f}s; cut to {new_length:.2f}s"
    )
    return new_length

"""Time the captions from the real speech, with the TTS estimate as fallback.

Whisper transcribes the narration and every caption is placed on the words
it heard. No TTS provider returns word times: the TTS timeline only spreads
the script over the audio by character share, which drifts by seconds
through the middle of a video. It is used only when Whisper leaves no
usable file, logged as an error, so a Whisper model that cannot load does
not ship a video without captions.
"""

import os
from os import path

from loguru import logger

from app.services import subtitle, subtitle_cleanup, voice
from app.utils import utils


def _has_cues(subtitle_path: str) -> bool:
    return bool(subtitle.file_to_subtitles(subtitle_path))


def _whisper(audio_file: str, video_script: str, subtitle_path: str) -> bool:
    try:
        subtitle.create(audio_file=audio_file, subtitle_file=subtitle_path)
        if not os.path.exists(subtitle_path):
            logger.error("whisper wrote no subtitle file")
            return False
        logger.info("\n\n## correcting subtitle")
        subtitle.correct(subtitle_file=subtitle_path, video_script=video_script)
    except Exception as exc:
        logger.error(f"whisper subtitle failed: {type(exc).__name__}: {exc}")
        return False
    return _has_cues(subtitle_path)


def _tts_estimate(sub_maker, video_script: str, subtitle_path: str) -> bool:
    voice.create_subtitle(text=video_script, sub_maker=sub_maker, subtitle_file=subtitle_path)
    return os.path.exists(subtitle_path) and _has_cues(subtitle_path)


def build_subtitle(task_id, params, video_script, sub_maker, audio_file) -> str:
    """Write `subtitle.srt` for the task; return its path, or "" when none.

    Returns "" when subtitles are off, when Whisper produced no cues and
    there is no TTS timeline to estimate from (custom audio), when the
    estimate produced no cues either, or when subtitle cleanup could not
    produce a cleaned file.
    """
    logger.info("\n\n## generating subtitle")
    if not params.subtitle_enabled:
        return ""

    subtitle_path = path.join(utils.task_dir(task_id), "subtitle.srt")
    ok = _whisper(audio_file, video_script, subtitle_path)
    if not ok and sub_maker is not None:
        logger.error("whisper produced no subtitle; falling back to the estimated TTS timeline")
        ok = _tts_estimate(sub_maker, video_script, subtitle_path)

    if not ok:
        logger.error("no subtitle cues: whisper failed and no TTS timeline could replace it")
        return ""
    if not subtitle_cleanup.clean_subtitle_file(subtitle_path):
        logger.error("subtitle cleanup failed; shipping no subtitles")
        return ""
    return subtitle_path

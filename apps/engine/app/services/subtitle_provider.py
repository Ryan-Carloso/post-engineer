"""Pick the subtitle provider and fall back between providers.

`whisper` times the cues from the real speech; `edge` spreads the script over
the TTS timeline (no TTS provider returns word times). Each is the fallback
of the other: a provider that leaves no usable file is logged as an error and
the other one is tried, so a Whisper model that cannot load does not ship a
video without captions.
"""

import os
from os import path

from loguru import logger

from app.config import config
from app.services import subtitle, voice
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


def _edge(sub_maker, video_script: str, subtitle_path: str) -> bool:
    voice.create_subtitle(
        text=video_script, sub_maker=sub_maker, subtitle_file=subtitle_path
    )
    return os.path.exists(subtitle_path) and _has_cues(subtitle_path)


def build_subtitle(task_id, params, video_script, sub_maker, audio_file) -> str:
    """Write `subtitle.srt` for the task; return its path, or "" when none.

    Returns "" when subtitles are off, when the provider needs a TTS timeline
    that custom audio does not have, or when no provider produced cues.
    """
    logger.info("\n\n## generating subtitle")
    if not params.subtitle_enabled:
        return ""

    subtitle_path = path.join(utils.task_dir(task_id), "subtitle.srt")
    provider = config.app.get("subtitle_provider", "edge").strip().lower()
    logger.info(f"\n\n## generating subtitle, provider: {provider}")

    if sub_maker is None and provider != "whisper":
        # Custom audio never goes through TTS, so there is no TTS timeline.
        # Only Whisper can transcribe subtitles directly from the audio file;
        # other providers are skipped rather than writing a wrong timeline.
        logger.warning(
            f"subtitle maker is missing, skip subtitle generation for provider: {provider}"
        )
        return ""

    ok = False
    if provider == "whisper":
        ok = _whisper(audio_file, video_script, subtitle_path)
        if not ok and sub_maker is not None:
            logger.error("whisper produced no subtitle; falling back to the TTS timeline")
            ok = _edge(sub_maker, video_script, subtitle_path)
    elif provider == "edge":
        ok = _edge(sub_maker, video_script, subtitle_path)
        if not ok:
            logger.warning("subtitle file not found, fallback to whisper")
            ok = _whisper(audio_file, video_script, subtitle_path)

    if not ok:
        logger.error(f"no subtitle provider produced cues (provider: {provider})")
        return ""
    return subtitle_path

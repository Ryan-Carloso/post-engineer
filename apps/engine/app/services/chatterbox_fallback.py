"""Edge-TTS fallback for the Chatterbox TTS provider.

Extracted from app/services/voice.py so that module stays under the
file-size ratchet cap (see .github/workflows/file-size.yml).
"""

from typing import Union

from edge_tts import SubMaker
from loguru import logger

from app.config import config

# Edge-tts voice used when the Chatterbox provider fails (fallback chain).
# Must exist in app/services/data/azure_voices.json; male pt-BR to match the
# first Chatterbox house voice ("ryan").
_DEFAULT_CHATTERBOX_FALLBACK_VOICE = "pt-BR-AntonioNeural"


def get_chatterbox_fallback_voice() -> str:
    """Return the edge-tts voice used when Chatterbox fails.

    Configured via ``[chatterbox] fallback_voice`` in config.toml. An empty
    value explicitly disables the fallback (Chatterbox failures then surface
    as normal TTS failures).
    """
    voice = str(
        config.chatterbox.get("fallback_voice", _DEFAULT_CHATTERBOX_FALLBACK_VOICE)
        or ""
    ).strip()
    return voice


def chatterbox_edge_tts_fallback(
    text: str, voice_rate: float, voice_file: str
) -> Union[SubMaker, None]:
    """Fall back to edge-tts after a Chatterbox failure.

    Keeps the pipeline producing audio during a Modal/Chatterbox outage at
    the cost of a different (non-cloned) voice. The provider switch is always
    logged so downstream quality complaints can be traced back to it.
    """
    # Imported here to avoid a circular import: app.services.voice imports
    # this module at load time.
    from app.services.voice import azure_tts_v1

    fallback_voice = get_chatterbox_fallback_voice()
    if not fallback_voice:
        logger.error(
            "chatterbox tts failed and fallback is disabled "
            "([chatterbox] fallback_voice is empty)"
        )
        return None
    logger.warning(
        f"chatterbox tts failed, falling back to edge-tts voice: {fallback_voice}"
    )
    return azure_tts_v1(text, fallback_voice, voice_rate, voice_file)


def chatterbox_tts_with_fallback(
    text: str,
    voice: str,
    voice_file: str,
    voice_rate: float = 1.0,
    voice_volume: float = 1.0,
) -> Union[SubMaker, None]:
    """Run Chatterbox TTS, falling back to edge-tts on recoverable failure.

    A Chatterbox failure (HTTP error, timeout, empty audio) degrades to a
    different (non-cloned) edge-tts voice instead of failing the whole video.
    """
    # Imported here to avoid a circular import: app.services.voice imports
    # this module at load time.
    from app.services.voice import chatterbox_tts

    sub_maker = chatterbox_tts(text, voice, voice_file, voice_rate, voice_volume)
    if sub_maker is not None:
        return sub_maker
    return chatterbox_edge_tts_fallback(text, voice_rate, voice_file)

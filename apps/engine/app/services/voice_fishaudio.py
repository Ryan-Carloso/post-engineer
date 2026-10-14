"""Fish Audio TTS provider.

Self-contained provider module: ``get_fishaudio_voices`` lists the caller's
own trained Fish Audio voice models, ``is_fishaudio_voice`` matches the
``fishaudio:<id>`` voice-name prefix, and ``fishaudio_tts`` synthesizes via
the hosted Fish Audio API (``POST https://api.fish.audio/v1/tts``).

It lives in its own module (rather than ``app.services.voice``) so the
voice dispatcher stays within the file-size ratchet. Shared helpers come
from the leaf module ``app.services.voice_common`` — no import cycles.
"""

from typing import TYPE_CHECKING, Union

import requests
from loguru import logger
from moviepy.audio.io.AudioFileClip import AudioFileClip

from app.config import config
from app.services.analytics import scrub_secret_values

if TYPE_CHECKING:
    # Only for annotations: SubMaker is pinned to app.services.voice (see
    # the local import inside fishaudio_tts), so this never runs at runtime.
    from app.services.voice import SubMaker
from app.services.voice_common import (
    ensure_file_path_exists,
    populate_legacy_submaker_with_full_text,
    preprocess_text_for_tts,
)


def get_fishaudio_voices(api_key: str) -> list[str]:
    """List the caller's own trained Fish Audio TTS voices.

    Voices are Fish Audio "models" of type "tts"; the ``_id`` is the
    ``reference_id`` the /v1/tts endpoint expects. Only ``trained`` models
    are listed — a voice still training cannot synthesize yet.
    """
    if not api_key:
        return []
    try:
        url = "https://api.fish.audio/model"
        params = {"self": "true", "page_size": 100, "page_number": 1}
        headers = {"Authorization": f"Bearer {api_key}"}
        response = requests.get(url, params=params, headers=headers, timeout=10)
        if response.status_code != 200:
            logger.warning(
                f"Fish Audio voices fetch failed with status {response.status_code}: {scrub_secret_values(response.text)[:200]}"
            )
            return []
        items = response.json().get("items", [])
        return [
            f"fishaudio:{v['_id']}:{v['title']}"
            for v in items
            if v.get("_id")
            and v.get("title")
            and v.get("type") == "tts"
            and v.get("state") == "trained"
        ]
    except Exception as e:
        logger.warning(f"Fish Audio voices fetch failed: {str(e)}")
        return []


def is_fishaudio_voice(voice_name: str) -> bool:
    return (voice_name or "").startswith("fishaudio:")


def fishaudio_tts(
    text: str,
    voice_id: str,
    voice_file: str,
    voice_rate: float = 1.0,
    voice_volume: float = 1.0,
    model_id: str = "",
) -> Union["SubMaker", None]:
    """Generate speech with the Fish Audio hosted TTS API.

    Fish Audio exposes TTS at POST /v1/tts with the synthesis model in a
    ``model`` header (``drama-3`` by default) and ``reference_id`` picking
    one of the caller's own trained voice models. Configure
    ``[fishaudio] api_key`` in config.toml.

    Like ElevenLabs and Chatterbox, Fish Audio returns no word-level
    timestamps, so the subtitle path falls back to the full-text SubMaker.
    For tighter subtitle sync set ``subtitle_provider = "whisper"``.
    """
    # Local import: SubMaker is pinned to app.services.voice by the
    # structural test test_submaker_is_a_local_class_not_the_edge_package,
    # and voice.py imports this module — a top-level import would be
    # circular. At call time voice.py is fully initialized.
    from app.services.voice import SubMaker
    text = (text or "").strip()
    if not text:
        logger.error("Fish Audio TTS text is empty")
        return None

    # Preprocess text to avoid TTS reading "ponto" ("period") in Portuguese
    text = preprocess_text_for_tts(text)
    api_key = config.fishaudio.get("api_key", "")
    if not api_key:
        logger.error("Fish Audio API key is not set")
        return None

    if not model_id:
        model_id = config.fishaudio.get("model_id", "drama-3")

    url = "https://api.fish.audio/v1/tts"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "model": model_id,
    }
    payload = {
        "text": text,
        "reference_id": voice_id,
        "format": "mp3",
        "mp3_bitrate": 128,
        "normalize": True,
        "latency": "normal",
    }
    # voice_rate / voice_volume are accepted for parity with the other TTS
    # providers but are intentionally not sent: the Fish Audio /v1/tts
    # contract has no speed or volume fields. Adjust loudness in
    # post-processing instead.

    # Errors where retrying will never help (auth/access/validation failures).
    _NON_RETRYABLE_CODES = {401, 403, 422}

    for i in range(3):
        try:
            logger.info(f"start fishaudio tts, voice_id: {voice_id}, try: {i + 1}")
            ensure_file_path_exists(voice_file)

            response = requests.post(url, json=payload, headers=headers, timeout=120)
            if response.status_code != 200:
                # Scrub before truncating: a cut landing mid-secret would
                # leave a fragment the scrubber can no longer match.
                error_text = scrub_secret_values(response.text)[:200]
                if response.status_code in _NON_RETRYABLE_CODES:
                    logger.error(
                        f"Fish Audio TTS failed (non-retryable) — voice_id: {voice_id}, "
                        f"status: {response.status_code}, error: {error_text}. "
                        "Please check the API key and the voice id."
                    )
                    return None
                logger.error(
                    f"fishaudio tts failed with status {response.status_code}: {error_text}"
                )
                continue

            with open(voice_file, "wb") as f:
                f.write(response.content)

            audio_clip = AudioFileClip(voice_file)
            audio_duration = audio_clip.duration
            audio_clip.close()

            sub_maker = SubMaker()
            logger.success(f"fishaudio tts succeeded: {voice_file}")
            return populate_legacy_submaker_with_full_text(
                sub_maker=sub_maker,
                text=text,
                audio_duration_seconds=audio_duration,
            )
        except Exception as e:
            logger.error(f"fishaudio tts failed: {str(e)}")

    return None

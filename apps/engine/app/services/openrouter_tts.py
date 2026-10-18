"""OpenRouter TTS provider for the engine.

OpenRouter (https://openrouter.ai) routes one API key to many hosted TTS
vendors (OpenAI, Gemini, Mistral, ElevenLabs, Grok, Azure, ...) behind a
single OpenAI-compatible endpoint: ``POST /api/v1/audio/speech``.

This lives in its own module (rather than ``voice_providers.py`` /
``voice.py``) so those files stay under the 500-line file-size cap: the
provider implementation, the voice-catalog discovery and the voice-id
parsing are all OpenRouter-specific. ``voice.py`` keeps only a thin
``dispatch_openrouter_tts`` call in its ``tts()`` dispatcher, and
``persona.py`` reads the catalog through ``get_openrouter_voices``.
"""

import requests
from loguru import logger
from moviepy.audio.io.AudioFileClip import AudioFileClip

from app.config import config
from app.services.analytics import scrub_secret_values
from app.services.voice_providers import (
    SubMaker,
    TtsResult,
    _preprocess_text_for_tts,
    ensure_file_path_exists,
    populate_legacy_submaker_with_full_text,
)

# OpenRouter endpoints. Both are hard infrastructure names: the engine talks to
# the public OpenRouter API and nowhere else, so a different base would mean a
# different provider entirely rather than a config tweak.
OPENROUTER_SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech"
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

# Voice ids are provider-qualified; `voice.tts` routes on this prefix.
# Format: `openrouter:<model>:<voice>` -- OpenRouter voices are per-model, so
# the id carries both halves.
OPENROUTER_VOICE_PREFIX = "openrouter:"


def is_openrouter_voice(voice_name: str | None) -> bool:
    return (voice_name or "").startswith(OPENROUTER_VOICE_PREFIX)


def parse_openrouter_voice(voice_name: str) -> tuple[str, str] | None:
    """Split ``openrouter:<model>:<voice>`` into its two halves.

    The FIRST colon after the provider prefix separates the model from the
    voice. That is forced by the catalog: 202 of the ~824 speech voices carry a
    colon of their own (Azure voice ids put the model in a suffix, e.g.
    ``en-US-Harper:MAI-Voice-2.1``), so a last-colon split would corrupt every
    one of them.

    The trade-off is a model id containing a colon, which is only OpenRouter's
    ``:free`` router variant. None of those models publish ``supported_voices``,
    so they never reach the picker. Returns ``None`` when either half is missing.
    """
    if not is_openrouter_voice(voice_name):
        return None
    remainder = voice_name[len(OPENROUTER_VOICE_PREFIX):]
    model, separator, voice = remainder.partition(":")
    if not separator or not model.strip() or not voice.strip():
        return None
    return model.strip(), voice.strip()


def _configured_openrouter_models() -> list[str]:
    """The model ids the operator opted into, normalised.

    Accepts a TOML array or a comma-separated string (same tolerance as
    ``[chatterbox] voices``). An empty list means the provider is not
    configured, which is what keeps it out of the picker.
    """
    models = config.openrouter.get("models", []) or []
    if isinstance(models, str):
        models = [part.strip() for part in models.split(",") if part.strip()]
    result: list[str] = []
    for model in models:
        cleaned = str(model).strip()
        if cleaned and cleaned not in result:
            result.append(cleaned)
    return result


# Discovered catalogs, keyed by (api_key, models) so a config change is a new
# key rather than a stale answer. That also means tests need no reset hook.
_openrouter_voice_cache: dict[tuple[str, tuple[str, ...]], list[str]] = {}


def get_openrouter_voices() -> list[str]:
    """Discover the OpenRouter voices offered to the UI.

    Returns provider-qualified ids (``openrouter:<model>:<voice>``) for the
    models under ``[openrouter] models``, fetched from the models API. Two
    deliberate bounds:

    * the models are the operator's choice. OpenRouter's speech catalog is 35
      models and ~824 model/voice pairs, which no picker should render -- and
      the models differ in price, language coverage and capability, so the
      engine must not pick one on the operator's behalf;
    * an unconfigured provider (no key, or no models) returns ``[]`` and makes
      no network call at all, which is what keeps it out of the catalog
      entirely.

    A model with ``supported_voices: null`` (the voice-cloning and prompt-driven
    ones) is skipped with a warning: it has no voice list to offer, though it
    stays reachable by passing its id directly.
    """
    api_key = config.openrouter.get("api_key", "") or ""
    models = _configured_openrouter_models()
    if not api_key or not models:
        return []

    cache_key = (api_key, tuple(models))
    cached = _openrouter_voice_cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        response = requests.get(
            OPENROUTER_MODELS_URL,
            # Without this filter the payload is every OpenRouter model.
            params={"output_modalities": "speech"},
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15,
        )
        if response.status_code != 200:
            logger.warning(
                f"OpenRouter voices fetch failed with status {response.status_code}: "
                # Scrub: an upstream HTTP error can echo the rejected key back.
                f"{scrub_secret_values(response.text)[:200]}"
            )
            return []
        payload = response.json()
    except Exception as e:
        # Scrub: the exception string can carry the key (e.g. a proxy or TLS
        # error echoing the Authorization header).
        logger.warning(f"OpenRouter voices fetch failed: {scrub_secret_values(str(e))}")
        return []

    entries = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        logger.warning("OpenRouter voices fetch returned an unexpected payload shape")
        return []

    # Index model id -> voices, narrowing every entry: one malformed model must
    # not discard the real voices beside it.
    voices_by_model: dict[str, list[str]] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        model_id = entry.get("id")
        supported = entry.get("supported_voices")
        if not isinstance(model_id, str) or not model_id.strip():
            continue
        if not isinstance(supported, list):
            continue
        cleaned = [
            str(voice).strip()
            for voice in supported
            if isinstance(voice, str) and voice.strip()
        ]
        # Preserve order, drop duplicates.
        voices_by_model[model_id] = list(dict.fromkeys(cleaned))

    voices: list[str] = []
    for model in models:
        model_voices = voices_by_model.get(model)
        if not model_voices:
            # A typo'd id is far likelier than a model that genuinely lists no
            # voices, and a silently empty picker hides the typo.
            logger.warning(
                f"OpenRouter model {model!r} is not a speech model with voices; "
                "check [openrouter] models in config.toml"
            )
            continue
        voices.extend(
            f"{OPENROUTER_VOICE_PREFIX}{model}:{voice}" for voice in model_voices
        )

    _openrouter_voice_cache[cache_key] = voices
    return voices


def openrouter_tts(
    text: str,
    model: str,
    voice: str,
    voice_file: str,
    voice_rate: float = 1.0,
    voice_volume: float = 1.0,
) -> TtsResult:
    """Generate speech through OpenRouter's OpenAI-compatible speech API.

    OpenRouter routes one ``OPENROUTER_API_KEY`` to many hosted TTS vendors
    (OpenAI, Gemini, Mistral, ElevenLabs, Grok, ...) behind a single
    ``POST /api/v1/audio/speech`` endpoint that is wire-compatible with the
    OpenAI Audio Speech API.

    Both ``model`` and ``voice`` are required because OpenRouter voices are
    per-model: ``alloy`` is an OpenAI voice and ``Kore`` a Gemini one, so a
    voice name alone cannot address a model. That is why the voice id
    carries both (``openrouter:<model>:<voice>``).

    Like the other providers, no word-level timestamps come back, so the
    subtitle path falls back to the full-text SubMaker.

    Args:
        text: the script to speak.
        model: OpenRouter model id, e.g. ``x-ai/grok-voice-tts-1.0``.
        voice: a voice the selected model supports.
        voice_file: destination path for the synthesized audio.
        voice_rate: playback-speed multiplier. Only sent when it differs from
            1.0 -- OpenRouter returns a 400 for a non-default ``speed`` on a
            model with no speed control, and the models API reports an empty
            ``supported_parameters`` for every speech model, so there is no
            way to know in advance which ones honour it.
        voice_volume: accepted for parity with the other providers and
            intentionally not sent; the speech API has no volume field.

    Returns:
        TtsResult carrying the subtitle timeline, or a sanitized error.
    """
    text = (text or "").strip()
    if not text:
        logger.error("OpenRouter TTS text is empty")
        return TtsResult(error="OpenRouter TTS failed: text is empty")

    text = _preprocess_text_for_tts(text)
    api_key = config.openrouter.get("api_key", "")
    if not api_key:
        logger.error("OpenRouter API key is not set")
        return TtsResult(error="OpenRouter TTS failed: API key is not set")

    payload = {
        "model": model,
        "input": text,
        "voice": voice,
        "response_format": "mp3",
    }
    if float(voice_rate or 1.0) != 1.0:
        payload["speed"] = float(voice_rate)

    # Errors where retrying will never help: the model rejected the voice or
    # the input, the key is wrong, or the model/voice does not exist. Retrying
    # spends three requests to reach the same answer.
    _NON_RETRYABLE_CODES = {400, 401, 403, 404, 422}

    last_error: str | None = None
    for i in range(3):
        try:
            logger.info(
                f"start openrouter tts, model: {model}, voice: {voice}, try: {i + 1}"
            )
            ensure_file_path_exists(voice_file)

            response = requests.post(
                OPENROUTER_SPEECH_URL,
                json=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                timeout=120,
            )
            if response.status_code != 200:
                if response.status_code in _NON_RETRYABLE_CODES:
                    reason = (
                        f"OpenRouter TTS request rejected (status {response.status_code}): "
                        # Scrub before the 200-cut: a cut landing mid-secret
                        # defeats the scrubber and leaks the raw remainder.
                        f"{scrub_secret_values(response.text)[:200]}"
                    )
                    logger.error(
                        f"openrouter tts rejected (non-retryable) — model: {model}, "
                        f"voice: {voice}, status: {response.status_code}. "
                        "Please select a different OpenRouter voice."
                    )
                    return TtsResult(error=reason)

                last_error = f"status {response.status_code}"
                logger.error(
                    f"openrouter tts failed with status {response.status_code}: "
                    f"{scrub_secret_values(response.text)[:200]}"
                )
                continue

            with open(voice_file, "wb") as f:
                f.write(response.content)

            audio_clip = AudioFileClip(voice_file)
            audio_duration = audio_clip.duration
            audio_clip.close()

            sub_maker = SubMaker()
            logger.success(f"openrouter tts succeeded: {voice_file}")
            return TtsResult(
                sub_maker=populate_legacy_submaker_with_full_text(
                    sub_maker=sub_maker,
                    text=text,
                    audio_duration_seconds=audio_duration,
                )
            )
        except Exception as e:
            # Scrub before the 200-cut: a cut landing mid-secret defeats the
            # scrubber and leaks the raw remainder. The log line is scrubbed
            # too: the exception string can carry the key.
            last_error = scrub_secret_values(str(e))[:200]
            logger.error(f"openrouter tts failed: {scrub_secret_values(str(e))}")

    return TtsResult(
        error=f"OpenRouter TTS failed after 3 attempts ({last_error or 'unknown error'})"
    )


def dispatch_openrouter_tts(
    voice_name: str | None,
    text: str,
    voice_file: str,
    voice_rate: float = 1.0,
    voice_volume: float = 1.0,
) -> TtsResult | None:
    """Route an OpenRouter voice id to ``openrouter_tts``.

    Returns ``None`` when the id names no OpenRouter voice, so ``voice.tts``
    falls through to the next provider branch. The id parse and the
    invalid-format error live here so ``voice.py``'s dispatcher stays thin
    (and under the file-size cap).
    """
    if not is_openrouter_voice(voice_name):
        return None
    # Format: openrouter:<model>:<voice>. The model is part of the id
    # because OpenRouter voices are per-model.
    parsed = parse_openrouter_voice(voice_name)
    if parsed is None:
        logger.error(f"Invalid openrouter voice name format: {voice_name}")
        return TtsResult(
            error=(
                "invalid OpenRouter voice name (expected "
                "'openrouter:<model>:<voice>')"
            )
        )
    model, openrouter_voice = parsed
    return openrouter_tts(
        text, model, openrouter_voice, voice_file, voice_rate, voice_volume
    )

"""Microsoft Edge TTS provider — free fallback for test accounts.

Edge TTS is the text-to-speech backend behind Microsoft Edge's Read Aloud
feature. It is free, requires no API key, and supports 100+ locales
(including ``pt-BR`` and ``pt-PT``).

This provider exists as an automatic safety net: when the primary TTS
provider (Chatterbox, hosted on Modal) is unavailable — e.g. Modal credits
exhausted, which surfaces as HTTP 404 — test accounts fall back to Edge TTS
instead of failing the whole video generation.

Deliberately NOT exposed in the UI: this is an invisible fallback, not a
provider choice. The voice follows the video's language (see
``_resolve_voice``): a known language always wins — an English video must
never be read by a Portuguese voice. ``EDGE_TTS_VOICE`` (default
``pt-BR-FranciscaNeural``) only applies when the language is missing or
unknown; test accounts via ``TEST_ACCOUNT_USER_IDS`` (comma-separated
user IDs).

Like the other providers, Edge TTS returns no word-level timestamps, so the
subtitle path falls back to the full-text SubMaker.
"""

import asyncio
import os
import unicodedata

from loguru import logger
from moviepy.audio.io.AudioFileClip import AudioFileClip

from app.services.analytics import scrub_error_text, track_event
from app.services.voice_providers import (
    SubMaker,
    TtsResult,
    chatterbox_tts,
    ensure_file_path_exists,
    populate_legacy_submaker_with_full_text,
)

# Default voice when EDGE_TTS_VOICE is unset. Brazilian Portuguese, female —
# matches the operator's primary locale. Override per deployment via env.
DEFAULT_EDGE_TTS_VOICE = "pt-BR-FranciscaNeural"

# Edge TTS voice per locale (female Neural voices, matching the gender of
# the pt-BR default). Keyed by normalized BCP-47 locale; the base-language
# map below picks each language's default locale for bare codes ("en").
_EDGE_VOICE_BY_LOCALE: dict[str, str] = {
    "pt-br": "pt-BR-FranciscaNeural",
    "pt-pt": "pt-PT-RaquelNeural",
    "en-us": "en-US-AriaNeural",
    "en-gb": "en-GB-SoniaNeural",
    "es-es": "es-ES-ElviraNeural",
    "es-mx": "es-MX-DaliaNeural",
    "fr-fr": "fr-FR-DeniseNeural",
    "de-de": "de-DE-KatjaNeural",
    "it-it": "it-IT-ElsaNeural",
    "nl-nl": "nl-NL-ColetteNeural",
    "hi-in": "hi-IN-SwaraNeural",
    "ja-jp": "ja-JP-NanamiNeural",
    "ko-kr": "ko-KR-SunHiNeural",
    "zh-cn": "zh-CN-XiaoxiaoNeural",
    "ru-ru": "ru-RU-SvetlanaNeural",
    "pl-pl": "pl-PL-AgnieszkaNeural",
    "tr-tr": "tr-TR-EmelNeural",
    "id-id": "id-ID-GadisNeural",
    "uk-ua": "uk-UA-PolinaNeural",
    "sv-se": "sv-SE-SofieNeural",
}

# Base language -> default locale, for bare codes and regional variants
# without their own entry above (e.g. "en-au" reads with the US voice).
_EDGE_DEFAULT_LOCALE_BY_BASE: dict[str, str] = {
    "pt": "pt-br",
    "en": "en-us",
    "es": "es-es",
    "fr": "fr-fr",
    "de": "de-de",
    "it": "it-it",
    "nl": "nl-nl",
    "hi": "hi-in",
    "ja": "ja-jp",
    "ko": "ko-kr",
    "zh": "zh-cn",
    "ru": "ru-ru",
    "pl": "pl-pl",
    "tr": "tr-tr",
    "id": "id-id",
    "uk": "uk-ua",
    "sv": "sv-se",
}

# Personas may store a language name instead of a code ("English"); the
# script prompt accepts either, so voice selection must too.
_EDGE_BASE_BY_LANGUAGE_NAME: dict[str, str] = {
    "portuguese": "pt",
    "portugues": "pt",
    "english": "en",
    "spanish": "es",
    "espanol": "es",
    "french": "fr",
    "francais": "fr",
    "german": "de",
    "deutsch": "de",
    "italian": "it",
    "italiano": "it",
    "dutch": "nl",
    "nederlands": "nl",
    "hindi": "hi",
    "japanese": "ja",
    "korean": "ko",
    "chinese": "zh",
    "russian": "ru",
    "polish": "pl",
    "turkish": "tr",
    "indonesian": "id",
    "ukrainian": "uk",
    "swedish": "sv",
    # Native-script names: resolved before the ASCII fold below, which
    # would otherwise erase them entirely.
    "русский": "ru",
    "中文": "zh",
    "日本語": "ja",
    "한국어": "ko",
    "हिन्दी": "hi",
}


def is_test_account(user_id: str | None) -> bool:
    """Whether the user is a designated test account.

    Test accounts are listed in the ``TEST_ACCOUNT_USER_IDS`` env var as
    comma-separated user IDs. Only test accounts get the free Edge TTS
    fallback — production traffic must never silently switch voices.
    """
    if not user_id:
        return False
    raw = os.environ.get("TEST_ACCOUNT_USER_IDS", "")
    allowed = {part.strip() for part in raw.split(",") if part.strip()}
    return user_id in allowed


def _voice_for_language(language: str | None) -> str | None:
    """Edge TTS voice for a video language, or None when unknown.

    Accepts BCP-47 codes in any case/underscore form ("en", "en-US",
    "EN_gb", "pt-PT") and plain language names ("English"). Returning
    None lets the caller fall back to the deployment's configured voice.
    """
    raw = (language or "").strip().lower().replace("_", "-")
    # Native-script names ("русский", "中文") vanish under the ASCII fold
    # below, so resolve them first.
    native_base = _EDGE_BASE_BY_LANGUAGE_NAME.get(raw)
    if native_base is not None:
        locale = _EDGE_DEFAULT_LOCALE_BY_BASE.get(native_base)
        return _EDGE_VOICE_BY_LOCALE.get(locale) if locale else None
    # Drop diacritics so accented names match too ("português", "español").
    raw = unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode()
    if not raw or raw == "auto":
        return None
    if raw in _EDGE_VOICE_BY_LOCALE:
        return _EDGE_VOICE_BY_LOCALE[raw]
    base = raw.split("-", 1)[0]
    base = _EDGE_BASE_BY_LANGUAGE_NAME.get(base, base)
    locale = _EDGE_DEFAULT_LOCALE_BY_BASE.get(base)
    return _EDGE_VOICE_BY_LOCALE.get(locale) if locale else None


def _resolve_voice(language: str | None = None) -> str:
    """Edge TTS voice name for a video.

    The video's language wins when it maps to a voice: a single
    deployment-wide voice can never match multilingual content (the
    English flight read by the pt-BR voice). ``EDGE_TTS_VOICE`` and the
    built-in default only apply when the language is missing or unknown.
    """
    return (
        _voice_for_language(language)
        or os.environ.get("EDGE_TTS_VOICE", "").strip()
        or DEFAULT_EDGE_TTS_VOICE
    )


def _run_edge_tts(text: str, voice: str, voice_file: str) -> None:
    """Run the async edge-tts Communicate call to completion.

    Split out so tests can patch the network boundary without touching
    asyncio.
    """
    import edge_tts

    async def _synthesize() -> None:
        communicate = edge_tts.Communicate(text, voice)
        await communicate.save(voice_file)

    asyncio.run(_synthesize())


def edge_tts(
    text: str,
    voice_file: str,
    voice_rate: float = 1.0,
    voice_volume: float = 1.0,  # noqa: ARG001 — parity with other providers
    language: str | None = None,
) -> TtsResult:
    """Generate speech with Microsoft Edge TTS (free, no API key).

    Args:
        text: the script to speak.
        voice_file: destination path for the synthesized audio (mp3).
        voice_rate: playback-speed multiplier, applied via SSML prosody.
        voice_volume: accepted for parity with the other TTS providers but
            intentionally not sent; volume is a post-processing concern.
        language: the video's language; selects the voice (see
            ``_resolve_voice``).

    Returns:
        TtsResult carrying the subtitle timeline, or a sanitized error.
    """
    text = (text or "").strip()
    if not text:
        logger.error("Edge TTS text is empty")
        return TtsResult(error="Edge TTS failed: text is empty")

    voice = _resolve_voice(language)
    try:
        logger.info(f"start edge tts, voice: {voice}")
        ensure_file_path_exists(voice_file)
        _run_edge_tts(text, voice, voice_file)

        audio_clip = AudioFileClip(voice_file)
        audio_duration = audio_clip.duration
        audio_clip.close()

        sub_maker = SubMaker()
        logger.success(f"edge tts succeeded: {voice_file}")
        return TtsResult(
            sub_maker=populate_legacy_submaker_with_full_text(
                sub_maker=sub_maker,
                text=text,
                audio_duration_seconds=audio_duration,
            )
        )
    except Exception as e:
        logger.error(f"edge tts failed: {e}")
        return TtsResult(error=f"Edge TTS failed: {str(e)[:200]}")


def maybe_fallback_to_edge_tts(
    primary_error: str,
    *,
    text: str,
    voice_file: str,
    voice_rate: float,
    user_id: str | None,
    task_id: str | None = None,
    language: str | None = None,
) -> TtsResult | None:
    """Try Edge TTS after the primary provider failed, for test accounts.

    Returns the Edge TTS result when the fallback ran, or None when the
    fallback does not apply (not a test account). Emits a PostHog
    ``tts_fallback_used`` event — ids and reason only, never audio text —
    so silent voice switches stay observable.
    """
    if not is_test_account(user_id):
        return None
    logger.warning(
        "primary TTS failed for test account, falling back to Edge TTS "
        f"(primary error: {primary_error[:120]})"
    )
    track_event(
        "tts_fallback_used",
        {
            "from_provider": "chatterbox",
            "to_provider": "edge_tts",
            "reason": scrub_error_text(primary_error, max_chars=200),
            "task_id": task_id,
            "user_id": user_id,
            "language": language,
            "voice": _resolve_voice(language),
        },
        immediate=True,
    )
    return edge_tts(text, voice_file, voice_rate, language=language)


def chatterbox_tts_with_fallback(
    text: str,
    voice: str,
    voice_file: str,
    voice_rate: float = 1.0,
    voice_volume: float = 1.0,
    user_id: str | None = None,
    task_id: str | None = None,
    language: str | None = None,
) -> TtsResult:
    """Chatterbox TTS with Edge TTS fallback for test accounts.

    Chatterbox runs on Modal; exhausted credits (HTTP 404) or outages must
    not kill test generations. On failure, test accounts (see
    ``TEST_ACCOUNT_USER_IDS``) transparently retry with the free Edge TTS
    provider; production keeps the loud Chatterbox failure.
    """
    result = chatterbox_tts(text, voice, voice_file, voice_rate, voice_volume)
    # A non-TtsResult (e.g. a test marker) is treated as success.
    if getattr(result, "ok", True):
        return result
    fallback = maybe_fallback_to_edge_tts(
        getattr(result, "error", None) or "unknown Chatterbox failure",
        text=text,
        voice_file=voice_file,
        voice_rate=voice_rate,
        user_id=user_id,
        task_id=task_id,
        language=language,
    )
    return fallback if fallback is not None else result

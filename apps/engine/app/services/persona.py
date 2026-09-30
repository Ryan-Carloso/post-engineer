"""Persona payload validation — stateless.

The service does NOT persist anything: personas live in the caller's
database (Supabase). This module only validates and normalizes the
persona payload that arrives inline on a video job.
"""

import os
import tempfile
from typing import Any, Optional

from loguru import logger

from app.services.task import HOUSE_VOICE_NAMES
from app.services import voice as voice_service

# Short Instagram/TikTok-style video hook used for the house voice
# preview samples, per language: hook question, then the pitch.
VOICE_SAMPLE_TEXTS: dict[str, str] = {
    "pt": "Seu vídeo precisa de narração? Essa é a voz. "
    "Pronta pra usar, direto no seu próximo post.",
    "en-us": "Your video needs a voiceover? This is it. "
    "Ready to drop straight into your next post.",
    "en-uk": "Need a voiceover for your video? This is the one. "
    "Ready for your next post.",
    "es": "¿Tu video necesita narración? Esta es la voz. "
    "Lista para usar en tu próximo post.",
    "fr": "Ta vidéo a besoin d'une voix off ? La voilà. "
    "Prête pour ton prochain post.",
}

# Sample languages exposed to the UI.
SAMPLE_LANGUAGE_VOICES: dict[str, dict[str, str]] = {
    "pt": {"label": "Português (BR)"},
    "en-us": {"label": "English (US)"},
    "en-uk": {"label": "English (UK)"},
    "es": {"label": "Español"},
    "fr": {"label": "Français"},
}

# Per-persona sample config: each house voice gets its OWN edge-tts voice
# per language (when more than one exists for the gender/accent) plus a
# rate that matches its personality (calm = slower, energetic = faster).
# Voices must exist in app/services/data/azure_voices.json.
PERSONA_SAMPLE_VOICES: dict[str, dict[str, str]] = {
    "calm": {
        "pt": "pt-BR-FranciscaNeural",
        "en-us": "en-US-JennyNeural",
        "en-uk": "en-GB-SoniaNeural",
        "es": "es-ES-ElviraNeural",
        "fr": "fr-FR-DeniseNeural",
    },
    "young": {
        "pt": "pt-BR-ThalitaMultilingualNeural",
        "en-us": "en-US-AriaNeural",
        "en-uk": "en-GB-LibbyNeural",
        "es": "es-ES-XimenaNeural",
        "fr": "fr-FR-EloiseNeural",
    },
    "energetic": {
        "pt": "pt-BR-AntonioNeural",
        "en-us": "en-US-GuyNeural",
        "en-uk": "en-GB-RyanNeural",
        "es": "es-ES-AlvaroNeural",
        "fr": "fr-FR-HenriNeural",
    },
    "deep": {
        "pt": "pt-BR-AntonioNeural",
        "en-us": "en-US-EricNeural",
        "en-uk": "en-GB-ThomasNeural",
        "es": "es-ES-AlvaroNeural",
        "fr": "fr-FR-HenriNeural",
    },
}

# Rate (speed multiplier) and pitch matching each house voice personality.
# deep is "low/deep": pitch lowered so it sounds distinct from energetic when
# the two share a locale's only male voice.
HOUSE_VOICE_STYLES: dict[str, dict[str, str | float]] = {
    "calm": {"rate": 0.85, "pitch": "+0Hz"},
    "energetic": {"rate": 1.2, "pitch": "+5Hz"},
    "young": {"rate": 1.0, "pitch": "+0Hz"},
    "deep": {"rate": 1.4, "pitch": "-5Hz"},
}

# Cache of already synthesized samples: (voice_id, language) -> mp3 bytes.
_voice_sample_cache: dict[tuple[str, str], bytes] = {}

# House voices (mock catalog — replace with real TTS voices later)
# Voice ids are stable descriptor codes that the web UI translates
# through its i18n dictionaries (calm, energetic, young, deep).
HOUSE_VOICES = [
    {"id": "calm"},
    {"id": "energetic"},
    {"id": "young"},
    {"id": "deep"},
]

# video_language -> sample language: resolve house voice ids used directly
# in voice_name (faceless/debug flow and direct API callers, without an
# inline persona) to the Neural voice for the video's language.
HOUSE_VOICE_LANGUAGE_ALIASES: dict[str, str] = {
    "pt": "pt",
    "pt-br": "pt",
    "pt_br": "pt",
    "en": "en-us",
    "en-us": "en-us",
    "en_us": "en-us",
    "en-gb": "en-uk",
    "en-uk": "en-uk",
    "en_uk": "en-uk",
    "es": "es",
    "es-es": "es",
    "fr": "fr",
    "fr-fr": "fr",
}


def is_house_voice_id(voice_name: str | None) -> bool:
    """True when voice_name is a house voice id (calm/energetic/...)."""
    return (voice_name or "").strip().lower() in {v["id"] for v in HOUSE_VOICES}


def resolve_house_voice_name(voice_name: str, language: str | None) -> str:
    """Resolve a house voice id to the Neural voice for the video's language.

    Already qualified names (e.g. ``pt-BR-FranciscaNeural``) pass through
    unchanged. Unknown/missing language falls back to the legacy en-US map
    (HOUSE_VOICE_NAMES); if that map doesn't have the id either, returns
    the original name.
    """
    voice_id = (voice_name or "").strip().lower()
    if not is_house_voice_id(voice_id):
        return voice_name
    lang_key = HOUSE_VOICE_LANGUAGE_ALIASES.get((language or "").strip().lower(), "")
    if lang_key:
        try:
            return str(sample_config_for(voice_id, lang_key)["voice"])
        except PersonaValidationError:
            pass
    return HOUSE_VOICE_NAMES.get(voice_id, voice_name)


class PersonaValidationError(Exception):
    """Raised when the persona payload is missing or invalid."""


def get_house_voices() -> list[dict[str, Any]]:
    return list(HOUSE_VOICES)


def get_sample_languages() -> list[dict[str, str]]:
    return [
        {"code": code, "label": spec["label"]}
        for code, spec in SAMPLE_LANGUAGE_VOICES.items()
    ]


def sample_config_for(voice_id: str, language: str) -> dict[str, Any]:
    """Return the sample config (voice + rate) for a house voice/language.

    Each house voice has its own edge-tts voice and personality rate, so
    calm and energetic sound distinct from each other.
    """
    persona_voices = PERSONA_SAMPLE_VOICES.get(voice_id) or {}
    voice = persona_voices.get(language)
    if not voice:
        raise PersonaValidationError(
            f"no sample voice configured for {voice_id}/{language}"
        )
    return {
        "voice": voice,
        "rate": HOUSE_VOICE_STYLES[voice_id]["rate"],
        "pitch": HOUSE_VOICE_STYLES[voice_id]["pitch"],
    }


def synthesize_voice_sample(voice_id: str, language: str = "pt") -> Optional[bytes]:
    """Return a short TTS sample for a house voice in the given language.

    Samples are synthesized once and cached in memory: repeated requests
    for the same (voice, language) pair reuse the same audio bytes.
    Raises PersonaValidationError for unknown house voice ids or
    unsupported languages.
    """
    voice_name = HOUSE_VOICE_NAMES.get(voice_id)
    if not voice_name:
        raise PersonaValidationError(f"unknown house voice: {voice_id}")

    language_spec = SAMPLE_LANGUAGE_VOICES.get(language)
    if not language_spec:
        raise PersonaValidationError(f"unsupported sample language: {language}")


    cache_key = (voice_id, language)
    cached = _voice_sample_cache.get(cache_key)
    if cached is not None:
        return cached

    text = VOICE_SAMPLE_TEXTS.get(language, VOICE_SAMPLE_TEXTS["pt"])
    tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
    tmp.close()
    voice_file = tmp.name
    try:
        sample = sample_config_for(voice_id, language)
        voice_service.tts(
            text,
            sample["voice"],
            sample["rate"],
            voice_file,
            voice_pitch=sample["pitch"],
        )
        if not os.path.exists(voice_file) or os.path.getsize(voice_file) == 0:
            logger.error(f"voice sample synthesis produced no audio: {voice_id}")
            return None
        with open(voice_file, "rb") as f:
            audio = f.read()
    finally:
        if os.path.exists(voice_file):
            os.remove(voice_file)

    _voice_sample_cache[cache_key] = audio
    return audio


def _require_exactly_one(
    values: dict[str, Optional[str]],
    field_label: str,
) -> None:
    present = [k for k, v in values.items() if v]
    if len(present) == 0:
        raise PersonaValidationError(f"exactly one of {field_label} is required")
    if len(present) > 1:
        raise PersonaValidationError(f"only one of {field_label} is allowed")


def validate_persona(
    name: str,
    photo_url: Optional[str] = None,
    avatar_url: Optional[str] = None,
    voice_id: Optional[str] = None,
    voice_audio_url: Optional[str] = None,
) -> dict[str, Any]:
    """Validate a persona payload and return its normalized form.

    Raises PersonaValidationError when fields are missing or conflicting.
    """
    if not name or not name.strip():
        raise PersonaValidationError("name is required")

    _require_exactly_one({"photo_url": photo_url, "avatar_url": avatar_url}, "photo_url or avatar_url")
    _require_exactly_one({"voice_id": voice_id, "voice_audio_url": voice_audio_url}, "voice_id or voice_audio_url")

    return {
        "name": name.strip(),
        "photo_url": photo_url,
        "avatar_url": avatar_url,
        "voice_id": voice_id,
        "voice_audio_url": voice_audio_url,
    }

"""Persona payload validation — stateless.

The service does NOT persist anything: personas live in the caller's
database (Supabase). This module only validates and normalizes the
persona payload that arrives inline on a video job.
"""

from typing import Any, Optional

from loguru import logger

from app.services.openrouter_tts import get_openrouter_voices
from app.services.voice_catalog import load_catalog

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






# Bounds for the composed TTS rate. Kept coupled with the voice_rate field
# bounds on VideoParams (app/models/schema.py: ge=0.1, le=5.0): the request
# rate is schema-validated, the house style rate is a catalog constant, and
# their product is clamped back into the same window.
VOICE_RATE_MIN = 0.1
VOICE_RATE_MAX = 5.0






class PersonaValidationError(Exception):
    """Raised when the persona payload is missing or invalid."""


def get_house_voices(user_id: str | None = None) -> list[dict[str, Any]]:
    """The voice catalog the UI offers.

    House voices come from ``voice_catalog.json`` (Phonon + Kokoro, served by
    the local CPU TTS server) and are emitted as ``chatterbox:<name>`` with
    their filter metadata (``gender``, ``accent``, ``kind``). The discovered
    OpenRouter voices follow when it is configured, with no metadata. That
    id is what gets stored on the persona and handed straight to
    ``voice.tts``, which routes on the prefix, so a voice the pipeline
    cannot reach is a voice the picker must not show.

    OpenRouter contributes nothing until it is configured (``[openrouter]``
    with both a key and at least one model); see
    ``openrouter_tts.get_openrouter_voices`` for the discovery bounds.

    When ``user_id`` is given, the caller's ready cloned voices are appended
    as ``chatterbox:<engine_voice_key>`` entries with ``kind: "cloned"`` (see
    ``cloned_voices.service.list_catalog_entries``). That merge reads
    Supabase; if the store is unconfigured or unreachable the catalog
    degrades to the house voices above instead of failing the picker.
    """
    voices: list[dict[str, Any]] = [
        {
            "id": f"chatterbox:{voice['name']}",
            "label": voice["label"],
            "provider": voice["provider"],
            "gender": voice["gender"],
            "accent": voice["accent"],
            "kind": voice["kind"],
        }
        for voice in load_catalog()
    ]
    voices.extend(_unclassified_voice(voice_id, "openrouter") for voice_id in get_openrouter_voices())
    if user_id:
        try:
            from app.services.cloned_voices.service import list_catalog_entries

            for entry in list_catalog_entries(user_id):
                voices.append({**_unclassified_voice(entry["id"], "chatterbox"), "kind": "cloned"})
        except Exception:
            logger.warning(
                "cloned voice catalog merge failed; serving house voices only"
            )
    return voices


def _unclassified_voice(voice_id: str, provider: str) -> dict[str, Any]:
    return {
        "id": voice_id,
        "label": None,
        "provider": provider,
        "gender": None,
        "accent": None,
        "kind": "standard",
    }








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

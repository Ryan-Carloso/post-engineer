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

class PersonaValidationError(Exception):
    """Raised when the persona payload is missing or invalid."""


def get_house_voices(user_id: str | None = None) -> list[dict[str, Any]]:
    """The voice catalog the UI offers.

    House voices come from ``voice_catalog.json`` (Phonon + Kokoro, served by
    the local CPU TTS server) and are emitted as ``chatterbox:<name>`` with
    their filter metadata (``gender``, ``accent``, ``kind``) and a text
    ``description`` so callers who cannot listen (MCP agents) can still choose. The discovered
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
            "description": voice["description"],
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
        "description": None,
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

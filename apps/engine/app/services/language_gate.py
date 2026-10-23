"""English-only launch gate.

The product launches English-only: voice cloning only ever produced good
results in English, and the non-English preset catalogs are not ready.
Every public entry point that accepts a language (cloned-voice
registration, direct video jobs) funnels its check through here so the
rule lives in exactly one place. Regional variants of English (en-US,
en-GB, ...) count as English; anything else is rejected until the
launch lock lifts.
"""

from __future__ import annotations

from app.models.exception import HttpException

ENGLISH_ONLY_VIDEO_MESSAGE = "Only English videos are supported for now"
ENGLISH_ONLY_CLONE_MESSAGE = "Voice cloning is only available in English for now"


# Personas may store a language name instead of a code ("English"); the
# edge-tts voice selection has always accepted that form, so the gate
# must too, or legacy personas get rejected for being English.
_ENGLISH_LANGUAGE_NAMES = {"english", "inglês", "ingles"}


def is_english_language(language: str | None) -> bool:
    """True when `language` is English or a regional variant of it."""
    if not language:
        return False
    base = language.strip().lower().replace("_", "-").split("-", 1)[0]
    return base == "en" or base in _ENGLISH_LANGUAGE_NAMES


def ensure_english_video_language(body: object, request_id: str, task_id: str) -> None:
    """Raise HttpException when a video job names a non-English language.

    An empty video_language keeps the historical auto-detect default and
    is not rejected.
    """
    video_language = getattr(body, "video_language", None)
    if (
        isinstance(video_language, str)
        and video_language.strip()
        and not is_english_language(video_language)
    ):
        raise HttpException(
            task_id=task_id,
            status_code=400,
            message=f"{request_id}: {ENGLISH_ONLY_VIDEO_MESSAGE}",
        )

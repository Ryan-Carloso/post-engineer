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

ENGLISH_ONLY_VIDEO_MESSAGE = "Only English videos are supported for now"
ENGLISH_ONLY_CLONE_MESSAGE = "Voice cloning is only available in English for now"


def is_english_language(language: str | None) -> bool:
    """True when `language` is English or a regional variant of it."""
    if not language:
        return False
    base = language.strip().lower().replace("_", "-").split("-", 1)[0]
    return base == "en"

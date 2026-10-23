"""Voice-id shape helpers: provider prefixes and the no-voice sentinel.

Split out of ``voice.py`` (a grandfathered file at the size cap): these
predicates only inspect the id string, never synthesize, so they live
with the id grammar rather than the dispatcher. ``voice.py`` re-exports
every name here for its existing callers.
"""

from __future__ import annotations

NO_VOICE_NAME = "no-voice"
# `none` was the no-voice sentinel used on PR #981's branch. Keep it as a
# short-term alias so API users who called that branch directly don't break
# on upgrade; the WebUI and new code use the clearer `no-voice`.
_NO_VOICE_ALIASES = {NO_VOICE_NAME, "none"}


def parse_voice_name(name: str):
    # zh-CN-XiaoyiNeural-Female
    # zh-CN-YunxiNeural-Male
    # zh-CN-XiaoxiaoMultilingualNeural-V2-Female
    name = name.replace("-Female", "").replace("-Male", "").strip()
    return name


def is_elevenlabs_voice(voice_name: str) -> bool:
    return (voice_name or "").startswith("elevenlabs:")


def is_chatterbox_voice(voice_name: str) -> bool:
    return (voice_name or "").startswith("chatterbox:")


def is_phonon_voice(voice_name: str) -> bool:
    return (voice_name or "").startswith("phonon:")


def is_kokoro_voice(voice_name: str) -> bool:
    return (voice_name or "").startswith("kokoro:")


def is_no_voice(voice_name: str | None) -> bool:
    """Whether the user explicitly picked the no-voice mode.

    An empty string is deliberately NOT no-voice: an empty voice more likely
    means a broken config, a stale WebUI state, or a missing API parameter.
    Only an explicit sentinel enters the silent branch, so a real error is
    never disguised as a successful generation.
    """
    return str(voice_name or "").strip().lower() in _NO_VOICE_ALIASES

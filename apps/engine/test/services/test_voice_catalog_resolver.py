import pytest

from app.models.schema import VideoParams
from app.services import voice
from app.services.voice_catalog import resolve_catalog_voice_name
from app.services.voice_preflight import voice_problem


@pytest.mark.parametrize(
    "name,expected",
    [
        ("phonon_juniper", "chatterbox:phonon_juniper"),
        ("kokoro_af_heart", "chatterbox:kokoro_af_heart"),
        ("default", "chatterbox:kokoro_af_heart"),
        ("en_us_male_01", "chatterbox:kokoro_am_michael"),
        ("ryan", "chatterbox:kokoro_am_michael"),
        ("not-a-voice", "not-a-voice"),
        ("", ""),
        ("elevenlabs:abc:Name", "elevenlabs:abc:Name"),
        ("chatterbox:phonon_juniper", "chatterbox:phonon_juniper"),
        ("chatterbox_nano:x", "chatterbox_nano:x"),
        ("openrouter:m:v", "openrouter:m:v"),
        ("elevenlabs:default", "elevenlabs:default"),
    ],
)
def test_resolve_catalog_voice_name(name, expected):
    assert resolve_catalog_voice_name(name) == expected


@pytest.mark.parametrize(
    "name,expected",
    [
        ("default-Female", "chatterbox:kokoro_af_heart"),
        (" phonon_juniper ", "chatterbox:phonon_juniper"),
        ("no-voice", "no-voice"),
        ("none", "none"),
        ("elevenlabs:abc:Name", "elevenlabs:abc:Name"),
    ],
)
def test_parse_voice_name_resolves_catalog(name, expected):
    assert voice.parse_voice_name(name) == expected


def _params(voice_name: str) -> VideoParams:
    return VideoParams(
        video_title="t",
        video_description="d",
        video_type="voiceover",
        video_script="Hook. Body.",
        voice_name=voice_name,
    )


def test_voice_problem_accepts_bare_catalog_name():
    assert voice_problem(_params("phonon_juniper")) is None


def test_voice_problem_accepts_legacy_alias():
    assert voice_problem(_params("default")) is None


def test_voice_problem_rejects_unknown_plain_name():
    problem = voice_problem(_params("not-a-voice"))
    assert problem is not None and "unknown voice" in problem

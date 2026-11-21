"""The TTS timeline every provider returns must match the script it was built from.

Scripts are segment texts joined by blank lines (`segments_to_script`), and a
segment does not always end on punctuation. The providers collapse whitespace
before they send the text to the speech API; the timeline must keep the line
breaks, or `create_subtitle` splits the script and the timeline differently
and the TTS fallback writes no subtitle file.
"""

from unittest.mock import MagicMock, patch

import pytest

from app.config import config as app_config
from app.services import openrouter_tts, voice, voice_providers

SCRIPT = (
    "Stop scrolling right now\n\n"
    "This changes everything you know about money.\n\n"
    "Follow for more"
)
SPOKEN = (
    "Stop scrolling right now "
    "This changes everything you know about money. "
    "Follow for more"
)
EXPECTED_CUES = [
    "Stop scrolling right now",
    "This changes everything you",
    "know about money",
    "Follow for more",
]


def _ok_post(*args, **kwargs):
    response = MagicMock()
    response.status_code = 200
    response.content = b"fake-audio"
    return response


def _clip():
    clip = MagicMock()
    clip.duration = 6.0
    return clip


def _elevenlabs(voice_file):
    with (
        patch.object(app_config, "elevenlabs", {"api_key": "key"}),
        patch.object(voice_providers.requests, "post", side_effect=_ok_post) as post,
        patch.object(voice_providers, "AudioFileClip", return_value=_clip()),
    ):
        result = voice_providers.elevenlabs_tts(SCRIPT, "voice-id", voice_file)
    return result, post.call_args.kwargs["json"]["text"]


def _chatterbox(voice_file):
    with (
        patch.object(app_config, "chatterbox", {"base_url": "http://localhost:4123/v1"}),
        patch.object(voice_providers.requests, "post", side_effect=_ok_post) as post,
        patch.object(voice_providers, "AudioFileClip", return_value=_clip()),
    ):
        result = voice_providers.chatterbox_tts(SCRIPT, "default", voice_file)
    return result, post.call_args.kwargs["json"]["input"]


def _openrouter(voice_file):
    with (
        patch.object(app_config, "openrouter", {"api_key": "key", "models": []}),
        patch.object(openrouter_tts.requests, "post", side_effect=_ok_post) as post,
        patch.object(openrouter_tts, "AudioFileClip", return_value=_clip()),
    ):
        result = openrouter_tts.openrouter_tts(SCRIPT, "m/v", "eve", voice_file)
    return result, post.call_args.kwargs["json"]["input"]


@pytest.mark.parametrize("provider", [_elevenlabs, _chatterbox, _openrouter])
def test_the_provider_timeline_writes_every_script_line_as_a_cue(provider, tmp_path):
    result, sent_text = provider(str(tmp_path / "voice.mp3"))
    assert result.error is None
    assert sent_text == SPOKEN

    subtitle_file = tmp_path / "subtitle.srt"
    with patch.object(voice.logger, "error") as log_error:
        voice.create_subtitle(
            sub_maker=result.sub_maker, text=SCRIPT, subtitle_file=str(subtitle_file)
        )
    assert log_error.call_count == 0
    blocks = subtitle_file.read_text(encoding="utf-8").strip().split("\n\n")
    assert [block.split("\n", 2)[2] for block in blocks] == EXPECTED_CUES
    assert blocks[-1].split("\n")[1].endswith("00:00:06,000")


def test_a_timeline_that_does_not_match_the_script_logs_an_error_with_both_counts(tmp_path):
    sub_maker = voice_providers.populate_legacy_submaker_with_full_text(
        voice_providers.SubMaker(), SPOKEN, 6.0
    )
    subtitle_file = tmp_path / "subtitle.srt"
    with patch.object(voice.logger, "error") as log_error:
        voice.create_subtitle(sub_maker=sub_maker, text=SCRIPT, subtitle_file=str(subtitle_file))
    assert not subtitle_file.exists()
    log_error.assert_called_once_with(
        "TTS timeline does not match the script, no subtitle file written: "
        "matched lines: 0, script lines: 4"
    )

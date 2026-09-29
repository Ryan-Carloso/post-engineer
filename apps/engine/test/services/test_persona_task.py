"""Tests for persona integration on video tasks.

A persona arrives inline on the job payload (stateless) and resolves to:
- effective voice_name (persona.voice_id overrides params.voice_name)
- effective custom audio (persona.voice_audio_url used as voice source)
- photo/avatar ref for the video material (passed through for the pipeline)
"""

import pytest
from unittest.mock import patch
from pydantic import ValidationError

from app.models.schema import PersonaParams, VideoParams
from app.services import task as task_service
from app.services import video as video_service
from app.services.task import (
    generate_script,
    persona_hook_end_seconds,
    resolve_persona_audio,
)


def _params(**persona_fields) -> VideoParams:
    if not persona_fields:
        return VideoParams(video_subject="viagem", video_aspect="9:16")
    fields = {
        "name": "Ana",
        "photo_url": "https://supabase.test/signed/foto.png",
        **persona_fields,
    }
    return VideoParams(
        video_subject="viagem",
        video_aspect="9:16",
        persona=PersonaParams(**fields),
    )


class TestPersonaInSchema:
    def test_video_params_accepts_persona(self):
        params = _params(name="Ana", voice_id="calm")

        assert params.persona is not None
        assert params.persona.name == "Ana"

    def test_persona_is_optional(self):
        assert _params().persona is None

    def test_persona_rejects_both_voice_kinds(self):
        with pytest.raises(ValidationError):
            PersonaParams(
                name="Ana",
                voice_id="v1",
                voice_audio_url="https://x.test/voz.mp3",
            )

    def test_persona_rejects_both_visual_identities(self):
        with pytest.raises(ValidationError):
            PersonaParams(
                name="Ana",
                photo_url="https://x.test/f.png",
                avatar_url="https://x.test/a.png",
            )

    def test_faceless_persona_accepts_zero_visuals(self):
        """Faceless mode: a persona with neither photo nor avatar (voice only) is valid."""
        persona = PersonaParams(name="Canal Ninja", voice_id="calm")

        assert persona.photo_url is None
        assert persona.avatar_url is None

    def test_faceless_persona_still_requires_a_voice(self):
        """Mesmo sem visual, a persona faceless precisa de uma voz."""
        with pytest.raises(ValidationError, match="exactly one of voice_id"):
            PersonaParams(name="Canal Ninja")

    def test_faceless_persona_still_rejects_both_voices(self):
        with pytest.raises(ValidationError, match="exactly one of voice_id"):
            PersonaParams(
                name="Canal Ninja",
                voice_id="v1",
                voice_audio_url="https://x.test/voz.mp3",
            )


class TestResolvePersonaAudio:
    def test_no_persona_passes_through(self):
        params = _params()
        params.voice_name = "pt-BR-FranciscaNeural"

        voice_name, voice_audio = resolve_persona_audio(params)

        assert voice_name == "pt-BR-FranciscaNeural"
        assert voice_audio is None

    def test_voice_id_overrides_params_voice_name(self):
        params = _params(name="Ana", voice_id="calm")
        params.voice_name = "pt-BR-FranciscaNeural"

        voice_name, voice_audio = resolve_persona_audio(params)

        assert voice_name == "en-US-JennyNeural-Female"
        assert voice_audio is None

    def test_voice_audio_url_becomes_custom_audio(self):
        params = _params(
            name="Ana", voice_audio_url="https://supabase.test/signed/voz.mp3"
        )

        voice_name, voice_audio = resolve_persona_audio(params)

        assert voice_audio == "https://supabase.test/signed/voz.mp3"


class TestPersonaHookBoundary:
    def test_hook_ends_on_the_first_complete_paragraph(self):
        script = "A hook ends here.\n\nThe rest explains the story."
        subtitles = [
            (1, "00:00:00,000 --> 00:00:02,000", "A hook"),
            (2, "00:00:02,000 --> 00:00:05,600", "ends here."),
            (3, "00:00:05,600 --> 00:00:07,000", "The rest"),
        ]

        assert persona_hook_end_seconds(script, subtitles) == 5.6

    def test_hook_must_have_two_paragraphs_and_fit_the_time_window(self):
        subtitles = [(1, "00:00:00,000 --> 00:00:02,000", "Too short.")]

        with pytest.raises(ValueError, match="between 3 and 6 seconds"):
            persona_hook_end_seconds("Too short.\n\nMore.", subtitles)

        subtitles = [(1, "00:00:00,000 --> 00:00:07,000", "Too long.")]
        with pytest.raises(ValueError, match="between 3 and 6 seconds"):
            persona_hook_end_seconds("Too long.\n\nMore.", subtitles)

        with pytest.raises(ValueError, match="at least two paragraphs"):
            persona_hook_end_seconds("Only one paragraph.", subtitles)

    def test_incomplete_subtitle_matching_fails_instead_of_cutting_arbitrarily(self):
        subtitles = [(1, "00:00:00,000 --> 00:00:06,000", "Different words.")]

        with pytest.raises(ValueError, match="could not locate hook"):
            persona_hook_end_seconds(
                "The hook is complete here.\n\nThe rest.", subtitles
            )

    def test_invalid_generated_script_is_regenerated_once(self):
        params = _params(name="Ana", voice_id="calm")
        params.video_script_prompt = "Create a short story."
        with patch.object(
            task_service.llm,
            "generate_script",
            side_effect=[
                "One paragraph only.",
                "Hook is complete.",
                "Details follow.",
            ],
        ) as generate:
            result = generate_script("persona-hook-retry", params)

        assert result == "Hook is complete.\n\nDetails follow."
        assert generate.call_count == 3
        initial_prompt = generate.call_args_list[0].kwargs["video_script_prompt"]
        assert "3 to 6 seconds" in initial_prompt
        assert "8 to 12 words" in initial_prompt
        assert generate.call_args_list[1].kwargs["target_words_min"] == 8
        assert generate.call_args_list[1].kwargs["target_words_max"] == 12
        assert generate.call_args_list[2].kwargs["target_words_min"] == 72
        assert generate.call_args_list[2].kwargs["target_words_max"] == 94

    def test_video_composition_uses_the_exact_hook_boundary(self):
        class SourceClip:
            w = 1080
            h = 1920

            def close(self) -> None:
                return None

        completed = type("Completed", (), {"returncode": 0, "stderr": "", "stdout": ""})()
        with patch.object(video_service, "_open_video_clip_quietly", return_value=SourceClip()):
            with patch.object(video_service.subprocess, "run", return_value=completed) as run:
                result = video_service.replace_video_intro_with_lipsync(
                    "background.mp4",
                    "lipsync.mp4",
                    "output.mp4",
                    duration=5.6,
                )

        command = run.call_args.args[0]
        filter_graph = command[command.index("-filter_complex") + 1]
        assert result == "output.mp4"
        assert "trim=duration=5.6" in filter_graph
        assert "[0:v]trim=start=5.6" in filter_graph



class TestPersonaLipsyncGate:
    """lipsync_enabled=False keeps the persona voice but skips the
    InfiniteTalk intro entirely (no GPU work)."""

    def test_persona_with_default_lipsync_is_active(self):
        assert task_service.persona_lipsync_active(_params(voice_id="calm")) is True

    def test_persona_with_lipsync_disabled_is_inactive(self):
        params = _params(voice_id="calm")
        params.lipsync_enabled = False
        assert task_service.persona_lipsync_active(params) is False

    def test_faceless_persona_without_visual_is_inactive(self):
        """Faceless mode: without photo/avatar, even with lipsync enabled, there is
        no intro lip-sync and no face exclusion (exclude_faces=False)."""
        params = _params(name="Canal Ninja", voice_id="calm", photo_url=None)
        assert task_service.persona_lipsync_active(params) is False

    def test_persona_with_visual_and_lipsync_is_active(self):
        params = _params(voice_id="calm", photo_url=None, avatar_url="https://x.test/a.png")
        assert task_service.persona_lipsync_active(params) is True

    def test_no_persona_is_never_active(self):
        params = VideoParams(video_subject="viagem", lipsync_enabled=False)
        assert task_service.persona_lipsync_active(params) is False


class TestPersonaHookGate:
    """With lipsync disabled the script skips the persona hook contract:
    no paragraph constraints and no extra LLM regeneration calls."""

    def test_lipsync_disabled_skips_hook_regeneration(self):
        params = _params(name="Ana", voice_id="calm")
        params.lipsync_enabled = False
        with patch.object(
            task_service.llm,
            "generate_script",
            return_value="A single paragraph without hook rules.",
        ) as generate:
            result = generate_script("normal-video", params)

        assert result == "A single paragraph without hook rules."
        assert generate.call_count == 1


class TestPersonaHookRetry:
    """An overshooting persona hook must be regenerated, not fail the task.

    The engine appends its own hook instruction ("8 to 12 words, 3 to 6
    seconds") to the user's prompt, so LLM variance can still produce a
    hook the TTS speaks in >6s. Regenerating a shorter hook (plus its
    audio/subtitles) is cheaper than failing the whole task.
    """

    _LONG_HOOK = "This is a much longer hook paragraph written for testing purposes here today"
    _BODY = "The rest of the video script body goes here."

    def _script(self, hook):
        return f"{hook}.\n\n{self._BODY}"

    def _subs(self, hook_text, end_seconds):
        minutes, seconds = divmod(end_seconds, 60)
        end = f"00:{int(minutes):02d}:{seconds:06.3f}".replace(".", ",")
        return [(1, f"00:00:00,000 --> {end}", hook_text)]

    def _run_guard(self, params, script, subs_side_effect, hook_regen="Short hook here."):
        from app.services.task import _ensure_persona_hook_fits

        sub_maker = object()
        with (
            patch.object(task_service.subtitle, "file_to_subtitles", side_effect=subs_side_effect),
            patch.object(task_service.llm, "generate_script", return_value=hook_regen) as gen_hook,
            patch.object(task_service, "generate_audio", return_value=("audio2.mp3", 30, sub_maker)) as gen_audio,
            patch.object(task_service, "generate_subtitle", return_value="subtitle.srt") as gen_sub,
        ):
            result = _ensure_persona_hook_fits(
                "task-1", params, script, "audio.mp3", 40, sub_maker, "subtitle.srt"
            )
        return result, gen_hook, gen_audio, gen_sub

    def test_hook_within_window_passes_without_regeneration(self):
        params = _params(name="Ana", voice_id="calm")
        script = self._script(self._LONG_HOOK)
        subs = self._subs(self._LONG_HOOK + ".", 5.0)

        result, gen_hook, gen_audio, _ = self._run_guard(params, script, [subs])

        assert result[0] == script
        gen_hook.assert_not_called()
        gen_audio.assert_not_called()

    def test_overshooting_hook_is_regenerated_with_shorter_audio(self):
        params = _params(name="Ana", voice_id="calm")
        script = self._script(self._LONG_HOOK)
        overshoot = self._subs(self._LONG_HOOK + ".", 6.5)
        fixed = self._subs("Short hook here.", 5.0)

        (new_script, audio_file, _, _, _), gen_hook, gen_audio, gen_sub = self._run_guard(
            params, script, [overshoot, fixed]
        )

        assert new_script.startswith("Short hook here.")
        assert self._BODY in new_script
        assert audio_file == "audio2.mp3"
        gen_hook.assert_called_once()
        gen_audio.assert_called_once()
        gen_sub.assert_called_once()
        # The regeneration asks for fewer words than the overshooting hook.
        assert gen_hook.call_args.kwargs["target_words_max"] < len(self._LONG_HOOK.split())

    def test_retry_exhausted_raises_the_hook_error(self):
        params = _params(name="Ana", voice_id="calm")
        script = self._script(self._LONG_HOOK)
        overshoot = self._subs(self._LONG_HOOK + ".", 6.5)

        with pytest.raises(ValueError, match="between 3 and 6 seconds"):
            self._run_guard(
                params,
                script,
                [overshoot, overshoot, overshoot],
                hook_regen=self._LONG_HOOK + ".",
            )

    def test_custom_audio_skips_retry(self):
        """With custom audio the hook timing is fixed by the user's recording;
        regenerating text cannot change it, so no retry is attempted."""
        from app.services.task import _ensure_persona_hook_fits

        params = _params(name="Ana", voice_id="calm")
        script = self._script(self._LONG_HOOK)
        overshoot = self._subs(self._LONG_HOOK + ".", 6.5)
        with (
            patch.object(task_service.subtitle, "file_to_subtitles", return_value=overshoot),
            patch.object(task_service, "generate_audio") as gen_audio,
        ):
            result = _ensure_persona_hook_fits(
                "task-1", params, script, "custom.mp3", 40, None, "subtitle.srt"
            )

        assert result[0] == script
        gen_audio.assert_not_called()

    def test_lipsync_inactive_skips_retry(self):
        from app.services.task import _ensure_persona_hook_fits

        params = _params()  # no persona: faceless
        script = self._script(self._LONG_HOOK)
        with patch.object(task_service, "generate_audio") as gen_audio:
            result = _ensure_persona_hook_fits(
                "task-1", params, script, "audio.mp3", 40, object(), "subtitle.srt"
            )

        assert result[0] == script
        gen_audio.assert_not_called()

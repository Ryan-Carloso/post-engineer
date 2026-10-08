"""Tests for persona integration on video tasks.

A persona arrives inline on the job payload (stateless) and resolves to:
- effective voice_name (persona.voice_id overrides params.voice_name)
- effective custom audio (persona.voice_audio_url used as voice source)
- photo/avatar ref for the video material (passed through for the pipeline)
"""

import shutil

import pytest
from unittest.mock import patch
from pydantic import ValidationError

from app.utils import utils
from app.models.schema import PersonaParams, VideoParams
from app.services import task as task_service
from app.services import persona as persona_service
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

    def test_house_voice_id_stays_raw_for_language_resolution(self):
        """The raw house voice id must survive resolve_persona_audio: the
        language-specific resolution happens in generate_audio through
        resolve_house_voice_name(name, params.video_language). Expanding the
        id to an en-US qualified name here made that resolution a no-op, so
        every persona narrated in English regardless of the video language.
        """
        params = _params(name="Ana", voice_id="energetic")
        params.video_language = "pt-BR"

        voice_name, voice_audio = resolve_persona_audio(params)

        assert voice_name == "energetic"
        assert voice_audio is None

    def test_house_voice_id_overrides_params_voice_name(self):
        params = _params(name="Ana", voice_id="calm")
        params.voice_name = "pt-BR-FranciscaNeural"

        voice_name, voice_audio = resolve_persona_audio(params)

        assert voice_name == "calm"
        assert voice_audio is None

    def test_voice_audio_url_becomes_custom_audio(self):
        params = _params(
            name="Ana", voice_audio_url="https://supabase.test/signed/voz.mp3"
        )

        voice_name, voice_audio = resolve_persona_audio(params)

        assert voice_audio == "https://supabase.test/signed/voz.mp3"


class TestGenerateAudioLanguageResolution:
    def test_generate_audio_speaks_the_video_language_voice(self):
        """End-to-end composition of the two resolution steps: the raw house
        voice id from resolve_persona_audio must be resolved to the video
        language's Neural voice by resolve_house_voice_name before TTS.
        Reordering the two functions (or expanding the id early) makes this
        red while each unit test in isolation still passes — it pins the
        composition, not the units.
        """
        params = _params(name="Ana", voice_id="energetic")
        params.video_language = "pt-BR"
        sub_maker = object()
        task_id = "task-ptbr-voice"
        try:
            with (
                patch.object(
                    task_service.voice, "tts", return_value=sub_maker
                ) as tts,
                patch.object(
                    task_service.voice, "get_audio_duration", return_value=46
                ),
            ):
                audio_file, audio_duration, returned = task_service.generate_audio(
                    task_id, params, "Rosto humano."
                )
        finally:
            shutil.rmtree(utils.task_dir(task_id), ignore_errors=True)

        # Assert against the catalog, never a hardcoded voice name: the test
        # stays valid if the voice catalog changes.
        assert (
            tts.call_args.kwargs["voice_name"]
            == persona_service.PERSONA_SAMPLE_VOICES["energetic"]["pt"]
        )
        assert audio_duration == 46
        assert returned is sub_maker


class TestGenerateAudioHouseVoiceStyle:
    """The house voice personality (rate/pitch) the preview sample is
    synthesized with must reach the pipeline TTS: 'energetic' is previewed
    at 1.2x/+5Hz but the delivered video was narrated flat at 1.0x."""

    def _tts_kwargs(self, params, task_id):
        sub_maker = object()
        try:
            with (
                patch.object(
                    task_service.voice, "tts", return_value=sub_maker
                ) as tts,
                patch.object(
                    task_service.voice, "get_audio_duration", return_value=46
                ),
            ):
                task_service.generate_audio(task_id, params, "Rosto humano.")
        finally:
            shutil.rmtree(utils.task_dir(task_id), ignore_errors=True)
        return tts.call_args.kwargs

    def test_house_voice_rate_and_pitch_reach_the_tts(self):
        params = _params(name="Ana", voice_id="calm")
        params.video_language = "pt-BR"

        kwargs = self._tts_kwargs(params, "task-style-calm")

        # Assert against the catalog, never hardcoded literals.
        assert kwargs["voice_rate"] == pytest.approx(
            persona_service.HOUSE_VOICE_STYLES["calm"]["rate"]
        )
        assert (
            kwargs["voice_pitch"]
            == persona_service.HOUSE_VOICE_STYLES["calm"]["pitch"]
        )

    def test_request_rate_scales_the_house_style(self):
        params = _params(name="Ana", voice_id="calm")
        params.video_language = "pt-BR"
        params.voice_rate = 1.2

        kwargs = self._tts_kwargs(params, "task-style-scaled")

        expected = 1.2 * persona_service.HOUSE_VOICE_STYLES["calm"]["rate"]
        assert kwargs["voice_rate"] == pytest.approx(expected)

    def test_non_house_voice_keeps_the_request_rate_and_no_pitch(self):
        params = _params(name="Ana", voice_id="en-US-JennyNeural")
        params.video_language = "pt-BR"

        kwargs = self._tts_kwargs(params, "task-style-custom")

        assert kwargs["voice_rate"] == pytest.approx(params.voice_rate)
        assert kwargs["voice_pitch"] == ""


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
        assert "3 to 12 seconds" in initial_prompt
        assert "8 to 28 words" in initial_prompt
        assert generate.call_args_list[1].kwargs["target_words_min"] == 8
        assert generate.call_args_list[1].kwargs["target_words_max"] == 28
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
                with patch.object(
                    video_service, "_get_effective_video_codec", return_value="libx264"
                ):
                    result = video_service.replace_video_intro_with_lipsync(
                        "background.mp4",
                        "lipsync.mp4",
                        "output.mp4",
                        duration=5.6,
                    )

        commands = [call.args[0] for call in run.call_args_list]
        assert result == "output.mp4"
        # The hook boundary now drives two separate ffmpeg passes instead of
        # one filter_complex concat: the intro is trimmed to the exact hook
        # length, and the tail starts at that same boundary.
        intro = next(c for c in commands if "-vf" in c)
        tail = next(c for c in commands if "-ss" in c)
        assert intro[commands.index(intro) + intro.index("-t") + 1] == "5.6"
        assert tail[tail.index("-ss") + 1] == "5.6"



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
        overshoot = self._subs(self._LONG_HOOK + ".", 14.0)
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
        overshoot = self._subs(self._LONG_HOOK + ".", 14.0)

        with pytest.raises(ValueError, match="between 3 and 12 seconds"):
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


class TestPersonaPacingConstants:
    """Persona pacing is product-fixed in task.py — no config knobs."""

    def test_constants_are_the_approved_product_values(self):
        assert task_service.PERSONA_HOOK_MIN_SECONDS == 3.0
        assert task_service.PERSONA_HOOK_MAX_SECONDS == 12.0
        assert task_service.PERSONA_HOOK_TARGET_WORDS_MIN == 8
        assert task_service.PERSONA_HOOK_TARGET_WORDS_MAX == 28
        assert task_service.PERSONA_LIPSYNC_MAX_SECONDS == 15.0
        assert task_service.FACE_FILL_MIN_SECONDS == 5.0
        assert task_service.FACE_FILL_MAX_SECONDS == 8.0
        assert task_service.PERSONA_SELECTIVE_STOCK_MIN_SCORE == 0.3

    def test_hook_constants_stay_inside_the_gpu_ceiling(self):
        assert task_service.PERSONA_HOOK_MIN_SECONDS <= task_service.PERSONA_HOOK_MAX_SECONDS
        assert task_service.PERSONA_HOOK_MAX_SECONDS <= task_service.PERSONA_LIPSYNC_MAX_SECONDS

    def test_video_params_has_no_pacing_fields(self):
        params = VideoParams(video_subject="viagem")
        assert not hasattr(params, "persona_hook_min_seconds")
        assert not hasattr(params, "persona_hook_max_seconds")


class TestSelectiveStockFilter:
    """Weak stock terms never enter the download queue (always on)."""

    def _filter(self, subject, terms):
        params = VideoParams(video_subject=subject)
        return task_service._filter_weak_stock_terms(params, terms)

    def test_weak_term_is_dropped_strong_kept_in_order(self):
        kept = self._filter(
            "portagens e vinhetas na europa",
            ["portagens europa", "gato selado", "vinhetas"],
        )
        assert kept == ["portagens europa", "vinhetas"]

    def test_all_weak_keeps_the_original_list(self):
        terms = ["gato selado", "submarino"]
        assert self._filter("portagens europa", terms) == terms

    def test_single_term_is_never_filtered(self):
        terms = ["gato selado"]
        assert self._filter("portagens europa", terms) == terms

    def test_tokenless_term_scores_zero_and_is_dropped(self):
        kept = self._filter(
            "portagens europa",
            ["a o e", "portagens europa"],
        )
        assert kept == ["portagens europa"]

    def test_empty_subject_disables_the_filter(self):
        terms = ["gato selado"]
        params = VideoParams(video_subject="portagens europa")
        params.video_subject = ""
        assert task_service._filter_weak_stock_terms(params, terms) == terms


def _subtitles_for_face_fill():
    # Hook 0-5.6s, middle events, tail events summing to a valid window.
    return [
        (1, "00:00:00,000 --> 00:00:05,600", "hook text"),
        (2, "00:00:05,600 --> 00:00:12,000", "middle one"),
        (3, "00:00:12,000 --> 00:00:18,000", "middle two"),
        (4, "00:00:18,000 --> 00:00:21,500", "tail one"),
        (5, "00:00:21,500 --> 00:00:24,500", "tail two"),
    ]


class TestFaceFillTail:
    """The video closes on the persona instead of trailing stock — slot cut
    on the VIDEO timeline, boundaries only at subtitle event starts."""

    def _tail(self, subtitles, video_duration=24.5):
        return task_service._face_fill_tail_seconds(subtitles, video_duration)

    def test_tail_snaps_to_subtitle_boundary_and_respects_ceiling(self):
        result = self._tail(_subtitles_for_face_fill())
        # The slot is chosen on the VIDEO timeline (V=24.5): boundaries with
        # tail within [5,8] are start=18 (tail 6.5) only; start=21.5 would
        # give 3.0s, below the product minimum → (18.0, 6.5).
        assert result == (18.0, 6.5)

    def test_tail_picks_the_window_closest_to_the_midpoint(self):
        result = self._tail(_subtitles_for_face_fill(), video_duration=27.0)
        # Boundaries: start=18 → 9.0 (over ceiling), start=21.5 → 5.5 (valid)
        # → the only valid window wins.
        assert result == (21.5, 5.5)

    def test_tail_never_eats_the_hook(self):
        short = [
            (1, "00:00:00,000 --> 00:00:05,000", "hook text"),
            (2, "00:00:05,000 --> 00:00:07,000", "tail"),
        ]
        # Tail start (5.0) <= hook end (5.0) + 1 → skipped.
        assert self._tail(short) is None

    def test_video_too_short_for_a_tail_returns_none(self):
        only_hook = [(1, "00:00:00,000 --> 00:00:02,000", "hook text")]
        assert self._tail(only_hook) is None


class TestOutroSplice:
    """Phase D: the outro splice mirrors the intro splice economics — only
    the outro segment is re-encoded, the head is stream-copied."""

    def test_outro_encodes_tail_and_stream_copies_head(self):
        class SourceClip:
            w = 1080
            h = 1920
            duration = 30.0

            def close(self) -> None:
                return None

        completed = type("Completed", (), {"returncode": 0, "stderr": "", "stdout": ""})()
        with patch.object(video_service, "_open_video_clip_quietly", return_value=SourceClip()):
            with patch.object(video_service, "VideoFileClip", return_value=SourceClip()):
                with patch.object(video_service.subprocess, "run", return_value=completed) as run:
                    with patch.object(
                        video_service, "_get_effective_video_codec", return_value="libx264"
                    ):
                        result = video_service.replace_video_outro_with_lipsync(
                            "background.mp4",
                            "lipsync.mp4",
                            "output.mp4",
                            duration=5.0,
                        )

        commands = [call.args[0] for call in run.call_args_list]
        assert result == "output.mp4"
        outro = next(c for c in commands if "-vf" in c)
        head = next(c for c in commands if "-t" in c and "-vf" not in c)
        assert outro[outro.index("-t") + 1] == "5.0"
        # Head covers everything before the outro (30s total - 5s tail).
        assert head[head.index("-t") + 1] == "25.0"
        assert "-c:v" in head and "copy" in head


class TestFaceFillBestEffort:
    """Face-fill NEVER fails a task that already has an intro-only video:
    any error in the probe/trim/Modal/splice chain degrades to the input
    video with a logged, sanitized error."""

    def _run(self, tmp_path, video_file="intro-only.mp4", **extra_patches):
        import contextlib

        patchers = {
            "subs": patch.object(
                task_service.subtitle,
                "file_to_subtitles",
                return_value=_subtitles_for_face_fill(),
            ),
            "duration": patch.object(
                task_service.video, "video_duration_seconds", return_value=24.5
            ),
            "isfile": patch.object(
                task_service.os.path, "isfile", return_value=True
            ),
            "task_dir": patch.object(
                task_service.utils, "task_dir", return_value=str(tmp_path)
            ),
            "trim": patch.object(task_service.infinitetalk, "trim_audio"),
            "intro": patch.object(
                task_service.infinitetalk, "generate_intro"
            ),
            "splice": patch.object(
                task_service.video,
                "replace_video_outro_with_lipsync",
                return_value="spliced-outro.mp4",
            ),
            "log_error": patch.object(task_service.logger, "error"),
            **extra_patches,
        }
        mocks: dict = {}
        with contextlib.ExitStack() as stack:
            for key, patcher in patchers.items():
                mocks[key] = stack.enter_context(patcher)
            result = task_service._apply_persona_face_fill(
                task_id="task-1",
                params=_params(voice_id="calm", photo_url=None, avatar_url="https://x.test/a.png"),
                video_file=video_file,
                audio_file="audio.mp3",
                subtitle_path="subtitle.srt",
                index=1,
            )
        return result, mocks["log_error"]

    def test_happy_path_returns_the_spliced_outro(self, tmp_path):
        result, log_error = self._run(tmp_path)
        assert result == "spliced-outro.mp4"
        log_error.assert_not_called()

    def test_duration_probe_failure_keeps_the_intro_only_video(self, tmp_path):
        failure = patch.object(
            task_service.video,
            "video_duration_seconds",
            side_effect=RuntimeError("unreadable file"),
        )
        result, log_error = self._run(tmp_path, duration=failure)
        assert result == "intro-only.mp4"
        log_error.assert_called_once()

    def test_modal_failure_keeps_the_intro_only_video(self, tmp_path):
        from app.services.infinitetalk import InfiniteTalkError

        failure = patch.object(
            task_service.infinitetalk,
            "generate_intro",
            side_effect=InfiniteTalkError("InfiniteTalk job timed out"),
        )
        result, log_error = self._run(tmp_path, intro=failure)
        assert result == "intro-only.mp4"
        log_error.assert_called_once()
        # Error text is sanitized and bounded before logging.
        message = log_error.call_args.args[0]
        assert "timed out" in message

    def test_splice_failure_keeps_the_intro_only_video(self, tmp_path):
        failure = patch.object(
            task_service.video,
            "replace_video_outro_with_lipsync",
            side_effect=RuntimeError("lip-sync concat failed"),
        )
        result, log_error = self._run(tmp_path, splice=failure)
        assert result == "intro-only.mp4"
        log_error.assert_called_once()

    def test_logged_error_is_sanitized_and_bounded(self, tmp_path):
        from app.services.infinitetalk import InfiniteTalkError

        secret = "Bearer super-secret-token"
        failure = patch.object(
            task_service.infinitetalk,
            "generate_intro",
            side_effect=InfiniteTalkError(f"submit failed with {secret}"),
        )
        _, log_error = self._run(tmp_path, intro=failure)
        message = log_error.call_args.args[0]
        assert secret not in message
        assert len(message) < 600


class TestLipsyncCeilingGuard:
    """The hook window constant could be edited past the InfiniteTalk GPU
    ceiling; prepare_persona_lipsync_video rejects it at runtime instead of
    rendering an oversized intro."""

    def test_hook_past_the_lipsync_ceiling_raises(self, tmp_path, monkeypatch):
        import base64 as b64

        monkeypatch.setattr(
            task_service, "persona_hook_end_seconds", lambda *a, **k: 16.0
        )
        monkeypatch.setattr(task_service.utils, "task_dir", lambda _tid: str(tmp_path))
        monkeypatch.setattr(
            task_service.subtitle,
            "file_to_subtitles",
            lambda _path: _subtitles_for_face_fill(),
        )
        params = _params(voice_id="calm", photo_url=None, avatar_url="data:image/png;base64," + b64.b64encode(b"img").decode())
        with pytest.raises(ValueError, match="exceeds the lipsync ceiling"):
            task_service.prepare_persona_lipsync_video(
                task_id="task-1",
                params=params,
                audio_file="audio.mp3",
                background_video="bg.mp4",
                index=1,
                video_script="Hook.\n\nBody.",
                subtitle_path="subtitle.srt",
            )

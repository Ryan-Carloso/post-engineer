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
from app.services import stock_terms
from app.services import task as task_service
from app.services import video as video_service
from app.services.task import (
    generate_script,
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






class TestPersonaHookBoundary:
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
    LongCat intro entirely (no GPU work)."""

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
    no paragraph constraints, no hook validation, and no LLM calls."""

    def test_lipsync_disabled_skips_hook_validation(self):
        params = _params(name="Ana", voice_id="calm")
        params.lipsync_enabled = False
        params.video_script = "A single paragraph without hook rules."
        assert not hasattr(task_service, "llm")
        result = generate_script("normal-video", params)

        assert result == "A single paragraph without hook rules."


class TestPersonaHookFits:
    """An overshooting persona hook is measured once and tracked, never
    regenerated and never a task failure (task.py::_ensure_persona_hook_fits):
    the guard returns the script/audio/subtitle tuple unchanged on every
    branch, and only logs/tracks when the spoken hook falls outside the
    8-12 second window."""

    # An overshooting hook is LONG by construction: it must speak past the
    # 12 second ceiling to exercise the outside-window branch.
    _LONG_HOOK = (
        "This is a much longer hook paragraph written purely for testing "
        "purposes, dragging on well past the sixteen second ceiling that the "
        "engine enforces, with plenty of extra words that no sane script "
        "would ever place inside a single opening paragraph"
    )
    _BODY = "The rest of the video script body goes here."

    def _script(self, hook):
        return f"{hook}.\n\n{self._BODY}"

    def _subs(self, hook_text, end_seconds):
        minutes, seconds = divmod(end_seconds, 60)
        end = f"00:{int(minutes):02d}:{seconds:06.3f}".replace(".", ",")
        return [(1, f"00:00:00,000 --> {end}", hook_text)]

    def _run_guard(self, params, script, subs_side_effect):
        from app.services.task import _ensure_persona_hook_fits

        sub_maker = object()
        with patch.object(task_service.subtitle, "file_to_subtitles", side_effect=subs_side_effect):
            result = _ensure_persona_hook_fits(
                "task-1", params, script, "audio.mp3", 40, sub_maker, "subtitle.srt"
            )
        return result

    def test_hook_within_window_passes_unchanged(self):
        params = _params(name="Ana", voice_id="calm")
        script = self._script(self._LONG_HOOK)
        subs = self._subs(self._LONG_HOOK + ".", 9.0)

        result = self._run_guard(params, script, [subs])

        assert result[0] == script
        assert result[1] == "audio.mp3"
        assert result[2] == 40
        assert result[3] is not None
        assert result[4] == "subtitle.srt"

    def test_custom_audio_passes_through_unchanged(self):
        """With custom audio there is no subtitle maker to measure from,
        so the guard returns the tuple unchanged."""
        from app.services.task import _ensure_persona_hook_fits

        params = _params(name="Ana", voice_id="calm")
        script = self._script(self._LONG_HOOK)
        result = _ensure_persona_hook_fits(
            "task-1", params, script, "custom.mp3", 40, None, "subtitle.srt"
        )

        assert result[0] == script
        assert result[1] == "custom.mp3"

    def test_lipsync_inactive_passes_through_unchanged(self):
        from app.services.task import _ensure_persona_hook_fits

        params = _params()  # no persona: faceless
        script = self._script(self._LONG_HOOK)
        result = _ensure_persona_hook_fits(
            "task-1", params, script, "audio.mp3", 40, object(), "subtitle.srt"
        )

        assert result[0] == script
        assert result[1] == "audio.mp3"


class TestPersonaPacingConstants:
    """Persona pacing is product-fixed (task.py / persona_hook.py) — no config knobs."""

    def test_constants_are_the_approved_product_values(self):
        assert task_service.PERSONA_HOOK_MIN_SECONDS == 8.0
        assert task_service.PERSONA_HOOK_MAX_SECONDS == 12.0
        assert task_service.PERSONA_HOOK_TARGET_WORDS_MIN == 20
        assert task_service.PERSONA_HOOK_TARGET_WORDS_MAX == 30
        assert task_service.PERSONA_LIPSYNC_MAX_SECONDS == 12.0
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
        return stock_terms.filter_weak_stock_terms(params, terms)

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
        assert stock_terms.filter_weak_stock_terms(params, terms) == terms

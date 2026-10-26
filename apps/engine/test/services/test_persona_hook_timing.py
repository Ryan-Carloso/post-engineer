"""Persona hook timing never fails the task and never regenerates.

Voices without word-level timestamps (Chatterbox, OpenRouter) fall back to
Whisper, whose cues are coarse: one cue can hold the whole hook plus part
of the body ("[0.14s -> 14.60s] stop wasting ... it's not worth it stop
eating at ..."). Taking that cue's end as the hook end measured 14.6s and
24.76s for a ~5s hook, and the retry loop then regenerated the hook (LLM +
minutes of CPU TTS) before failing the whole task.

Contract pinned here:
- the hook end is interpolated inside the cue that crosses it, by the
  share of spoken characters, so a coarse cue still gives a sane cut;
- a hook outside the 8-12s quality window only logs and tracks: no
  regeneration, no failure;
- the lipsync intro is capped at the GPU ceiling (12s): past it, the
  persona lip-syncs the first 12s and the rest of the hook plays as voice
  over the material. The intro runs exactly once.
"""

import base64
from contextlib import ExitStack
from unittest.mock import patch

import pytest

from app.models.schema import PersonaParams, VideoParams
from app.services import persona_hook
from app.services import task as task_service
from app.services.persona_hook import _find_hook_end_seconds, lipsync_window_seconds


def _cue(index, start, end, text):
    return (index, f"{start} --> {end}", text)


# Real shape from task 0d742933 (Chatterbox voice, Whisper fallback).
_WHISPER_SCRIPT = (
    "Stop wasting your trip stuck in a ninety minute line for the original, it's not worth it.\n\n"
    "Stop eating at the most famous Francesinha house, you're doing it wrong. "
    "Skip the 90 minute wait at Porto de Galinhas and take a two minute walk to A Vida Portuguesa.\n\n"
    "Same dish, zero line, and it actually tastes like a real Portuguese stew. Save this video for later."
)
_WHISPER_CUES = [
    _cue(
        1,
        "00:00:00,140",
        "00:00:14,600",
        "stop wasting your trip stuck in a ninety-minute line for the original it's not worth it "
        "stop eating at the most famous francis in her house you're doing it wrong skip the "
        "ninety-minute wait at porto de galinhas and take a two-minute walk to avida",
    ),
    _cue(
        2,
        "00:00:14,600",
        "00:00:24,760",
        "same dish zero line and it actually tastes like a real portuguese stew not a comfort "
        "food special dinner save this video for later",
    ),
]


class TestHookEndMeasurement:
    def test_coarse_whisper_cue_is_interpolated_not_taken_whole(self):
        end = _find_hook_end_seconds(_WHISPER_SCRIPT, _WHISPER_CUES)
        # The hook is roughly the first third of a 14.46s cue.
        assert 3.0 < end < 7.0

    def test_exact_cue_boundary_is_kept(self):
        script = "A hook ends here.\n\nThe rest explains the story."
        cues = [
            _cue(1, "00:00:00,000", "00:00:02,000", "A hook"),
            _cue(2, "00:00:02,000", "00:00:05,600", "ends here."),
            _cue(3, "00:00:05,600", "00:00:07,000", "The rest"),
        ]
        assert _find_hook_end_seconds(script, cues) == pytest.approx(5.6)

    def test_single_paragraph_or_missing_punctuation_never_raises(self):
        cues = [_cue(1, "00:00:00,000", "00:00:06,000", "Only one paragraph here")]
        assert _find_hook_end_seconds("Only one paragraph here", cues) == pytest.approx(6.0)

    def test_unmatched_words_fall_back_to_the_spoken_end(self):
        cues = [_cue(1, "00:00:00,000", "00:00:06,000", "Different words.")]
        assert _find_hook_end_seconds("The hook is complete here.\n\nThe rest.", cues) == pytest.approx(6.0)

    def test_no_timed_cues_measures_zero(self):
        assert _find_hook_end_seconds("Hook.\n\nBody.", []) == 0.0


class TestLipsyncWindow:
    @pytest.mark.parametrize("hook_end, expected", [(14.6, 12.0), (9.0, 9.0), (5.0, 5.0), (12.0, 12.0)])
    def test_window_is_the_hook_capped_at_the_ceiling(self, hook_end, expected):
        assert lipsync_window_seconds(hook_end, 12.0) == expected


def _lipsync_params() -> VideoParams:
    avatar = "data:image/png;base64," + base64.b64encode(b"img").decode()
    return VideoParams(
        video_subject="francesinha",
        video_aspect="9:16",
        lipsync_enabled=True,
        persona=PersonaParams(name="Ryan", voice_id="calm", avatar_url=avatar),
    )


class TestHookOutsideWindowNeverRegeneratesOrFails:
    def test_long_hook_ships_without_regeneration(self):
        params = _lipsync_params()
        with (
            patch.object(task_service.subtitle, "file_to_subtitles", return_value=_WHISPER_CUES),
            patch.object(task_service, "_find_hook_end_seconds", return_value=24.76),
            patch.object(task_service, "generate_audio") as generate_audio,
            patch.object(task_service.llm, "generate_script") as generate_script,
            patch.object(persona_hook, "track_event") as track,
        ):
            result = task_service._ensure_persona_hook_fits(
                "task-1", params, _WHISPER_SCRIPT, "audio.mp3", 24.9, object(), "subtitle.srt"
            )
        assert result[0] == _WHISPER_SCRIPT
        assert result[1:3] == ("audio.mp3", 24.9)
        generate_audio.assert_not_called()
        generate_script.assert_not_called()
        track.assert_called_once()
        assert track.call_args[0][0] == "persona_hook_outside_window"


class TestLipsyncIntroIsCappedNotSkipped:
    def _prepare(self, tmp_path, cues=_WHISPER_CUES, hook_end=None, audio_seconds=30.0):
        with ExitStack() as stack:
            stack.enter_context(patch.object(task_service.utils, "task_dir", return_value=str(tmp_path)))
            stack.enter_context(patch.object(task_service.subtitle, "file_to_subtitles", return_value=cues))
            stack.enter_context(
                patch.object(task_service.voice, "get_audio_duration", return_value=audio_seconds)
            )
            if hook_end is not None:
                stack.enter_context(
                    patch.object(persona_hook, "_find_hook_end_seconds", return_value=hook_end)
                )
            intro = stack.enter_context(
                patch.object(
                    task_service.longcat, "generate_intro", return_value=("intro.mp4", 0.5, "job-1")
                )
            )
            compose = stack.enter_context(
                patch.object(task_service.video, "compose_lipsync_layout", return_value="combined.mp4")
            )
            track = stack.enter_context(patch.object(persona_hook, "track_event"))
            result = task_service.prepare_persona_lipsync_video(
                task_id="task-1",
                params=_lipsync_params(),
                audio_file="audio.mp3",
                background_video="bg.mp4",
                index=1,
                video_script=_WHISPER_SCRIPT,
                subtitle_path="subtitle.srt",
            )
        return result, intro, compose, track

    def test_hook_past_the_ceiling_lipsyncs_the_first_12_seconds_once(self, tmp_path):
        result, intro, compose, track = self._prepare(tmp_path, hook_end=14.6)
        assert result == ("combined.mp4", 0.5, "job-1")
        intro.assert_called_once()
        assert intro.call_args.kwargs["duration_seconds"] == 12.0
        assert compose.call_args.kwargs["duration"] == 12.0
        assert [c[0][0] for c in track.call_args_list] == ["persona_hook_clamped"]

    def test_hook_inside_the_ceiling_is_used_as_is(self, tmp_path):
        _, intro, compose, track = self._prepare(tmp_path, hook_end=9.5)
        assert intro.call_args.kwargs["duration_seconds"] == 9.5
        assert compose.call_args.kwargs["duration"] == 9.5
        track.assert_not_called()


class TestHookEstimatedWithoutSubtitles:
    """Subtitles off, or custom audio on a non-Whisper provider, leave no
    timed cues. The user paid for the face, so the hook end is estimated
    from the audio length by the hook's character share instead of
    skipping the intro. Only an unknown audio length skips it."""

    def test_estimate_is_the_hook_share_of_the_audio(self):
        script = "Hook here.\n\nBody text that runs."
        hook, total = len("Hookhere"), len("HookhereBodytextthatruns")
        assert persona_hook.estimate_hook_end_seconds(script, 24.0) == pytest.approx(24.0 * hook / total)

    def test_estimate_without_a_duration_is_zero(self):
        assert persona_hook.estimate_hook_end_seconds("Hook.\n\nBody.", 0.0) == 0.0

    def test_no_subtitles_renders_an_estimated_intro_once(self, tmp_path):
        prepare = TestLipsyncIntroIsCappedNotSkipped()
        result, intro, compose, track = prepare._prepare(tmp_path, cues=[], audio_seconds=30.0)
        expected = persona_hook.estimate_hook_end_seconds(_WHISPER_SCRIPT, 30.0)
        assert result == ("combined.mp4", 0.5, "job-1")
        intro.assert_called_once()
        assert intro.call_args.kwargs["duration_seconds"] == pytest.approx(expected)
        assert compose.call_args.kwargs["duration"] == pytest.approx(expected)
        assert [c[0][0] for c in track.call_args_list] == ["persona_hook_estimated"]

    def test_unknown_audio_length_returns_no_intro_without_gpu(self, tmp_path):
        prepare = TestLipsyncIntroIsCappedNotSkipped()
        result, intro, compose, track = prepare._prepare(tmp_path, cues=[], audio_seconds=0.0)
        assert result is None
        intro.assert_not_called()
        compose.assert_not_called()
        assert [c[0][0] for c in track.call_args_list] == ["persona_hook_lipsync_skipped"]

    def test_no_skip_exception_type_remains(self):
        # A skip is an explicit None return, never an exception a generic
        # `except ValueError` could swallow.
        assert not hasattr(persona_hook, "LipsyncIntroSkipped")


def test_report_lipsync_intro_skipped_tracks_immediately(monkeypatch):
    tracked = []
    monkeypatch.setattr(persona_hook, "track_event", lambda *a, **k: tracked.append((a, k)))
    persona_hook.report_lipsync_intro_skipped("task-9", 0.0)
    assert tracked == [
        (("persona_hook_lipsync_skipped", {"task_id": "task-9", "hook_end_seconds": 0.0}), {"immediate": True})
    ]


def test_clamp_event_carries_only_numbers(monkeypatch):
    tracked = []
    monkeypatch.setattr(persona_hook, "track_event", lambda *a, **k: tracked.append(a))
    persona_hook.report_hook_clamped("task-9", 14.6, 12.0)
    assert tracked == [
        ("persona_hook_clamped", {"task_id": "task-9", "hook_end_seconds": 14.6, "lipsync_seconds": 12.0})
    ]

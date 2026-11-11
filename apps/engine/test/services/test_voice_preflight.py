"""Voice preflight: an unusable voice fails the job before any cost.

Mirrors the voice task.generate_audio will use and the routing voice.tts
applies, so a typo, an empty voice or a bare name like ``energetic`` fails at
the start of the task (and is refunded) instead of in the audio stage.
"""

import unittest
from unittest.mock import MagicMock, patch

from app.models.schema import PersonaParams, VideoParams
from app.services import longcat, persona_preflight, start_preflight, voice_preflight
from app.services import task as task_service
from app.services.voice_preflight import VoiceConfigError


def _params(
    voice_id: str | None = "chatterbox:kokoro_af_heart", voice_name: str = "", **extra
) -> VideoParams:
    return VideoParams(
        video_title="coffee",
        video_description="Test description.",
        video_type="hook_lipsync",
        video_script="Hook. Body. Call to action.",
        voice_name=voice_name,
        persona=PersonaParams(
            name="Ana", photo_url="https://img.test/p.png", voice_id=voice_id, **extra
        ),
    )


def _no_persona(voice_name: str) -> VideoParams:
    return VideoParams(
        video_title="coffee",
        video_description="Test description.",
        video_type="faceless",
        video_script="Hook. Body. Call to action.",
        voice_name=voice_name,
    )


def _sample_persona() -> VideoParams:
    return VideoParams(
        video_title="coffee",
        video_description="Test description.",
        video_type="hook_lipsync",
        video_script="Hook. Body. Call to action.",
        persona=PersonaParams(
            name="Ana", photo_url="https://img.test/p.png", voice_audio_url="https://v.test/s.mp3"
        ),
    )


class VoiceProblemTests(unittest.TestCase):
    def test_accepts_every_provider_prefix(self):
        for name in (
            "elevenlabs:abc123",
            "chatterbox:kokoro_af_heart",
            "chatterbox_nano:my-clone",
            "chatterbox:kokoro_af_heart-Female",
            "openrouter:openai/gpt-4o-mini-tts:alloy",
            "no-voice",
        ):
            with self.subTest(name=name):
                self.assertIsNone(voice_preflight.voice_problem(_params(voice_id=name)))

    def test_rejects_the_names_seen_in_production(self):
        for name in ("energetic", "en-US-GuyNeural", "calm"):
            with self.subTest(name=name):
                problem = voice_preflight.voice_problem(_params(voice_id=name))
                self.assertIsNotNone(problem)
                self.assertIn(f"unknown voice {name!r}", problem)

    def test_rejects_an_empty_id_after_the_prefix(self):
        for name in ("elevenlabs:", "chatterbox:  ", "chatterbox_nano:"):
            with self.subTest(name=name):
                self.assertIn("empty", voice_preflight.voice_problem(_params(voice_id=name)))

    def test_rejects_a_malformed_openrouter_id(self):
        problem = voice_preflight.voice_problem(_params(voice_id="openrouter:only-model"))
        self.assertIn("openrouter:<model>:<voice>", problem)

    def test_no_voice_at_all_is_the_original_message(self):
        problem = voice_preflight.voice_problem(_no_persona(""))
        self.assertIn("no voice configured", problem)

    def test_falls_back_to_voice_name_when_the_persona_has_no_voice_id(self):
        self.assertIsNone(voice_preflight.voice_problem(_no_persona("elevenlabs:xyz")))
        self.assertIn("unknown voice", voice_preflight.voice_problem(_no_persona("nope")))

    def test_a_voice_sample_means_no_tts_so_no_check(self):
        params = _sample_persona()
        params.voice_name = "energetic"  # ignored: the sample is the narration
        self.assertIsNone(voice_preflight.voice_problem(params))

    def test_custom_audio_means_no_tts_so_no_check(self):
        params = _params(voice_id="energetic")
        params.custom_audio_file = "/tmp/narration.mp3"
        self.assertIsNone(voice_preflight.voice_problem(params))

    def test_check_voice_raises_with_the_problem(self):
        with self.assertRaises(VoiceConfigError) as ctx:
            voice_preflight.check_voice(_params(voice_id="energetic"))
        self.assertIn("unknown voice 'energetic'", str(ctx.exception))
        voice_preflight.check_voice(_params())  # a valid voice does not raise


class StartPreflightOrderTests(unittest.TestCase):
    def test_voice_is_checked_first_and_the_phase_is_attributed(self):
        phases = MagicMock()
        with patch.object(persona_preflight, "preflight_persona_image") as image:
            with self.assertRaises(VoiceConfigError):
                start_preflight.run(phases, "t-1", _params(voice_id="energetic"), 1024, "video")
        image.assert_not_called()
        phases.begin.assert_called_once_with("voice")

    def test_a_full_video_run_checks_the_voice_then_the_image(self):
        phases = MagicMock()
        params = _params()
        with patch.object(persona_preflight, "preflight_persona_image") as image:
            start_preflight.run(phases, "t-2", params, 2048, "video")
        image.assert_called_once_with("t-2", params, 2048)
        self.assertEqual(
            [c.args[0] for c in phases.begin.call_args_list], ["voice", "persona_image"]
        )

    def test_a_script_run_checks_nothing(self):
        for stop_at in ("script",):
            with (
                self.subTest(stop_at=stop_at),
                patch.object(persona_preflight, "preflight_persona_image") as image,
            ):
                phases = MagicMock()
                start_preflight.run(phases, "t-3", _params(voice_id="energetic"), 1024, stop_at)
                image.assert_not_called()
                phases.begin.assert_not_called()

    def test_audio_through_materials_runs_check_the_voice_but_not_the_image(self):
        for stop_at in ("audio", "subtitle", "materials"):
            with (
                self.subTest(stop_at=stop_at),
                patch.object(persona_preflight, "preflight_persona_image") as image,
            ):
                with self.assertRaises(VoiceConfigError):
                    start_preflight.run(
                        MagicMock(), "t-4", _params(voice_id="energetic"), 1024, stop_at
                    )
                start_preflight.run(MagicMock(), "t-4", _params(), 1024, stop_at)
                image.assert_not_called()


class StartAbortsOnBadVoiceTests(unittest.TestCase):
    def _start(self, params, stop_at="video", image_failure=None):
        generate_script = MagicMock(return_value="script")
        with (
            patch.object(persona_preflight, "preflight_persona_image", side_effect=image_failure),
            patch.object(task_service.video_storage, "require_r2_configuration"),
            patch.object(task_service, "generate_script", generate_script),
            patch.object(task_service, "track_generation_started"),
            patch.object(task_service, "_update_task"),
            patch.object(task_service, "_fail_task") as fail_task,
            patch.object(task_service, "_complete_task"),
            patch.object(task_service, "save_script_data"),
            patch.object(task_service, "cleanup_task_intermediates"),
        ):
            task_service.start("t-5", params, stop_at=stop_at)
        return generate_script, fail_task

    def test_bad_voice_fails_the_task_at_stage_voice_before_the_script(self):
        generate_script, fail_task = self._start(_params(voice_id="energetic"))
        generate_script.assert_not_called()
        self.assertEqual(fail_task.call_args.kwargs["stage"], "voice")
        self.assertIn("unknown voice 'energetic'", fail_task.call_args.args[1])

    def test_dead_image_still_fails_at_stage_persona_image(self):
        failure = longcat.LongCatError("persona image download failed: HTTP 404")
        generate_script, fail_task = self._start(_params(), image_failure=failure)
        generate_script.assert_not_called()
        self.assertEqual(fail_task.call_args.kwargs["stage"], "persona_image")

    def test_a_script_only_run_ignores_a_bad_voice(self):
        generate_script, fail_task = self._start(_params(voice_id="energetic"), stop_at="script")
        generate_script.assert_called_once()
        fail_task.assert_not_called()


if __name__ == "__main__":
    unittest.main()

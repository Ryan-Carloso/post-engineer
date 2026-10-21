"""Script retention structure: topic angle, hook/body/CTA prompt, CTA-safe trim."""

from unittest.mock import patch

import pytest

from app.config import config
from app.models.schema import PersonaParams, VideoParams
from app.services import llm, persona_hook
from app.services import task as task_service


def _persona_params(**overrides) -> VideoParams:
    return VideoParams(
        video_subject="café",
        video_language="pt-BR",
        persona=PersonaParams(
            name="Ana",
            photo_url="https://supabase.test/signed/foto.png",
            voice_id="calm",
            niche="barista caseiro",
        ),
        **overrides,
    )


class TestScriptPromptStructure:
    def test_default_prompt_asks_for_hook_body_and_cta(self):
        prompt = llm.build_script_prompt(video_subject="café")

        assert "1. hook: the very first sentence." in prompt
        assert "2. body: deliver exactly what the hook promised." in prompt
        assert "3. call to action: the very last sentence." in prompt

    def test_angle_line_is_added_when_present(self):
        prompt = llm.build_script_prompt(video_subject="café", angle="O erro que amarga o café")

        assert "- angle (build the hook and body around it): O erro que amarga o café" in prompt

    def test_no_angle_line_without_angle(self):
        assert "- angle" not in llm.build_script_prompt(video_subject="café")

    def test_generic_cta_instruction_without_explicit_cta(self):
        prompt = llm.build_script_prompt(video_subject="café")

        assert f"- call to action: {llm.DEFAULT_SCRIPT_CTA_INSTRUCTION}" in prompt

    def test_explicit_cta_replaces_generic_instruction(self):
        prompt = llm.build_script_prompt(video_subject="café", cta="Link na bio")

        assert "adapt the wording to the language): Link na bio" in prompt
        assert llm.DEFAULT_SCRIPT_CTA_INSTRUCTION not in prompt

    def test_partial_script_asks_for_no_cta(self):
        prompt = llm.build_script_prompt(video_subject="café", cta="Link na bio", include_cta=False)

        assert "- call to action: none, this is not the end of the video" in prompt
        assert "Link na bio" not in prompt

    def test_custom_system_prompt_still_gets_angle_and_cta(self):
        prompt = llm.build_script_prompt(
            video_subject="café",
            custom_system_prompt="Only write cinematic narration.",
            angle="Um ângulo",
        )

        assert "1. hook:" not in prompt
        assert "- angle (build the hook and body around it): Um ângulo" in prompt
        assert "- call to action:" in prompt


@pytest.mark.real_script_angle
class TestGenerateScriptAngle:
    def test_returns_first_clean_line(self):
        with patch.object(
            llm, "_generate_response_with_fallback", return_value='"O erro que amarga o café"\n\nExplicação'
        ) as generate:
            angle = llm.generate_script_angle("café", language="pt-BR", niche="barista")

        assert angle == "O erro que amarga o café"
        prompt = generate.call_args.kwargs["prompt"]
        assert "Topic: café" in prompt
        assert "Channel niche: barista" in prompt
        assert "Write the angle in this language: pt-BR" in prompt

    def test_empty_response_returns_empty(self):
        with patch.object(llm, "_generate_response_with_fallback", return_value="  \n "):
            assert llm.generate_script_angle("café", language="pt-BR") == ""

    def test_foreign_script_angle_is_discarded(self):
        with patch.object(llm, "_generate_response_with_fallback", return_value="O erro 咖啡"):
            assert llm.generate_script_angle("café", language="pt-BR") == ""

    def test_overlong_angle_is_capped(self):
        with patch.object(llm, "_generate_response_with_fallback", return_value="a" * 500):
            assert len(llm.generate_script_angle("café")) == llm.MAX_SCRIPT_ANGLE_LENGTH


class TestTaskAngleThreading:
    def test_angle_is_generated_once_and_reused_by_hook_and_body_regeneration(self):
        params = _persona_params()
        with (
            patch.object(task_service.llm, "generate_script_angle", return_value="O erro") as angle,
            patch.object(
                task_service.llm,
                "generate_script",
                side_effect=["One paragraph only.", "Hook is complete.", "Details follow."],
            ) as generate,
        ):
            result = task_service.generate_script("angle-task", params)

        assert result == "Hook is complete.\n\nDetails follow."
        angle.assert_called_once_with(video_subject="café", language="pt-BR", niche="barista caseiro")
        assert [c.kwargs["angle"] for c in generate.call_args_list] == ["O erro"] * 3
        # The regenerated hook is not the end of the video: no CTA there.
        assert generate.call_args_list[1].kwargs["include_cta"] is False
        assert "include_cta" not in generate.call_args_list[2].kwargs

    def test_ready_script_skips_angle_generation(self):
        params = _persona_params(video_script="Hook pronto.\n\nCorpo pronto.")
        with (
            patch.object(task_service.llm, "generate_script_angle") as angle,
            patch.object(task_service.llm, "generate_script") as generate,
        ):
            task_service.generate_script("ready-task", params)

        angle.assert_not_called()
        generate.assert_not_called()

    def test_angle_failure_falls_back_to_bare_topic_and_tracks(self):
        params = VideoParams(video_subject="café")
        with (
            patch.object(task_service.llm, "generate_script_angle", side_effect=RuntimeError("down")),
            patch.object(task_service.llm, "generate_script", return_value="Roteiro.") as generate,
            patch.object(task_service, "track_event") as track,
        ):
            assert task_service.generate_script("fallback-task", params) == "Roteiro."

        assert generate.call_args.kwargs["angle"] == ""
        assert track.call_args.args[0] == "script_angle_fallback"

    def test_usable_angle_emits_no_fallback_event(self):
        params = VideoParams(video_subject="café")
        with (
            patch.object(task_service.llm, "generate_script_angle", return_value="O erro"),
            patch.object(task_service.llm, "generate_script", return_value="Roteiro."),
            patch.object(task_service, "track_event") as track,
        ):
            task_service.generate_script("angle-ok-task", params)

        assert "script_angle_fallback" not in [c.args[0] for c in track.call_args_list]


class TestCtaSafeTrim:
    @pytest.fixture(autouse=True)
    def _budget(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setitem(config.app, "max_video_script_characters", 60)

    def test_short_script_is_untouched(self):
        assert persona_hook._limit_generated_script("Hook curto.\n\nSegue aí.") == "Hook curto.\n\nSegue aí."

    def test_overlong_body_is_trimmed_before_the_closing_cta(self):
        script = "Hook forte aqui.\n\nCorpo um longo. Corpo dois longo. Corpo três longo.\n\nSegue pra mais."
        result = persona_hook._limit_generated_script(script)

        assert len(result) <= 60
        assert result.startswith("Hook forte aqui.\n\nCorpo um longo.")
        assert result.endswith("Segue pra mais.")
        assert "Corpo três" not in result

    def test_cta_keeps_its_own_paragraph_when_only_the_hook_survives(self):
        script = "Hook forte aqui.\n\nCorpo bem longo que não cabe no orçamento todo. Segue pra mais."
        result = persona_hook._limit_generated_script(script)

        assert result == "Hook forte aqui.\n\nSegue pra mais."

    def test_single_sentence_falls_back_to_plain_cut(self):
        result = persona_hook._limit_generated_script("palavra " * 20)

        assert len(result) <= 60
        assert result.startswith("palavra")


class TestHookRegenerationContext:
    def test_regenerated_hook_sees_the_body_and_has_no_cta(self):
        params = _persona_params()
        script = "Hook antigo e longo demais.\n\nCorpo do vídeo. Segue pra mais."
        with patch.object(persona_hook.llm, "generate_script", return_value="Hook novo.") as generate:
            result = persona_hook._regenerate_fitting_hook("hook-task", params, script, 20.0)

        assert result == "Hook novo.\n\nCorpo do vídeo. Segue pra mais."
        kwargs = generate.call_args.kwargs
        assert kwargs["include_cta"] is False
        assert "remaining narration is: Corpo do vídeo. Segue pra mais." in kwargs["video_script_prompt"]

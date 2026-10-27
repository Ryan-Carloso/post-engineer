"""Script retention structure: topic angle, hook/body/CTA prompt, CTA-safe trim."""

from pathlib import Path
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
        # The default system prompt's structure rule 3 orders a closing CTA;
        # the partial-script prompt must explicitly disapply it.
        assert "the structure rule about ending with a call to action does not apply here" in prompt
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

    def test_provider_failure_sentinel_is_not_an_angle(self):
        # _generate_response_with_fallback reports total provider failure as
        # an "Error: ..." string instead of raising; it must never become
        # the angle (persisted, shown to the user, injected into prompts).
        with patch.object(
            llm, "_generate_response_with_fallback", return_value="Error: all providers down"
        ):
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

    def test_usable_angle_is_persisted_and_tracked_with_its_text(self):
        params = VideoParams(video_subject="café")
        with (
            patch.object(task_service.llm, "generate_script_angle", return_value="O erro"),
            patch.object(task_service.llm, "generate_script", return_value="Roteiro."),
            patch.object(task_service.sm, "persist_state_update") as persist,
            patch.object(task_service, "track_event") as track,
        ):
            task_service.generate_script("angle-ok-task", params)

        persist.assert_called_once_with(task_service.sm.state, "angle-ok-task", script_angle="O erro")
        events = {c.args[0]: c.args[1] for c in track.call_args_list}
        assert "script_angle_fallback" not in events
        assert events["script_angle_generated"]["angle"] == "O erro"
        assert events["script_angle_generated"]["task_id"] == "angle-ok-task"

    def test_tracked_angle_is_secret_scrubbed_but_persisted_raw(self):
        # The angle is model output: a credential-shaped fragment in it must
        # not reach PostHog, while the task record keeps the user's data.
        params = VideoParams(video_subject="café")
        with (
            patch.object(
                task_service.llm, "generate_script_angle", return_value="O erro token=supersecretvalue"
            ),
            patch.object(task_service.llm, "generate_script", return_value="Roteiro."),
            patch.object(task_service.sm, "persist_state_update") as persist,
            patch.object(task_service, "track_event") as track,
        ):
            task_service.generate_script("angle-secret-task", params)

        persist.assert_called_once_with(
            task_service.sm.state, "angle-secret-task", script_angle="O erro token=supersecretvalue"
        )
        events = {c.args[0]: c.args[1] for c in track.call_args_list}
        assert events["script_angle_generated"]["angle"] == "O erro token=[redacted]"

    def test_fallback_persists_no_angle(self):
        params = VideoParams(video_subject="café")
        with (
            patch.object(task_service.llm, "generate_script_angle", return_value=""),
            patch.object(task_service.llm, "generate_script", return_value="Roteiro."),
            patch.object(task_service.sm, "persist_state_update") as persist,
            patch.object(task_service, "track_event") as track,
        ):
            task_service.generate_script("angle-empty-task", params)

        persist.assert_not_called()
        assert "script_angle_generated" not in [c.args[0] for c in track.call_args_list]


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

    def test_tiny_head_budget_never_returns_an_overlong_script(self):
        # The closing sentence leaves head_budget == 1: re-cutting the head
        # for the forced paragraph separator used budget - 2 == -1, and
        # text[:-1] kept almost the whole head — the result blew the limit.
        closing = "C" * 57 + "."
        script = f"Hook forte aqui.\n\nCorpo longo. {closing}"
        result = persona_hook._limit_generated_script(script)

        assert len(result) <= 60
        # No body text fits next to the closing sentence, but the closing
        # sentence fits on its own — it is the CTA and must survive.
        assert result == closing

    def test_closing_sentence_survives_when_no_head_budget_remains(self):
        # head_budget < 0 (closing + paragraph separator exceed the limit)
        # while the closing sentence alone still fits: the plain-cut
        # fallback would end before it and drop the CTA.
        closing = "C" * 58 + "."
        script = f"Hook forte aqui.\n\n{closing}"
        result = persona_hook._limit_generated_script(script)

        assert result == closing


class TestTaskPromptOrdering:
    def test_contracts_precede_a_near_limit_user_prompt_in_task_script_prompts(self):
        # Same cap hazard as the hook retry: llm truncates video_script_prompt
        # to its first 2000 chars, so every contract task.py appends after the
        # user prompt would be cut away by a near-limit user prompt.
        params = _persona_params(video_script_prompt="u" * 1900)
        with (
            patch.object(task_service.llm, "generate_script_angle", return_value=""),
            patch.object(
                task_service.llm,
                "generate_script",
                side_effect=["One paragraph only.", "Hook is complete.", "Details follow."],
            ) as generate,
        ):
            task_service.generate_script("ordering-task", params)

        prompts = [call.kwargs["video_script_prompt"] for call in generate.call_args_list]
        assert "Start with a standalone hook paragraph" in prompts[0][: llm.MAX_SCRIPT_PROMPT_LENGTH]
        assert prompts[0].index("Start with a standalone hook paragraph") < prompts[0].index("u" * 100)
        assert "Return only the standalone first paragraph" in prompts[1][: llm.MAX_SCRIPT_PROMPT_LENGTH]
        assert prompts[1].index("Return only the standalone first paragraph") < prompts[1].index("u" * 100)
        assert "Return only the main content" in prompts[2][: llm.MAX_SCRIPT_PROMPT_LENGTH]
        assert prompts[2].index("Return only the main content") < prompts[2].index("u" * 100)


class TestPersonaCtaPlumbing:
    def test_persona_cta_reaches_the_main_script_and_the_body_regeneration(self):
        params = _persona_params(video_cta="Link na bio")
        with (
            patch.object(task_service.llm, "generate_script_angle", return_value="O erro"),
            patch.object(
                task_service.llm,
                "generate_script",
                side_effect=["One paragraph only.", "Hook is complete.", "Details follow."],
            ) as generate,
        ):
            task_service.generate_script("cta-task", params)

        calls = generate.call_args_list
        assert calls[0].kwargs["cta"] == "Link na bio"
        # The standalone hook is not the end of the video: no CTA there.
        assert "cta" not in calls[1].kwargs
        assert calls[2].kwargs["cta"] == "Link na bio"

    def test_video_cta_over_the_cap_is_rejected(self):
        with pytest.raises(ValueError):
            VideoParams(video_subject="café", video_cta="a" * 201)


def _repo_root() -> Path:
    # Walk up instead of counting parents: mutmut runs the suite from a
    # copied tree (mutants/), which shifts every fixed parent index and
    # made parents[4] point outside the checkout in CI.
    for parent in Path(__file__).resolve().parents:
        if (parent / "supabase/migrations/024_persona-cta.sql").is_file():
            return parent
    raise AssertionError("repo root not found from the test file location")


def test_cta_max_length_is_the_same_literal_everywhere():
    """DB check, web form cap, engine schema and prompt cap must agree."""
    repo = _repo_root()
    sql = (repo / "supabase/migrations/024_persona-cta.sql").read_text()
    web = (repo / "apps/web/lib/persona-schema.ts").read_text()
    schema = (repo / "apps/engine/app/models/schema.py").read_text()

    assert "char_length(cta_text) <= 200" in sql
    assert "char_length(post_cta_text) <= 200" in sql
    assert "export const PERSONA_CTA_MAX_LENGTH = 200;" in web
    assert 'video_cta: str = Field(default="", max_length=200)' in schema
    assert llm.MAX_SCRIPT_CTA_LENGTH == 200

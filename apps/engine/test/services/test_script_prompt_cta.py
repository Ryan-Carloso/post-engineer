"""Script retention structure: hook/body/CTA prompt, CTA-safe trim.

Kept from test_script_angle_cta.py when the script angle was removed
(Phase 5, PR 1): the LLM prompt-structure pins, the CTA-safe trim pins,
and the CTA length literal sync still cover code that stays. Every
angle-specific class went with script_angle.py.
"""

from pathlib import Path

import pytest

from app.config import config
from app.services import llm, persona_hook


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

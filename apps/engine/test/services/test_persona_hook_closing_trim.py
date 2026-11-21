"""Closing-take-safe trim pins for live persona_hook code.

Restored from test_script_prompt_cta.py (Phase 5 PR 5 review): that file
was deleted with the dead LLM prompt-structure tests, but its
TestClosingSafeTrim class and the CTA-length literal sync pin cover code that
stays — persona_hook._limit_generated_script runs on the persona-lipsync
path (task.py), and the 200 cap is mirrored across the DB check, the web
form cap, and the engine schema. The LLM prompt cap went with the
deleted LLM core (Phase 5 PR 6); only the
build_script_prompt tests went with the deleted controller.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.config import config
from app.services import persona_hook


class TestClosingSafeTrim:
    @pytest.fixture(autouse=True)
    def _budget(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setitem(config.app, "max_video_script_characters", 60)

    def test_short_script_is_untouched(self):
        assert persona_hook._limit_generated_script("Hook curto.\n\nSegue aí.") == "Hook curto.\n\nSegue aí."

    def test_overlong_content_is_trimmed_before_the_closing_take(self):
        script = "Hook forte aqui.\n\nCorpo um longo. Corpo dois longo. Corpo três longo.\n\nSegue pra mais."
        result = persona_hook._limit_generated_script(script)

        assert len(result) <= 60
        assert result.startswith("Hook forte aqui.\n\nCorpo um longo.")
        assert result.endswith("Segue pra mais.")
        assert "Corpo três" not in result

    def test_closing_take_keeps_its_own_paragraph_when_only_the_hook_survives(self):
        script = "Hook forte aqui.\n\nCorpo bem longo que não cabe no orçamento todo. Segue pra mais."
        result = persona_hook._limit_generated_script(script)

        assert result == "Hook forte aqui.\n\nSegue pra mais."

    def test_single_sentence_falls_back_to_plain_cut(self):
        result = persona_hook._limit_generated_script("palavra " * 20)

        assert len(result) <= 60
        assert result.startswith("palavra")

    def test_tiny_head_budget_never_returns_an_overlong_script(self):
        closing = "C" * 57 + "."
        script = f"Hook forte aqui.\n\nCorpo longo. {closing}"
        result = persona_hook._limit_generated_script(script)

        assert len(result) <= 60
        assert result == closing

    def test_closing_sentence_survives_when_no_head_budget_remains(self):
        closing = "C" * 58 + "."
        script = f"Hook forte aqui.\n\n{closing}"
        result = persona_hook._limit_generated_script(script)

        assert result == closing

    def test_multi_sentence_closing_paragraph_survives_whole(self):
        script = (
            "Hook forte aqui.\n\n"
            "Corpo um longo. Corpo dois longo. Corpo três longo.\n\n"
            "Ideia grande. Segue pra mais."
        )
        result = persona_hook._limit_generated_script(script)

        assert len(result) <= 60
        assert result == "Hook forte aqui.\n\nIdeia grande. Segue pra mais."
        assert "Corpo três" not in result

    def test_closing_paragraph_ships_alone_when_no_head_fits(self):
        closing = "Small study, big idea, start tonight. Follow HabitLoom now."
        script = f"Hook forte aqui.\n\n{closing}"
        result = persona_hook._limit_generated_script(script)

        assert result == closing

    def test_overlong_closing_paragraph_falls_back_to_last_sentence(self):
        script = (
            "Hook forte aqui.\n\n"
            "Corpo longo demais para caber neste orçamento curto. Segue pra mais."
        )
        result = persona_hook._limit_generated_script(script)

        assert len(result) <= 60
        assert result == "Hook forte aqui.\n\nSegue pra mais."

    def test_habitloom_shaped_script_keeps_full_closing_take_at_prod_limit(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.setitem(config.app, "max_video_script_characters", 600)
        hook = "Go to bed an hour earlier and lose more bodyweight, reports a brand new 2026 study now."
        content = (
            "Investigators followed 196 participants aged 21 to 64 with prediabetes who slept "
            "under six and a half hours a nighttime. "
            "For eight weeks everyone followed the same lifestyle intervention while tracking "
            "bedtimes and bodyweight. "
            "Every hour earlier they fell asleep meant zero point six kilograms more lost, "
            "without sleeping longer. "
            "But this is an association, not proof, so try this tonight, lights out one hour earlier."
        )
        closing = "Small study, big idea, start with sleep tonight. Follow HabitLoom for straightforward daily health habits."
        script = "\n\n".join([hook, content, closing])

        assert len(script.split()) == 98
        assert len(hook.split()) == 17
        assert len(content.split()) == 66
        assert len(closing.split()) == 15
        assert len(script) == 615

        result = persona_hook._limit_generated_script(script)

        assert len(result) <= 600
        assert result.endswith(closing)
        assert "Small study, big idea" in result
        assert "without sleeping longer" in result
        assert "lights out one hour earlier" not in result


def _repo_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "supabase/migrations/024_persona-cta.sql").is_file():
            return parent
    raise AssertionError("repo root not found from the test file location")


def test_cta_intent_literals_are_the_same_everywhere():
    """DB check, shared contract and engine enum must agree on the CTA intent."""
    repo = _repo_root()
    sql = (repo / "supabase/migrations/072_persona-cta-intent.sql").read_text()
    contract = (repo / "shared/contracts/personas.ts").read_text()
    cta = (repo / "apps/engine/app/models/cta.py").read_text()
    schema = (repo / "apps/engine/app/models/schema.py").read_text()

    types = "('follow', 'comment', 'share', 'save', 'link', 'buy', 'other')"
    assert f"cta_type in {types}" in sql
    assert f"post_cta_type in {types}" in sql
    assert "char_length(cta_url) <= 2048" in sql
    assert "char_length(cta_instruction) <= 500" in sql
    assert "drop column if exists cta_text" in sql
    assert "drop column if exists post_cta_text" in sql
    assert "PERSONA_CTA_TYPES = ['follow', 'comment', 'share', 'save', 'link', 'buy', 'other'] as const;" in contract
    assert "PERSONA_CTA_URL_MAX_LENGTH = 2048" in contract
    assert "PERSONA_CTA_INSTRUCTION_MAX_LENGTH = 500" in contract
    for name in ["follow", "comment", "share", "save", "link", "buy", "other"]:
        assert f'{name} = "{name}"' in cta
    assert "video_cta" not in schema
    assert "cta_type: Optional[CtaType] = None" in schema

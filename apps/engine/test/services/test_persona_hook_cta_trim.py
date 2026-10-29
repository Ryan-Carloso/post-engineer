"""CTA-safe trim pins for live persona_hook code.

Restored from test_script_prompt_cta.py (Phase 5 PR 5 review): that file
was deleted with the dead LLM prompt-structure tests, but its
TestCtaSafeTrim class and the CTA-length literal sync pin cover code that
stays — persona_hook._limit_generated_script runs on the persona-lipsync
path (task.py), and the 200 cap is mirrored across the DB check, the web
form cap, the engine schema, and the llm constant. Only the
build_script_prompt tests went with the deleted controller.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.config import config  # noqa: E402
from app.services import llm, persona_hook  # noqa: E402


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

"""script_claims: names and numbers in a script must come from its sources.

The script prompt forbids inventing names and numbers, and the model still
did it ("Casa Bill, since 1932", "ten euros less"). After the script is
written, every digit group, spelled number with a unit and proper name is
checked against the sources the model was given (subject, angle, CTA, user
requirements, web search results). Unsupported items trigger ONE rewrite
that names them; anything still unsupported ships anyway and is reported by
count only (a lookup quality pass never fails a video).
"""

from unittest.mock import MagicMock, patch

from app.services import script_claims
from app.services.script_claims import enforce, name_parts, proper_names, unsupported_claims

SOURCES = [
    "Where to eat the best francesinha in Porto",
    "Regaleira (Rua do Bandarim, 87) opened in 1953 and sells it for 11 euros.",
]


def test_number_missing_from_the_sources_is_flagged():
    assert unsupported_claims("It opened in 1932.", SOURCES) == ["1932"]


def test_number_in_the_sources_passes():
    assert unsupported_claims("It opened in 1953 for 11 euros.", SOURCES) == []


def test_spelled_number_with_a_unit_is_flagged_unless_the_sources_have_it():
    assert unsupported_claims("Save ten euros today.", SOURCES) == ["ten euros"]
    assert unsupported_claims("Pay eleven euros today.", SOURCES) == []
    assert unsupported_claims("Only one place does it.", SOURCES) == []


def test_name_missing_from_the_sources_is_flagged():
    assert unsupported_claims("Go to Casa Bill on the waterfront.", SOURCES) == ["Casa Bill"]


def test_name_in_the_sources_passes_ignoring_case_and_accents():
    assert unsupported_claims("Skip the queue and go to REGALEIRA in Porto.", SOURCES) == []
    assert unsupported_claims("Try Café Santiago today.", ["cafe santiago is popular"]) == []


def test_a_sentence_initial_single_word_is_not_judged():
    assert unsupported_claims("Locals love it. Santiago serves it too.", SOURCES) == []


def test_a_sentence_initial_multiword_name_is_judged_after_its_first_word():
    assert unsupported_claims("Casa Bill is the original.", SOURCES) == ["Bill"]


def test_items_are_unique_and_in_script_order():
    text = "It opened in 1932 at Casa Bill. Visit Casa Bill again."
    assert unsupported_claims(text, SOURCES) == ["1932", "Casa Bill"]


def test_clean_script_is_returned_untouched_without_calling_the_model():
    regenerate = MagicMock()
    assert enforce("Go to Regaleira.", SOURCES, regenerate) == "Go to Regaleira."
    regenerate.assert_not_called()


def test_an_unsupported_claim_triggers_one_rewrite_naming_the_items():
    regenerate = MagicMock(return_value="Go to Regaleira.")
    assert enforce("Go to Casa Bill since 1932.", SOURCES, regenerate) == "Go to Regaleira."
    regenerate.assert_called_once()
    note = regenerate.call_args.args[0]
    assert "Casa Bill" in note and "1932" in note


def test_a_rewrite_that_is_not_better_keeps_the_original():
    original = "Go to Casa Bill since 1932."
    regenerate = MagicMock(return_value="Go to Casa Bill since 1932 or Casa Joe.")
    assert enforce(original, SOURCES, regenerate) == original


def test_a_failing_or_empty_rewrite_keeps_the_original_and_never_raises():
    original = "Go to Casa Bill."
    assert enforce(original, SOURCES, MagicMock(side_effect=RuntimeError("llm down"))) == original
    assert enforce(original, SOURCES, MagicMock(return_value="  ")) == original


def test_leftover_claims_are_reported_once_by_count_only():
    with patch.object(script_claims, "track_event") as track:
        enforce("Go to Casa Bill.", SOURCES, MagicMock(return_value="Go to Casa Bill."))
    track.assert_called_once_with("script_unsupported_claims", {"count": 1})


def test_a_clean_rewrite_reports_nothing():
    with patch.object(script_claims, "track_event") as track:
        enforce("Go to Casa Bill.", SOURCES, MagicMock(return_value="Go to Regaleira."))
    track.assert_not_called()


def test_proper_names_lists_the_runs_with_their_position_and_tokens():
    names = proper_names("Go to Café Santiago in Ribeira. Locals love it.")
    assert [(text, tokens) for _, text, tokens in names] == [
        ("Café Santiago", ["Café", "Santiago"]),
        ("Ribeira", ["Ribeira"]),
    ]


def test_name_parts_are_folded_and_skip_short_words():
    assert name_parts("Café do Santiago") == ["cafe", "santiago"]

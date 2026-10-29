"""Mechanical broll terms fallback (Phase 5 PR 6).

The LLM core is deleted, so broll terms come from the calling agent or,
when the agent supplies too few, mechanically from the script itself:

- agent terms of 20+ are used untouched, with no warning;
- fewer than 20 agent terms are expanded to a target of 20 with words
  from the script (plus niche/subject combinations), deduplicated, and
  a warning is recorded;
- zero agent terms generate all terms from the script the same way,
  with an auto-generated warning;
- generated terms never invent words outside the script, the niche, or
  the subject (off-theme footage risk), and the target is best-effort:
  a short script yields fewer than 20 terms rather than invented ones.
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import terms_fallback

SCRIPT = (
    "Morning light over Porto riverside cafes. "
    "We taste warm francesinha sandwiches near busy Bolhao market stalls. "
    "Afternoon walks along Douro river bridges end with sweet custard tarts."
)
SUBJECT = "Porto food tour"
NICHE = "Porto gastronomy"


def _allowed_words(script=SCRIPT):
    words = set()
    for text in (script, SUBJECT, NICHE):
        words.update(re.findall(r"[^\W\d_][\w]*", text.casefold(), re.UNICODE))
    return words


def test_one_agent_term_expands_to_twenty_distinct_terms():
    terms, warning = terms_fallback.expand_terms(
        ["Porto street"], SCRIPT, SUBJECT, NICHE
    )
    assert len(terms) == 20
    assert len({term.casefold() for term in terms}) == 20
    assert terms[0] == "Porto street"
    assert warning == terms_fallback.TERMS_EXPANDED_WARNING


def test_zero_agent_terms_generate_all_terms_from_the_script():
    terms, warning = terms_fallback.expand_terms([], SCRIPT, SUBJECT, NICHE)
    assert len(terms) == 20
    assert warning == terms_fallback.TERMS_AUTO_GENERATED_WARNING
    allowed = _allowed_words()
    for term in terms:
        for word in re.findall(r"[^\W\d_][\w]*", term.casefold(), re.UNICODE):
            assert word in allowed, term


def test_twenty_or_more_agent_terms_are_used_untouched():
    supplied = [f"agent term {index}" for index in range(25)]
    terms, warning = terms_fallback.expand_terms(supplied, SCRIPT, SUBJECT, NICHE)
    assert terms == supplied
    assert warning is None


def test_exactly_twenty_agent_terms_are_used_untouched():
    supplied = [f"agent term {index}" for index in range(20)]
    terms, warning = terms_fallback.expand_terms(supplied, SCRIPT, SUBJECT, NICHE)
    assert terms == supplied
    assert warning is None


def test_agent_terms_keep_their_order_and_generated_terms_follow():
    terms, _warning = terms_fallback.expand_terms(
        ["Bolhao market", "Douro river"], SCRIPT, SUBJECT, NICHE
    )
    assert terms[0] == "Bolhao market"
    assert terms[1] == "Douro river"
    assert len(terms) == 20


def test_duplicate_agent_and_generated_terms_are_deduplicated():
    terms, _warning = terms_fallback.expand_terms(
        ["Porto street", "porto street", "Porto street"], SCRIPT, SUBJECT, NICHE
    )
    assert terms.count("Porto street") == 1
    assert len(terms) == len({term.casefold() for term in terms})


def test_generated_terms_never_invent_words_outside_script_subject_niche():
    terms, _warning = terms_fallback.expand_terms([], SCRIPT, SUBJECT, NICHE)
    allowed = _allowed_words()
    for term in terms:
        for word in re.findall(r"[^\W\d_][\w]*", term.casefold(), re.UNICODE):
            assert word in allowed, term


def test_string_agent_terms_split_like_the_old_route():
    terms, _warning = terms_fallback.expand_terms(
        "Porto street, Douro river", SCRIPT, SUBJECT, NICHE
    )
    assert terms[0] == "Porto street"
    assert terms[1] == "Douro river"


def test_non_string_or_list_agent_terms_fail_loudly():
    try:
        terms_fallback.expand_terms(42, SCRIPT, SUBJECT, NICHE)
    except ValueError as exc:
        assert "video_terms must be a string or a list of strings." in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_short_script_yields_fewer_terms_without_inventing_any():
    terms, warning = terms_fallback.expand_terms([], "Porto rain.", SUBJECT, NICHE)
    assert terms, "a non-empty script must still yield terms"
    assert len(terms) < 20
    assert warning == terms_fallback.TERMS_AUTO_GENERATED_WARNING
    allowed = _allowed_words("Porto rain.")
    for term in terms:
        for word in re.findall(r"[^\W\d_][\w]*", term.casefold(), re.UNICODE):
            assert word in allowed, term


def test_niche_and_subject_combinations_come_from_the_agent_context():
    # A short script leaves room for subject/niche combinations: the niche
    # word must pair with script words, never appear from nowhere.
    terms, _warning = terms_fallback.expand_terms([], "Porto rain.", SUBJECT, NICHE)
    assert any("gastronomy" in term.casefold() for term in terms)
    assert "porto porto" not in {term.casefold() for term in terms}

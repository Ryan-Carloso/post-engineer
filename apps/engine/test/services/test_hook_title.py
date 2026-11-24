"""Hook title text rules and their sync with the shared TypeScript limits."""

import re
from pathlib import Path

import pytest

from app.services import hook_title

SHARED = Path(__file__).resolve().parents[4] / "shared" / "script-segments" / "hook-title.ts"


def _shared_number(name: str) -> float:
    match = re.search(rf"export const {name} = ([0-9.]+);", SHARED.read_text(encoding="utf-8"))
    assert match is not None, f"{name} missing from the shared hook-title.ts"
    return float(match.group(1))


def _shared_code(key: str) -> str:
    match = re.search(rf"{key}: '(HOOK_TITLE_[A-Z_]+)'", SHARED.read_text(encoding="utf-8"))
    assert match is not None, f"{key} code missing from the shared hook-title.ts"
    return match.group(1)


def test_limits_match_the_shared_typescript_source():
    assert hook_title.HOOK_TITLE_MAX_WORDS == _shared_number("HOOK_TITLE_MAX_WORDS")
    assert hook_title.HOOK_TITLE_MAX_CHARS == _shared_number("HOOK_TITLE_MAX_CHARS")
    assert hook_title.HOOK_TITLE_SECONDS == _shared_number("HOOK_TITLE_SECONDS")


def test_codes_match_the_shared_typescript_source():
    assert hook_title.CODE_EMPTY == _shared_code("empty")
    assert hook_title.CODE_TOO_MANY_WORDS == _shared_code("tooManyWords")
    assert hook_title.CODE_TOO_LONG == _shared_code("tooLong")
    assert hook_title.CODE_INVALID_CHARS == _shared_code("invalidChars")


def test_a_title_at_exactly_the_limits_passes():
    assert hook_title.check_text("one two three four five six seven") == "one two three four five six seven"
    assert hook_title.check_text("a" * hook_title.HOOK_TITLE_MAX_CHARS) == "a" * hook_title.HOOK_TITLE_MAX_CHARS


def test_one_word_over_the_limit_is_refused():
    with pytest.raises(hook_title.HookTitleError) as caught:
        hook_title.check_text("one two three four five six seven eight")
    assert caught.value.code == hook_title.CODE_TOO_MANY_WORDS
    assert str(caught.value).startswith("HOOK_TITLE_TOO_MANY_WORDS: ")


def test_one_character_over_the_limit_is_refused():
    with pytest.raises(hook_title.HookTitleError) as caught:
        hook_title.check_text("a" * (hook_title.HOOK_TITLE_MAX_CHARS + 1))
    assert caught.value.code == hook_title.CODE_TOO_LONG


@pytest.mark.parametrize("value", ["", "   ", "  "])
def test_an_empty_or_blank_title_is_refused_not_treated_as_absent(value):
    with pytest.raises(hook_title.HookTitleError) as caught:
        hook_title.check_text(value)
    assert caught.value.code == hook_title.CODE_EMPTY


@pytest.mark.parametrize("value", ["two\nlines", "tab\there", "bell\x07", "carriage\rreturn"])
def test_a_newline_or_control_character_is_refused(value):
    with pytest.raises(hook_title.HookTitleError) as caught:
        hook_title.check_text(value)
    assert caught.value.code == hook_title.CODE_INVALID_CHARS


def test_the_title_keeps_punctuation_and_case_and_collapses_spaces():
    assert hook_title.check_text("I entered the sea clothed?") == "I entered the sea clothed?"
    assert hook_title.check_text("  A   B  ") == "A B"


def test_spaces_never_count_against_the_limits():
    assert hook_title.check_text(f"  {'a ' * 7} ") == "a a a a a a a"

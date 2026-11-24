"""The on-screen hook title (`hook_title`): a short headline over the first seconds.

The text rules mirror shared/script-segments/hook-title.ts (a file-parsing
test pins the literals), so the web API, the MCP and the engine refuse the
same title with the same stable code before any token is charged. A title is
a headline: punctuation and case are kept as written, only whitespace runs
are collapsed and the ends trimmed. A newline or any control character is
refused, because the engine decides where the two lines break.
"""

import re
import unicodedata

HOOK_TITLE_MAX_WORDS = 7
HOOK_TITLE_MAX_CHARS = 60
HOOK_TITLE_SECONDS = 3.0

CODE_EMPTY = "HOOK_TITLE_EMPTY"
CODE_TOO_MANY_WORDS = "HOOK_TITLE_TOO_MANY_WORDS"
CODE_TOO_LONG = "HOOK_TITLE_TOO_LONG"
CODE_INVALID_CHARS = "HOOK_TITLE_INVALID_CHARS"

_SPACES = re.compile(r"\s+")


class HookTitleError(ValueError):
    """A title that breaks a rule: `code` is the stable code, the message names the rule."""

    def __init__(self, code: str, rule: str) -> None:
        super().__init__(f"{code}: {rule}")
        self.code = code


def normalize(value: str) -> str:
    """Whitespace runs collapsed, ends trimmed; punctuation and case untouched."""
    return _SPACES.sub(" ", value).strip()


def check_text(value: str) -> str:
    """The normalized title, or HookTitleError for the first rule it breaks."""
    if any(unicodedata.category(char) == "Cc" for char in value):
        raise HookTitleError(CODE_INVALID_CHARS, "hook_title must not contain a newline or a control character.")
    text = normalize(value)
    if not text:
        raise HookTitleError(CODE_EMPTY, "hook_title must not be empty or only spaces.")
    if len(text) > HOOK_TITLE_MAX_CHARS:
        raise HookTitleError(CODE_TOO_LONG, f"hook_title must have at most {HOOK_TITLE_MAX_CHARS} characters.")
    if len(text.split(" ")) > HOOK_TITLE_MAX_WORDS:
        raise HookTitleError(CODE_TOO_MANY_WORDS, f"hook_title must have at most {HOOK_TITLE_MAX_WORDS} words.")
    return text

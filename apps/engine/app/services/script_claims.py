"""Names and numbers in a script must come from the sources it was given.

The script prompt forbids inventing names and numbers, and the model still
did it ("Casa Bill, since 1932", "ten euros less"). After the script is
written, every digit group, spelled number followed by a unit, and proper
name is checked against the sources the model saw (subject, angle, CTA, user
requirements, web search results). Unsupported items trigger ONE rewrite
that names them; whatever is still unsupported ships anyway and is reported
by count only: this is a quality pass and never fails a video.

Known limits, on purpose: a single capitalized word that opens a sentence
is not judged (it cannot be told from ordinary capitalization), spelled
numbers are English only, and wording such as "long queues" carries no name
or number, so only the prompt rules constrain it.
"""

import re
import unicodedata
from collections.abc import Callable, Sequence

from loguru import logger

from app.services.analytics import scrub_error_text, track_event

MAX_LISTED = 8

_NUMBER_WORDS = {
    "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
    "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40,
    "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
    "hundred": 100, "thousand": 1000,
}
_UNITS = (
    "euro", "euros", "dollar", "dollars", "minute", "minutes", "hour", "hours",
    "year", "years", "percent", "kilometer", "kilometers", "kilometre",
    "kilometres", "meter", "meters", "metre", "metres", "seat", "seats",
)

_DIGITS = re.compile(r"\d+(?:[.,]\d+)*")
_SPELLED = re.compile(
    r"\b(" + "|".join(_NUMBER_WORDS) + r")\s+(" + "|".join(_UNITS) + r")\b", re.IGNORECASE
)
_SENTENCE = re.compile(r"[^.!?…\n]+")
_TOKEN = re.compile(r"[^\W\d_][\w'’-]*")
_ALNUM = re.compile(r"[^\W_]+")

_NOTE = (
    "\n\n# Correction needed\n"
    "Your previous script mentioned names or numbers that the sources above do "
    "not support: {items}. Write the script again without them, keeping "
    "everything else, and mention only names, prices and numbers that the "
    "sources, the subject or the user requirements give."
)


def _fold(text: str) -> str:
    """Casefold and strip diacritics ("Café" ~ "cafe")."""
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def _digits_only(number: str) -> str:
    return re.sub(r"\D", "", number)


def _corpus(sources: Sequence[str]) -> tuple[set[str], set[str]]:
    text = _fold(" ".join(str(source) for source in sources if source))
    words = set(_ALNUM.findall(text))
    numbers = {_digits_only(match) for match in _DIGITS.findall(text)}
    for word in list(words):
        if word in _NUMBER_WORDS:
            numbers.add(str(_NUMBER_WORDS[word]))
    for digits in list(numbers):
        for name, value in _NUMBER_WORDS.items():
            if str(value) == digits:
                words.add(name)
    return words, numbers


def _token_supported(token: str, words: set[str]) -> bool:
    parts = [part for part in _ALNUM.findall(_fold(token)) if len(part) >= 3]
    return all(part in words for part in parts)


def _name_runs(sentence: str, start: int) -> list[tuple[int, str, list[str]]]:
    """Runs of capitalized words: (position, text, tokens)."""
    tokens = list(_TOKEN.finditer(sentence))
    runs: list[list[re.Match[str]]] = []
    for index, token in enumerate(tokens):
        if not token.group()[0].isupper():
            continue
        adjacent = (
            runs
            and runs[-1][-1] is tokens[index - 1]
            and not sentence[tokens[index - 1].end():token.start()].strip()
        )
        if adjacent:
            runs[-1].append(token)
        else:
            runs.append([token])
    found = []
    for run in runs:
        # The first word of a sentence is capitalized whatever it is.
        if run[0] is tokens[0]:
            run = run[1:]
        if run:
            text = sentence[run[0].start():run[-1].end()]
            found.append((start + run[0].start(), text, [token.group() for token in run]))
    return found


def _unsupported_names(sentence: str, start: int, words: set[str]) -> list[tuple[int, str]]:
    return [
        (position, text)
        for position, text, tokens in _name_runs(sentence, start)
        if not all(_token_supported(token, words) for token in tokens)
    ]


def fold_text(text: str) -> str:
    """Casefolded, accent-free text ("Café" -> "cafe")."""
    return _fold(text)


def name_parts(text: str) -> list[str]:
    """The folded words of a name that carry meaning (3+ letters)."""
    return [part for part in _ALNUM.findall(_fold(text)) if len(part) >= 3]


def proper_names(script: str) -> list[tuple[int, str, list[str]]]:
    """Proper names of a script as (position, text, tokens), in script order."""
    found: list[tuple[int, str, list[str]]] = []
    for sentence in _SENTENCE.finditer(script):
        found.extend(_name_runs(sentence.group(), sentence.start()))
    return found


def unsupported_claims(script: str, sources: Sequence[str]) -> list[str]:
    """Numbers and names of `script` that no source supports, in script order."""
    words, numbers = _corpus(sources)
    found: list[tuple[int, str]] = []
    for match in _DIGITS.finditer(script):
        if _digits_only(match.group()) not in numbers:
            found.append((match.start(), match.group()))
    for match in _SPELLED.finditer(script):
        spoken = match.group(1).lower()
        if spoken not in words and str(_NUMBER_WORDS[spoken]) not in numbers:
            found.append((match.start(), match.group()))
    for sentence in _SENTENCE.finditer(script):
        found.extend(_unsupported_names(sentence.group(), sentence.start(), words))
    unique: list[str] = []
    for _, text in sorted(found):
        if text not in unique:
            unique.append(text)
    return unique


def enforce(script: str, sources: Sequence[str], regenerate: Callable[[str], str]) -> str:
    """The script, rewritten once when it carries claims no source supports.

    `regenerate(note)` asks the model for a new script with `note` appended
    to the original prompt. The rewrite replaces the script only when it has
    fewer unsupported items; a failing or empty rewrite keeps the original.
    """
    flagged = unsupported_claims(script, sources)
    if not flagged:
        return script
    best, best_flagged = script, flagged
    try:
        rewrite = (regenerate(_NOTE.format(items=", ".join(flagged[:MAX_LISTED]))) or "").strip()
        if rewrite.startswith("Error:") or "Error: " in rewrite:
            raise ValueError("provider error rewrite")
    except Exception as exc:  # noqa: BLE001 - a quality pass never fails the script
        logger.warning(f"script rewrite for unsupported claims failed: {scrub_error_text(str(exc))}")
        rewrite = ""
    if rewrite:
        rewrite_flagged = unsupported_claims(rewrite, sources)
        if len(rewrite_flagged) < len(flagged):
            best, best_flagged = rewrite, rewrite_flagged
    if best_flagged:
        # Counts only: the items themselves are model output about user topics.
        logger.warning(f"script still has {len(best_flagged)} name/number claim(s) no source supports")
        track_event("script_unsupported_claims", {"count": len(best_flagged)})
    return best

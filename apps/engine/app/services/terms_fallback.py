"""Mechanical broll search terms: no LLM, no external API, no new dependency.

The calling agent (the agent writing the segments) supplies the broll
terms. When it supplies too few, this module expands them mechanically
from the script itself, so the stock download queue still has terms to
work with and no model is ever asked to invent footage topics:

- 20 or more agent terms are used verbatim, with no warning — including
  any duplicates the agent supplied: deduplication applies only to the
  expansion below, never to the verbatim path.
- Fewer than 20 agent terms are expanded to a target of 20, in this
  order: consecutive distinctive-word pairs from the script, then
  niche/subject combinations with script words, then single script
  words. The expansion is deduplicated (case-insensitive) against the
  agent terms and itself.
- Zero agent terms generate all terms from the script the same way.

Every generated term's words come only from the script, the niche, or
the subject: inventing a word risks off-theme footage. The target of
20 is best-effort — a short script yields fewer terms rather than
invented ones. The caller records the returned warning in the video
status; the script itself still fails loudly when missing (that check
lives in task.generate_script, never here).
"""

import re

from app.services.stock_terms import UNFILMABLE_WORDS

TARGET_TERM_COUNT = 20

TERMS_AUTO_GENERATED_WARNING = (
    "video terms were auto-generated from the script: "
    "the calling agent supplied none"
)
TERMS_EXPANDED_WARNING = (
    "video terms were expanded mechanically from the script: "
    "the calling agent supplied fewer than 20"
)

# Articles, prepositions, pronouns and auxiliaries (English, Portuguese,
# Spanish): words that carry no visual topic. Short tokens are already
# dropped by the length rule below; these are the longer ones.
STOPWORDS = frozenset(
    {
        "and", "are", "been", "but", "for", "from", "has", "have", "her",
        "his", "into", "its", "not", "our", "over", "she", "that", "the",
        "their", "then", "they", "this", "was", "were", "with", "you",
        "your", "about", "after", "along", "before", "between", "during",
        "near", "through", "under", "dos", "das", "nos", "nas", "uma",
        "uns", "umas", "para", "com", "sem", "que", "los", "las",
        "unos", "unas", "son", "sus", "del", "con", "sin", "sobre",
    }
)

_WORD_RE = re.compile(r"[^\W\d_][\w]*", re.UNICODE)
_SENTENCE_SPLIT_RE = re.compile(r"[.!?。！？\n]+")


def _is_distinctive(word: str) -> bool:
    """True for a word a camera topic can use: long enough, no digit,
    not a stopword, not abstract or meta."""
    return (
        len(word) >= 3
        and not any(char.isdigit() for char in word)
        and word not in STOPWORDS
        and word not in UNFILMABLE_WORDS
    )


def _distinctive_words(text: str) -> list[str]:
    """Distinctive words of `text` in order, deduplicated."""
    seen: set[str] = set()
    words: list[str] = []
    for word in _WORD_RE.findall((text or "").casefold()):
        if _is_distinctive(word) and word not in seen:
            seen.add(word)
            words.append(word)
    return words


def _sentence_word_runs(script: str) -> list[list[str]]:
    """Distinctive words per sentence, in script order.

    Pairs are built inside one sentence only, so a term never stitches
    the end of one sentence to the start of the next.
    """
    runs: list[list[str]] = []
    for sentence in _SENTENCE_SPLIT_RE.split(script or ""):
        words: list[str] = []
        seen: set[str] = set()
        for word in _WORD_RE.findall(sentence.casefold()):
            if _is_distinctive(word) and word not in seen:
                seen.add(word)
                words.append(word)
        if words:
            runs.append(words)
    return runs


def _normalize_agent_terms(agent_terms: str | list | None) -> list[str]:
    """Split and strip agent terms; anything else fails loudly."""
    if agent_terms is None:
        return []
    if isinstance(agent_terms, str):
        terms = [term.strip() for term in re.split(r"[,，]", agent_terms)]
    elif isinstance(agent_terms, list):
        terms = [term.strip() for term in agent_terms]
    else:
        raise ValueError("video_terms must be a string or a list of strings.")
    return [term for term in terms if term]


def expand_terms(
    agent_terms: str | list | None,
    script: str,
    subject: str = "",
    niche: str = "",
) -> tuple[list[str], str | None]:
    """Expand agent terms to a target of 20 from the script itself.

    Returns (terms, warning): warning is None when the agent supplied
    20 or more terms, TERMS_AUTO_GENERATED_WARNING when it supplied
    none, TERMS_EXPANDED_WARNING otherwise. Generated candidates are
    script bigrams, then niche/subject combinations with script words,
    then single script words — all deduplicated against the agent terms
    and each other, case-insensitively.
    """
    supplied = _normalize_agent_terms(agent_terms)
    if len(supplied) >= TARGET_TERM_COUNT:
        return supplied, None

    script_words = _distinctive_words(script)
    runs = _sentence_word_runs(script)
    context_words = _distinctive_words(f"{subject} {niche}")

    result: list[str] = []
    seen: set[str] = set()

    def _append(term: str) -> None:
        key = term.casefold()
        if key not in seen:
            seen.add(key)
            result.append(term)

    for term in supplied:
        _append(term)
    for run in runs:
        for first, second in zip(run, run[1:]):
            _append(f"{first} {second}")
    for word in script_words:
        for context in context_words:
            if context != word:
                _append(f"{context} {word}")
    for word in script_words:
        _append(word)

    warning = (
        TERMS_AUTO_GENERATED_WARNING
        if not supplied
        else TERMS_EXPANDED_WARNING
    )
    return result[:TARGET_TERM_COUNT], warning

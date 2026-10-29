"""Stock search terms: written to be filmed, and weak ones never reach the queue.

Stock search needs what a camera can see. Terms used to echo the
script's wording ("Porto Save Video", "francesinha original producer",
"Porto 1953 Location") and the adhesion filter kept those, because they
repeated a word of the subject: stock returned a 1953 poster, a statue and a
cosplayer. Terms with abstract, meta or numeric words are dropped, and
the mechanical fallback (terms_fallback) only builds terms from words
the script, niche or subject already contain.

Moved out of task.py, which is grandfathered over the file-size cap.
"""

import re

from loguru import logger

from app.models.schema import VideoParams

PERSONA_SELECTIVE_STOCK_MIN_SCORE = 0.3

# Words no camera can film: abstractions, the script's meta talk and call-to-action
# words. One list feeds the filter (so a term that slips through is dropped)
# and the mechanical fallback (so generated terms never contain them).
UNFILMABLE_WORDS = frozenset(
    {
        "birthplace", "channel", "comment", "follow", "history", "location", "mystery",
        "original", "producer", "save", "secret", "secrets", "share", "story",
        "subscribe", "tip", "tips", "trap", "traps", "video", "videos",
    }
)


def is_filmable(term: str) -> bool:
    """True when no word of `term` is abstract or meta, and none holds a digit."""
    for word in re.findall(r"[^\W_]+", term.casefold(), re.UNICODE):
        if word in UNFILMABLE_WORDS or any(char.isdigit() for char in word):
            return False
    return True


def stock_adhesion_score(term: str, subject: str) -> float:
    """Offline adhesion score between a stock search term and the subject.

    Deterministic token-overlap fallback used when TwelveLabs Marengo
    embeddings are unavailable: the share of the term's significant tokens
    (length >= 3, casefolded, unique) that also appear in the subject. A
    term with no significant tokens scores 0.0 — it says nothing the subject
    confirms, and weak terms are exactly what selective stock drops.
    """
    def tokens(text: str) -> set[str]:
        # Unicode-letter-initial tokens only; short tokens (a, de, o) carry
        # no adhesion signal.
        return {
            token
            for token in re.findall(r"[^\W\d_][\w]*", text.casefold(), re.UNICODE)
            if len(token) >= 3
        }

    term_tokens = tokens(term)
    if not term_tokens:
        return 0.0
    subject_tokens = tokens(subject)
    return len(term_tokens & subject_tokens) / len(term_tokens)


def filter_weak_stock_terms(
    params: VideoParams, video_terms: list[str], video_script: str = ""
) -> list[str]:
    """Drop stock terms that cannot be filmed or whose adhesion to the subject is low.

    Always on: weak stock never enters the download queue, so the timeline
    holds the persona/strong footage instead of swapping frames with
    off-topic B-roll. Terms the user wrote are never dropped for their
    wording (an explicit override), only generated ones are checked for
    filmability. If every term is filtered, the list before the adhesion
    check is kept: a video with some stock beats a task failure for lack of
    footage.

    Adhesion is measured against the subject AND the script: the model
    films "small cafe interior" for a script about a cafe without repeating a
    word of the subject, and a subject-only check dropped most good terms.
    A term related to neither is still dropped.
    """
    # Svg terms carry "a | b | c" alternatives whose generic fallbacks would
    # score as weak stock terms: the catalog path keeps them all.
    if params.faceless_material == "svg":
        return video_terms
    if not params.video_subject or len(video_terms) <= 1:
        return video_terms
    candidates = video_terms
    if not params.video_terms:
        filmable = [term for term in video_terms if is_filmable(term)]
        if filmable:
            candidates = filmable
    min_score = PERSONA_SELECTIVE_STOCK_MIN_SCORE
    context = f"{params.video_subject} {video_script}"
    kept = [
        term
        for term in candidates
        if stock_adhesion_score(term, context) >= min_score
    ]
    if not kept:
        logger.warning(
            "selective stock filtered every term; keeping the original list"
        )
        return candidates
    dropped = [term for term in video_terms if term not in kept]
    if dropped:
        # Log counts, not term content — terms are user-derived content.
        logger.info(
            f"selective stock kept {len(kept)}/{len(video_terms)} terms "
            f"(min score {min_score}); {len(dropped)} weak terms dropped"
        )
    return kept

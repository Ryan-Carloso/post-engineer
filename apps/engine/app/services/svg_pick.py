"""Keep only catalog drawings that fit their script moment — first match wins.

The LLM picker used to rate each moment's candidate drawings and keep only
the clear ones. It is gone: every moment now keeps its first title match.
That is a documented quality regression — a wrong first match (a guard at a
door, a traffic light) can reach the video again, where the picker would
have dropped it. A moment with no candidates is skipped, a drawing is never
pinned twice, and the choice stays pinned by catalog path (PIN_PREFIX), so
the download step renders exactly that drawing.
"""

from typing import List, Optional

from loguru import logger

from app.services import svg_catalog

PIN_PREFIX = "path:"


def pinned_path(term: str) -> Optional[str]:
    """Catalog path of a pinned term, or None for a search term."""
    if term.startswith(PIN_PREFIX):
        return term[len(PIN_PREFIX):]
    return None


def _alternatives(term: str) -> List[str]:
    # Local split (svg_terms imports this module): same "a | b | c" format.
    return [part.strip() for part in term.split("|") if part.strip()]


def pin_relevant(video_subject: str, video_script: str, terms: List[str]) -> List[str]:
    """Pinned terms for each moment's first catalog match, in script order."""
    if not svg_catalog.is_enabled():
        return terms
    pairs = [(term, svg_catalog.search_candidates(_alternatives(term))) for term in terms]
    pairs = [(term, candidates) for term, candidates in pairs if candidates]
    if not pairs:
        return terms
    moments = [candidates for _, candidates in pairs]
    pinned: List[str] = []
    for candidates in moments:
        term = f"{PIN_PREFIX}{candidates[0].relative_path}"
        if term not in pinned:
            pinned.append(term)
    # Counts only: titles derive from user content.
    logger.info(f"svg pick kept {len(pinned)} drawings for {len(moments)} moments")
    return pinned

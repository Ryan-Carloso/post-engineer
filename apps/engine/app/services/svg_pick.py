"""Keep only catalog drawings that fit their script moment.

A title match is not a fit: "tree", "road", an armoured man, a guard at a door
and a traffic light all matched words of a francesinha script. One LLM call
(text only) reads the script and, for each moment, the titles of its candidate
drawings, and rates them: 3 exactly what the moment says, 2 clearly shows it,
1 only loosely related. Clear drawings (2 and 3) are chosen, up to two per
moment; loose ones only top the list up to MIN_DRAWINGS, and a drawing nobody
rated never fills a gap. A moment with no clear drawing is dropped and its
neighbours hold longer (svg_terms.clip_seconds, up to SVG_CLIP_MAX_SECONDS).
The choice is pinned by catalog path (PIN_PREFIX), so the download step
renders exactly that drawing.

Never fails the task: a reply that stays unusable after one retry, or a
catalog with nothing even loosely related, falls back to each moment's first
title match.
"""

from typing import List, Optional, Tuple

from loguru import logger

from app.services import llm, svg_catalog
from app.services.analytics import scrub_error_text
from app.services.json_reply import first_json_array
from app.services.svg_catalog import SvgAsset

PIN_PREFIX = "path:"
# Two clear drawings per moment keep a long video varied.
MAX_PICKS_PER_MOMENT = 2
# A drawing scoring this or more is shown; lower scores are loose.
CLEAR_SCORE = 2
# Fewer distinct drawings than this and the timeline loops a few clips over
# the whole voice: a strict picker kept 3 for a 50s video and each repeated
# five times. 8 drawings of up to 6s cover a 48s voice (fit_to_audio thins
# the list again when the voice is short). Only LOOSE drawings top it up.
MIN_DRAWINGS = 8

_RETRY_NOTE = (
    "\n\n# Correction needed\n"
    "Your previous reply did not match the format. Return only a json-array of "
    "[moment, candidate_number, score] triples, for example [[0, 1, 3], [2, 0, 2]]."
)

Scored = List[List[Tuple[int, int]]]


def pinned_path(term: str) -> Optional[str]:
    """Catalog path of a pinned term, or None for a search term."""
    if term.startswith(PIN_PREFIX):
        return term[len(PIN_PREFIX):]
    return None


def _alternatives(term: str) -> List[str]:
    # Local split (svg_terms imports this module): same "a | b | c" format.
    return [part.strip() for part in term.split("|") if part.strip()]


def _prompt(
    video_subject: str, video_script: str, moments: List[List[SvgAsset]], topics: List[str]
) -> str:
    lines = []
    for index, (topic, candidates) in enumerate(zip(topics, moments)):
        titles = "; ".join(f"{n}: {asset.title}" for n, asset in enumerate(candidates))
        # The topic is what that moment of the script is about: without it the
        # picker guessed by order and a world map got through for a queue.
        lines.append(f"moment {index} (about: {' '.join(topic.split())}): {titles}")
    listing = "\n".join(lines)
    return f"""
# Role: Illustration Editor

## Goal:
For each moment of a short video, rate the drawings whose titles could show what
the script says at that moment.

## Rules:
1. return only a json-array of [moment, candidate_number, score] triples, nothing else.
2. list a candidate only when it relates to its moment, at most {MAX_PICKS_PER_MOMENT} per moment, best first;
   a moment with no related candidate has no triple.
3. score 3 = exactly what the moment says; 2 = clearly shows it (food for food, a clock for time,
   a map for a place); 1 = only loosely related. Never list an unrelated drawing.
4. a metaphor scores 1 at most: a road is not a queue, a traffic light is not a crowd, a taxi is not a
   trip. A loose word match, a tree or a random character scores 1 or is left out.
   Likewise a generic building, sign, street or book is not the specific place, opinion or story the moment talks about.
5. when in doubt, score lower: only a drawing you would put on screen deserves a 2 or a 3,
   and a repeated good drawing beats a weak new one.

## Video Subject
{video_subject}

## Video Script
{video_script}

## Candidates
{listing}
""".strip()


def _is_valid_triple(entry: object, moments: List[List[SvgAsset]]) -> bool:
    if not isinstance(entry, (list, tuple)) or len(entry) != 3:
        return False
    moment, number, score = entry
    if any(isinstance(value, bool) or not isinstance(value, int) for value in entry):
        return False
    return 0 <= moment < len(moments) and 0 <= number < len(moments[moment]) and 1 <= score <= 3


def _parse(response: str, moments: List[List[SvgAsset]]) -> Optional[Scored]:
    """Per-moment (candidate_number, score) pairs, or None when there is no list at all.

    Triples name their own moment, so a reply is never judged by how many
    moments it covers (counting nested arrays was the fragile part: models
    drop or add one). An invalid triple (out of range, score outside 1-3,
    not three integers) is skipped; an empty list is a valid "nothing fits".
    """
    reply = first_json_array(response)
    if reply is None:
        logger.warning("svg pick reply has no json array")
        return None
    scored: Scored = [[] for _ in moments]
    for entry in reply:
        if _is_valid_triple(entry, moments):
            moment, number, score = entry
            scored[moment].append((number, score))
    return scored


def _ask_picker(prompt: str, moments: List[List[SvgAsset]]) -> Optional[Scored]:
    """The picker's ratings, asking once more when the first reply is unusable."""
    for attempt in range(2):
        text = prompt if attempt == 0 else prompt + _RETRY_NOTE
        try:
            scored = _parse(llm._generate_response_with_fallback(text), moments)
        except Exception as exc:  # the picker is a quality pass, never a failure
            logger.warning(f"svg pick call failed: {scrub_error_text(str(exc))}")
            scored = None
        if scored is not None:
            return scored
    return None


def _top_up(
    picks: List[List[int]], loose: List[List[int]], moments: List[List[SvgAsset]], minimum: int
) -> List[List[int]]:
    """Moments without a clear drawing get their best LOOSE one until `minimum` drawings.

    Script order is kept: each added drawing sits at its own moment. Only
    drawings the picker rated (score 1) qualify: the floor used to take the
    first match of an empty moment, and that is how a guard at a door and a
    traffic light reached the video.
    """
    topped = [list(moment_picks) for moment_picks in picks]
    used = {moments[i][n].relative_path for i, moment_picks in enumerate(topped) for n in moment_picks}
    added = 0
    for index, loose_numbers in enumerate(loose):
        if len(used) >= minimum:
            break
        if topped[index]:
            continue
        for number in loose_numbers:
            path = moments[index][number].relative_path
            if path not in used:
                topped[index] = [number]
                used.add(path)
                added += 1
                break
    if added:
        logger.info(f"svg pick topped up {added} moment(s) with loose drawings to reach {len(used)}")
    return topped


def _choose(scored: Scored, moments: List[List[SvgAsset]], minimum: int) -> List[List[int]]:
    ranked = [sorted(entries, key=lambda entry: -entry[1]) for entries in scored]
    clear = [[n for n, score in entries if score >= CLEAR_SCORE][:MAX_PICKS_PER_MOMENT] for entries in ranked]
    loose = [[n for n, score in entries if score < CLEAR_SCORE] for entries in ranked]
    if not any(clear):
        # Nothing clearly fits: show the loosely related ones rather than nothing.
        return [numbers[:1] for numbers in loose]
    return _top_up(clear, loose, moments, minimum)


def pin_relevant(video_subject: str, video_script: str, terms: List[str]) -> List[str]:
    """Pinned terms for the drawings that fit their moment, in script order."""
    if not svg_catalog.is_enabled():
        return terms
    pairs = [(term, svg_catalog.search_candidates(_alternatives(term))) for term in terms]
    pairs = [(term, candidates) for term, candidates in pairs if candidates]
    if not pairs:
        return terms
    topics = [term for term, _ in pairs]
    moments = [candidates for _, candidates in pairs]
    scored = _ask_picker(_prompt(video_subject, video_script, moments, topics), moments)
    picks: List[List[int]] = []
    if scored is None:
        logger.warning("svg pick unusable after a retry; keeping each moment's first match")
    else:
        picks = _choose(scored, moments, MIN_DRAWINGS)
        if not any(picks):
            logger.warning("svg pick found nothing related; keeping each moment's first match")
    if not any(picks):
        picks = [[0]] * len(moments)
    pinned: List[str] = []
    for moment_picks, candidates in zip(picks, moments):
        for pick in moment_picks:
            term = f"{PIN_PREFIX}{candidates[pick].relative_path}"
            if term not in pinned:
                pinned.append(term)
    # Counts only: titles derive from user content.
    logger.info(f"svg pick kept {len(pinned)} drawings for {len(moments)} moments")
    return pinned

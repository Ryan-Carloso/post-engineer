"""An LLM keeps the stock terms that belong to the video's world.

Counting words shared with the subject and the script was the wrong test for
concrete scenes: "chopped hamburger meat", "melting cheese sauce" and "thick
bread slice" are exactly what a francesinha video films, and none of them
repeats a word of the subject or the script, so the overlap filter dropped 6 of
8 terms and the b-roll dug deep into a few searches. One cheap call asks which
terms show footage that belongs to the video. Terms with abstract or meta words
never reach it (stock_terms.is_filmable), and the word-overlap filter stays as
the fallback when the model cannot be used. Terms the user wrote skip it: an
explicit override is never second-guessed.
"""

from typing import List, Optional

from loguru import logger

from app.models.schema import VideoParams
from app.services import llm, stock_terms
from app.services.analytics import scrub_error_text
from app.services.json_reply import first_json_array

_RETRY_NOTE = (
    "\n\n# Correction needed\n"
    "Your previous reply did not match the format. Return only a json-array of numbers, "
    "for example [0, 2]."
)


def _prompt(video_subject: str, video_script: str, terms: List[str]) -> str:
    listing = "\n".join(f"{index}: {term}" for index, term in enumerate(terms))
    return f"""
# Role: Stock Footage Editor

## Goal:
A short video needs stock footage. Decide which search terms would show footage that
belongs to the video's world.

## Rules:
1. return only a json-array of the numbers of the terms to keep, nothing else.
2. keep a term when what the camera would see belongs to the video's world: the subject's
   food, places, people and objects, or the scenes the script describes.
3. drop a term that would show something from a different topic.

## Video Subject
{video_subject}

## Video Script
{video_script}

## Terms
{listing}
""".strip()


def _ask_judge(video_subject: str, video_script: str, terms: List[str]) -> Optional[List[int]]:
    """Indexes of the terms to keep, asking once more when the first reply is unusable."""
    prompt = _prompt(video_subject, video_script, terms)
    for attempt in range(2):
        try:
            reply = first_json_array(
                llm._generate_response_with_fallback(prompt if attempt == 0 else prompt + _RETRY_NOTE)
            )
        except Exception as exc:  # the judge is a quality pass, never a failure
            logger.warning(f"stock term judge call failed: {scrub_error_text(str(exc))}")
            reply = None
        if reply is not None:
            return sorted(
                {
                    entry
                    for entry in reply
                    if isinstance(entry, int) and not isinstance(entry, bool) and 0 <= entry < len(terms)
                }
            )
    return None


def select_terms(params: VideoParams, video_terms: List[str], video_script: str) -> List[str]:
    """The stock terms worth searching, in their original order."""
    if params.faceless_material == "svg" or len(video_terms) <= 1:
        return video_terms
    if params.video_terms or not params.video_subject:
        return stock_terms.filter_weak_stock_terms(params, video_terms, video_script)
    filmable = [term for term in video_terms if stock_terms.is_filmable(term)] or list(video_terms)
    kept = _ask_judge(params.video_subject, video_script, filmable)
    if kept is None:
        logger.warning("stock term judge unusable; filtering by shared words instead")
        return stock_terms.filter_weak_stock_terms(params, video_terms, video_script)
    result = [filmable[index] for index in kept] or filmable
    # Counts only: terms derive from user topics.
    logger.info(f"stock term judge kept {len(result)}/{len(video_terms)} terms")
    return result

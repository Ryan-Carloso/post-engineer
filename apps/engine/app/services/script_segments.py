"""Mechanical validation for the script-segments contract.

One call = one video. ``segments`` is a list whose first segment is the
hook, whose last segment is the CTA, and whose middle segments are the
body. Validation here is mechanical only: shape, forbidden content,
word counts, and the hook word guard. It never calls an LLM, never
calls a TTS service, and never fixes the input silently: the first
failed rule raises ``SegmentValidationError`` with the field, the rule,
and how to fix it.

Hook duration is a separate, measured check. Word counts alone cannot
prove a hook lasts 8-12 seconds, so ``check_hook_duration`` validates a
measured duration (from a real TTS run, which lives outside this
module), and ``measure_hook_duration`` runs an injected synthesizer
once, after the word guard, so a hook that already fails the guard
never spends a TTS call. The hook window constants come from
``app.services.persona_hook``: 8-12 seconds, target 20-30 words.
"""

import re
from typing import Any, Callable, Sequence

from app.services.persona_hook import (
    PERSONA_HOOK_MAX_SECONDS,
    PERSONA_HOOK_MIN_SECONDS,
)

MAX_SEGMENTS = 12
MAX_MEDIAS = 6
MIN_TOTAL_WORDS = 60
MAX_TOTAL_WORDS = 200
MIN_BODY_WORDS = 30
MIN_CTA_WORDS = 5
MAX_CTA_WORDS = 20
MIN_HOOK_WORDS = 15
MAX_HOOK_WORDS = 40
MAX_TERMS_PER_SEGMENT = 10

_TERMINAL_PUNCTUATION = (".", "!", "?", "。", "！", "？")
# Emoji code points, checked by ordinal, not by a regex character class.
# CodeQL py/overly-large-range flags astral ranges inside a regex class,
# and a suppression comment only covers the line it precedes, so a class
# with three flagged ranges cannot be suppressed with one comment. This
# tuple is exactly the old class's set (1F300-1FAFF, 2600-27BF,
# 1F000-1F2FF, plus FE0F), so nothing previously rejected becomes
# accepted and nothing previously accepted becomes rejected.
_EMOJI_RANGES = (
    (0x1F300, 0x1FAFF),
    (0x2600, 0x27BF),
    (0x1F000, 0x1F2FF),
    (0xFE0F, 0xFE0F),
)


def _contains_emoji(text: str) -> bool:
    return any(
        start <= ord(char) <= end
        for char in text
        for start, end in _EMOJI_RANGES
    )


_PLACEHOLDERS = ("[insira", "[insert", "todo", "lorem")


class SegmentValidationError(ValueError):
    """A 400-style validation failure: field, rule, and how to fix it."""

    def __init__(self, field: str, rule: str, fix: str) -> None:
        super().__init__(f"{field}: {rule} Fix: {fix}")
        self.field = field
        self.rule = rule
        self.fix = fix


def _word_count(text: str) -> int:
    return len(text.split())


def _normalized(text: str) -> str:
    return re.sub(r"[^\w\s]", "", text.casefold()).strip()


def _check_text_content(text: str, field: str) -> None:
    lowered = text.casefold()
    if any(marker in lowered for marker in _PLACEHOLDERS):
        raise SegmentValidationError(
            field,
            "Text contains a placeholder.",
            "Replace the placeholder with finished spoken text.",
        )
    if "http://" in lowered or "https://" in lowered or "www." in lowered:
        raise SegmentValidationError(
            field,
            "Text contains a link.",
            "Move links to the post caption; spoken text must contain no links.",
        )
    if "**" in text or "__" in text or "`" in text:
        raise SegmentValidationError(
            field,
            "Text contains markdown.",
            "Remove markdown formatting; spoken text must be plain text.",
        )
    if re.search(r"(?m)^\s*#", text):
        raise SegmentValidationError(
            field,
            "Text contains markdown.",
            "Remove markdown formatting; spoken text must be plain text.",
        )
    if _contains_emoji(text):
        raise SegmentValidationError(
            field,
            "Text contains an emoji.",
            "Remove emojis; spoken text must contain no emojis.",
        )
    if "[" in text or "]" in text:
        raise SegmentValidationError(
            field,
            "Text contains a bracketed stage direction or placeholder.",
            "Remove bracketed text; spoken text must contain no stage directions.",
        )


def _check_media(media: Any, field: str) -> int:
    if not isinstance(media, dict):
        raise SegmentValidationError(
            field, "Media must be an object.", "Send media as { mediaId } or { url }."
        )
    media_id = media.get("mediaId")
    url = media.get("url")
    if media_id is not None and url is not None:
        raise SegmentValidationError(
            field,
            "Media has both mediaId and url.",
            "Send only one of mediaId or url for a segment.",
        )
    if media_id is None and url is None:
        raise SegmentValidationError(
            field,
            "Media has neither mediaId nor url.",
            "Send mediaId for an uploaded file or url for a direct image URL.",
        )
    if media_id is not None and (not isinstance(media_id, str) or not media_id.strip()):
        raise SegmentValidationError(
            field, "mediaId must be a non-empty string.", "Send a non-empty mediaId."
        )
    if url is not None and (not isinstance(url, str) or not url.strip()):
        raise SegmentValidationError(
            field, "url must be a non-empty string.", "Send a non-empty image URL."
        )
    return 1


def validate_segments(segments: Any) -> dict[str, Any]:
    """Validate segments in rule order and return the normalized result.

    Rule order is deliberate: shape, then forbidden content, then hook
    punctuation, then repetition, then per-part word counts, then the
    total, then segment/media caps, then media shape. A caller that
    fixes the first reported error and resubmits converges without
    guessing.
    """
    if not isinstance(segments, list) or not segments:
        raise SegmentValidationError(
            "segments",
            "Segments must be a non-empty list.",
            "Send at least a hook, one body segment, and a CTA.",
        )
    kinds: list[str] = []
    texts: list[str] = []
    for index, segment in enumerate(segments):
        field = f"segments.{index}"
        if not isinstance(segment, dict):
            raise SegmentValidationError(
                field, "Segment must be an object.", "Send each segment as { kind, text }."
            )
        unknown = sorted(set(segment) - {"kind", "text", "media", "terms"})
        if unknown:
            raise SegmentValidationError(
                field,
                f"Segment has unknown field {unknown[0]}.",
                "Remove unknown fields from the segment.",
            )
        kind = segment.get("kind")
        if kind not in ("hook", "body", "cta"):
            raise SegmentValidationError(
                f"{field}.kind",
                "Segment kind must be hook, body, or cta.",
                "Set kind to hook for the first segment, body for the middle, cta for the last.",
            )
        kinds.append(kind)
        text = segment.get("text")
        if not isinstance(text, str) or not text.strip():
            raise SegmentValidationError(
                f"{field}.text",
                "Segment text must be a non-empty string.",
                "Write the spoken text for this segment.",
            )
        texts.append(text.strip())
        _check_text_content(text, f"{field}.text")
        terms = segment.get("terms")
        if terms is not None:
            if (
                not isinstance(terms, list)
                or len(terms) > MAX_TERMS_PER_SEGMENT
                or any(not isinstance(term, str) or not term.strip() for term in terms)
            ):
                raise SegmentValidationError(
                    f"{field}.terms",
                    "Terms must be a list of non-empty strings.",
                    "Send terms as a short list of non-empty search terms.",
                )
    if kinds[0] != "hook":
        raise SegmentValidationError(
            "segments.0.kind",
            "The first segment must be the hook.",
            "Move the hook segment to position 0.",
        )
    if kinds[-1] != "cta":
        raise SegmentValidationError(
            f"segments.{len(segments) - 1}.kind",
            "The last segment must be the CTA.",
            "Move the CTA segment to the last position.",
        )
    if kinds.count("hook") != 1:
        raise SegmentValidationError(
            "segments",
            "There must be exactly one hook.",
            "Keep a single hook segment, first.",
        )
    if kinds.count("cta") != 1:
        raise SegmentValidationError(
            "segments",
            "There must be exactly one CTA.",
            "Keep a single CTA segment, last.",
        )
    body_indices = [i for i, kind in enumerate(kinds) if kind == "body"]
    if not body_indices:
        raise SegmentValidationError(
            "segments",
            "There must be at least one body segment.",
            "Add at least one body segment between the hook and the CTA.",
        )
    hook_text = texts[0]
    if not hook_text.endswith(_TERMINAL_PUNCTUATION):
        raise SegmentValidationError(
            "segments.0.text",
            "The hook must end with terminal punctuation.",
            "End the hook with a period, exclamation mark, or question mark.",
        )
    seen: dict[str, int] = {}
    for index, text in enumerate(texts):
        normalized = _normalized(text)
        if normalized in seen:
            raise SegmentValidationError(
                f"segments.{index}.text",
                "Segment text repeats an earlier segment.",
                "Rewrite the repeated segment so each segment is distinct.",
            )
        seen[normalized] = index
    body_words = sum(_word_count(texts[i]) for i in body_indices)
    if body_words < MIN_BODY_WORDS:
        raise SegmentValidationError(
            f"segments.{body_indices[0]}.text",
            f"Body must have at least {MIN_BODY_WORDS} words.",
            "Add body words until the body reaches 30 words.",
        )
    cta_index = len(segments) - 1
    cta_words = _word_count(texts[cta_index])
    if cta_words < MIN_CTA_WORDS or cta_words > MAX_CTA_WORDS:
        raise SegmentValidationError(
            f"segments.{cta_index}.text",
            f"CTA must have {MIN_CTA_WORDS} to {MAX_CTA_WORDS} words.",
            "Shorten or lengthen the CTA to 5-20 words.",
        )
    hook_words = _word_count(hook_text)
    if hook_words < MIN_HOOK_WORDS or hook_words > MAX_HOOK_WORDS:
        raise SegmentValidationError(
            "segments.0.text",
            f"Hook must have {MIN_HOOK_WORDS} to {MAX_HOOK_WORDS} words before TTS.",
            "Shorten or lengthen the hook to 15-40 words, aiming for 20-30 words.",
        )
    total_words = sum(_word_count(text) for text in texts)
    if total_words < MIN_TOTAL_WORDS or total_words > MAX_TOTAL_WORDS:
        raise SegmentValidationError(
            "segments",
            f"Total must have {MIN_TOTAL_WORDS} to {MAX_TOTAL_WORDS} words.",
            "Shorten or lengthen the script to 60-200 words in total.",
        )
    if len(segments) > MAX_SEGMENTS:
        raise SegmentValidationError(
            "segments",
            f"At most {MAX_SEGMENTS} segments are allowed.",
            "Merge segments until there are at most 12.",
        )
    media_count = 0
    for index, segment in enumerate(segments):
        if "media" in segment and segment["media"] is not None:
            media_count += _check_media(segment["media"], f"segments.{index}.media")
    if media_count > MAX_MEDIAS:
        raise SegmentValidationError(
            "segments",
            f"At most {MAX_MEDIAS} medias are allowed.",
            "Remove medias until there are at most 6.",
        )
    body_texts = [texts[i] for i in body_indices]
    return {
        "hook_text": hook_text,
        "body_texts": body_texts,
        "cta_text": texts[cta_index],
        "total_words": total_words,
        "body_words": body_words,
        "hook_words": hook_words,
        "cta_words": cta_words,
        "segment_count": len(segments),
        "media_count": media_count,
    }


def segments_to_script(segments: Sequence[dict[str, Any]]) -> str:
    """Validate and join segment texts into the single spoken script.

    This function runs the full mechanical validation itself and raises
    SegmentValidationError on the first failed rule, then joins hook,
    body paragraphs, and CTA with blank lines, which is the paragraph
    layout the existing TTS and subtitle pipeline reads.
    """
    validated = validate_segments(list(segments))
    parts = [validated["hook_text"], *validated["body_texts"], validated["cta_text"]]
    return "\n\n".join(parts)


def check_hook_duration(hook_text: str, measured_seconds: float) -> dict[str, Any]:
    """Validate a measured hook duration against the 8-12 second window."""
    if measured_seconds < PERSONA_HOOK_MIN_SECONDS or measured_seconds > PERSONA_HOOK_MAX_SECONDS:
        raise SegmentValidationError(
            "segments.0.text",
            f"Hook measured {measured_seconds:g}s, outside the "
            f"{PERSONA_HOOK_MIN_SECONDS:g}-{PERSONA_HOOK_MAX_SECONDS:g}s window.",
            f"Shorten or lengthen the hook until it measures "
            f"{PERSONA_HOOK_MIN_SECONDS:g}-{PERSONA_HOOK_MAX_SECONDS:g}s when spoken.",
        )
    return {"hook_text": hook_text, "measured_seconds": measured_seconds}


def measure_hook_duration(
    hook_text: str,
    synthesizer: Callable[[str], float],
) -> dict[str, Any]:
    """Measure a hook with an injected synthesizer, once, after the guard.

    The synthesizer is a callable taking the hook text and returning its
    spoken duration in seconds (for example, a wrapper around the local
    CPU TTS that synthesizes only the hook and reads the audio duration).
    It is injected, not imported, so this module never touches a TTS
    backend, a network call, or a Modal job, and tests can stub it.
    """
    words = _word_count(hook_text)
    if words < MIN_HOOK_WORDS or words > MAX_HOOK_WORDS:
        raise SegmentValidationError(
            "segments.0.text",
            f"Hook must have {MIN_HOOK_WORDS} to {MAX_HOOK_WORDS} words before TTS.",
            "Shorten or lengthen the hook to 15-40 words, aiming for 20-30 words.",
        )
    measured = synthesizer(hook_text)
    return check_hook_duration(hook_text, measured)

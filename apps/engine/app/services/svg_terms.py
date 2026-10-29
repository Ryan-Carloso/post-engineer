"""Catalog search terms for svg mode, the first-match drawing pick, 4-6s clips and coverage.

The catalog only knows concrete things (hens, waiters, plates) while a
script talks about "franzinhas" or "structural collapse". Each svg term is
one script moment with up to MAX_ALTERNATIVES alternatives, specific to
generic, joined by SEPARATOR ("francesinha | sandwich plate | food"): the
catalog tries them in order (svg_catalog.search_best), so a right generic
drawing beats a wrong specific one. The persona niche and the subject close
the list, so a sparse catalog still has an on-topic drawing to show.

Lives in its own module because task.py is grandfathered over
the file-size cap.
"""

import math
import re

from loguru import logger

from app.models.schema import VideoParams
from app.services import svg_pick, voice
from app.services.analytics import track_event

SEPARATOR = "|"
MAX_ALTERNATIVES = 3
# Every drawing lasts between these: long enough for the pencil to draw at
# a calm pace, and when the picker keeps few drawings each holds longer,
# but never past the ceiling (a sparse catalog then loops, reported below).
SVG_CLIP_MIN_SECONDS = 4
SVG_CLIP_MAX_SECONDS = 6
# Below this share of the voiceover covered by distinct drawings, the
# timeline loops the same few drawings: reported, never fatal.
SVG_COVERAGE_MIN = 0.5
def parse_alternatives(term: str) -> list[str]:
    """Split one svg term into its trimmed, non-empty alternatives."""
    alternatives = [part.strip() for part in term.split(SEPARATOR)]
    return [part for part in alternatives if part][:MAX_ALTERNATIVES]


def _fallback_term(params: VideoParams) -> str:
    niche = params.persona.niche.strip() if params.persona is not None else ""
    subject = (params.video_subject or "").strip()
    return f" {SEPARATOR} ".join(part for part in (niche, subject) if part)


def resolve_svg_terms(params: VideoParams, video_script: str) -> list[str]:
    """Svg terms in script order, closed by the niche/subject fallback.

    User-supplied terms are kept as given (comma-separated string or list);
    otherwise only the fallback remains, which still finds on-topic
    drawings or ends in the caller's neutral clip — never a task failure
    here.
    """
    user_terms = params.video_terms
    if isinstance(user_terms, str) and user_terms.strip():
        terms = [term.strip() for term in re.split(r"[,，]", user_terms) if term.strip()]
    elif isinstance(user_terms, list) and user_terms:
        terms = [term.strip() for term in user_terms if term.strip()]
    else:
        terms = []
    fallback = _fallback_term(params)
    if fallback:
        terms.append(fallback)
    # Count only: terms are user-derived content.
    logger.info(f"svg terms: {len(terms)} moments")
    return svg_pick.pin_relevant(params.video_subject, video_script, terms)


def clip_seconds(params: VideoParams, drawings: int = 0, audio_seconds: float = 0.0) -> int | None:
    """Per-clip duration: svg drawings share the voiceover, 4-6s each."""
    if params.faceless_material != "svg":
        return params.video_clip_duration
    if drawings <= 0 or audio_seconds <= 0:
        return SVG_CLIP_MIN_SECONDS
    share = math.ceil(audio_seconds / drawings)
    return min(max(share, SVG_CLIP_MIN_SECONDS), SVG_CLIP_MAX_SECONDS)


def fit_to_audio(terms: list[str], audio_seconds: float) -> list[str]:
    """Thin the drawings evenly so each gets at least SVG_CLIP_MIN_SECONDS.

    The download keeps clips in order until the voiceover is covered, so
    extra drawings were cut from the end and every later drawing ran late
    against the voice. Thinning evenly keeps the first and last moments.
    """
    room = int(audio_seconds // SVG_CLIP_MIN_SECONDS)
    if audio_seconds <= 0 or len(terms) <= room or room < 1:
        return terms
    if room == 1:
        return terms[:1]
    last = len(terms) - 1
    return [terms[round(index * last / (room - 1))] for index in range(room)]


def combine_clip_seconds(params: VideoParams, drawings: int, audio_file: str) -> int | None:
    """clip_seconds for the combine step, which knows the audio file only."""
    if params.faceless_material != "svg":
        return params.video_clip_duration
    return clip_seconds(params, drawings, voice.get_audio_duration(audio_file))


def report_coverage(task_id: str, drawings: int, clip_seconds: int, audio_seconds: float) -> None:
    """Track an svg video whose distinct drawings cover too little audio."""
    if audio_seconds <= 0:
        return
    coverage = drawings * clip_seconds / audio_seconds
    if coverage >= SVG_COVERAGE_MIN:
        return
    logger.warning(
        f"svg coverage low: {drawings} drawings cover {coverage:.0%} of the "
        "voiceover; the timeline loops them"
    )
    track_event(
        "svg_coverage_low",
        {"task_id": task_id, "drawings": drawings, "coverage": round(coverage, 2)},
    )

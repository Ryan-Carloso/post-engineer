"""Coverage for the "images" material: the agent's photos are the whole picture.

Every segment carries an image (validated before charging), and each photo
is on screen for its segment's spoken interval (user_media). Two things can
still leave a gap after TTS: the short pauses between segments, and a photo
that is dropped (download failed, too small, could not be drawn). Nothing
tops a gap up with fetched footage, so the neighbour photo covers it:

- the first full-frame photo starts where the face hands over (0 on a
  faceless video, the hook's end on a hook-only persona video);
- every photo runs until the next one starts;
- the last photo runs to the end of the audio.

A gap longer than a normal pause is reported as a task warning. When no
full-frame photo survives the task fails with IMAGES_DO_NOT_COVER_AUDIO
(the charger refunds a failed task). On a full lip-sync video the face is
on screen the whole time, so there is nothing to cover.

The density minimum (one photo per ~3s of speech per segment) is also
enforced on the photos that actually survived: a segment that kept too
few fails the same way, even when one photo remains to stretch over the
audio. Either failure names the skip reasons — how many photos were
sent, how many survived, the counts per reason, and every skipped photo
by segment and image index — so the caller fixes the photos instead of
guessing that more photos are needed.

Full-frame photos also get a slow zoom (Ken Burns, panel_motion), alternating
in and out, so a photo held for several seconds never looks frozen.
"""

from collections import Counter
from dataclasses import replace
from typing import Optional, Sequence

from app.services import image_density, segment_panels
from app.services.segment_panels import Panel

IMAGES_DO_NOT_COVER_AUDIO = "images_do_not_cover_audio"
# A pause between two segments is well under this; a longer gap means a photo is missing.
GAP_WARNING_SECONDS = 1.0
REASON_GAP_COVERED = "a neighbour image covers a missing image"
MOTION_IN = "in"
MOTION_OUT = "out"
# A skip line records a photo that never became a panel; an overlay line
# records only a dropped info card on a photo that survived.
_SKIP_MARKER = " media skipped: "


class ImagesDoNotCoverAudio(Exception):
    """No full-frame image survived, or too few survived to cover a segment.

    The message is the stable code plus a detail naming the skip
    reasons, so the caller can fix the photos instead of guessing:
    "images_do_not_cover_audio: no full-frame image survived; 4 sent,
    0 survived, 4 skipped (download blocked x2, ...); segment 0 image 0
    media skipped: download blocked; ...". With no detail the bare code
    is unchanged.
    """

    def __init__(self, detail: str = "") -> None:
        message = (
            IMAGES_DO_NOT_COVER_AUDIO if not detail else f"{IMAGES_DO_NOT_COVER_AUDIO}: {detail}"
        )
        super().__init__(message)


def _skip_summary(sent: int, survived: int, skipped: Sequence[str]) -> tuple[str, list[str]]:
    """("N sent, M survived, K skipped (reason xN, ...)", [fatal skip lines])."""
    fatal = [line for line in skipped if _SKIP_MARKER in line]
    reasons = Counter(line.split(_SKIP_MARKER, 1)[1] for line in fatal)
    summary = f"{sent} sent, {survived} survived, {len(fatal)} skipped"
    if reasons:
        summary += " (" + ", ".join(
            f"{reason} x{count}" for reason, count in reasons.most_common()
        ) + ")"
    return summary, fatal


def survivor_shortfalls(panels: Sequence[Panel], words_per_segment: Sequence[int]) -> list[str]:
    """Per-segment density shortfalls among the surviving photos.

    One photo per ~3s of speech (image_density.min_images), counted
    across every surviving panel of the segment — a framed panel over
    the face counts for its segment just like a full-frame photo.
    """
    counts: dict[int, int] = {}
    for panel in panels:
        counts[panel.index] = counts.get(panel.index, 0) + 1
    shortfalls = []
    for index, words in enumerate(words_per_segment):
        need = image_density.min_images(words)
        have = counts.get(index, 0)
        if have < need:
            image = "image" if have == 1 else "images"
            needed = "image" if need == 1 else "images"
            shortfalls.append(
                f"segment {index} has {have} surviving {image} but needs at least {need} {needed} (one per ~3s)"
            )
    return shortfalls


def failure_detail(
    *,
    sent: int,
    survived: int,
    skipped: Sequence[str],
    shortfalls: Sequence[str],
    no_full_frame: bool,
) -> str:
    """The detail for an ImagesDoNotCoverAudio: shortfalls, counts, every skip."""
    summary, fatal = _skip_summary(sent, survived, skipped)
    parts = ["no full-frame image survived"] if no_full_frame else []
    parts.extend(shortfalls)
    parts.append(summary)
    parts.extend(fatal)
    return "; ".join(parts)


def ensure_coverage(
    panels: Sequence[Panel],
    *,
    face: str,
    hook_end: float,
    audio_duration: float,
    words_per_segment: Sequence[int],
    sent: int,
    skipped: Sequence[str],
) -> tuple[list[Panel], list[str]]:
    """Extend surviving panels over the coverage window, or fail naming why.

    Density (one photo per ~3s per segment) is enforced on survivors in
    the images modes (faceless and hook-only lip sync); full lip sync
    shows the face the whole time, so media is optional there and no
    density applies. Small gaps (at most GAP_WARNING_SECONDS) still
    stretch with a warning, never a failure. Returns the covered panels
    and the gap warnings. Raises ImagesDoNotCoverAudio with the
    aggregated skip reasons when no full-frame photo survived or a
    segment kept too few.
    """
    window_start = coverage_start(face, hook_end)
    shortfalls = (
        [] if face == segment_panels.FACE_FULL else survivor_shortfalls(panels, words_per_segment)
    )
    try:
        covered, gap_warnings = extend_over_gaps(panels, window_start, audio_duration)
    except ImagesDoNotCoverAudio:
        raise ImagesDoNotCoverAudio(
            failure_detail(
                sent=sent,
                survived=len(panels),
                skipped=skipped,
                shortfalls=shortfalls,
                no_full_frame=True,
            )
        ) from None
    if shortfalls:
        raise ImagesDoNotCoverAudio(
            failure_detail(
                sent=sent,
                survived=len(panels),
                skipped=skipped,
                shortfalls=shortfalls,
                no_full_frame=False,
            )
        )
    return covered, gap_warnings


def coverage_start(face: str, hook_end: float) -> Optional[float]:
    """Where the photos must start covering, or None when the face fills the video."""
    if face == segment_panels.FACE_FULL:
        return None
    if face == segment_panels.FACE_HOOK:
        return max(0.0, hook_end)
    return 0.0


def extend_over_gaps(
    panels: Sequence[Panel], window_start: Optional[float], audio_duration: float
) -> tuple[list[Panel], list[str]]:
    """Panels whose full-frame photos cover [window_start, audio_duration], plus warnings.

    Framed panels (shown over the face, caption_bottom set) keep their own
    times. Raises ImagesDoNotCoverAudio when there is a window to cover and
    no full-frame photo survived.
    """
    if window_start is None or window_start >= audio_duration:
        return list(panels), []
    framed = [panel for panel in panels if panel.caption_bottom is not None]
    full = sorted((panel for panel in panels if panel.caption_bottom is None), key=lambda panel: panel.start)
    if not full:
        raise ImagesDoNotCoverAudio()
    covered: list[Panel] = []
    warnings: list[str] = []
    for position, panel in enumerate(full):
        start = min(panel.start, window_start) if position == 0 else panel.start
        end = full[position + 1].start if position + 1 < len(full) else audio_duration
        end = max(end, panel.end)
        if (panel.start - start) > GAP_WARNING_SECONDS or (end - panel.end) > GAP_WARNING_SECONDS:
            warnings.append(f"segment {panel.index} image extended: {REASON_GAP_COVERED}")
        motion = MOTION_IN if position % 2 == 0 else MOTION_OUT
        covered.append(replace(panel, start=start, end=end, motion=motion))
    return sorted([*framed, *covered], key=lambda panel: panel.start), warnings

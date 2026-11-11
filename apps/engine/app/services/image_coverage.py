"""Coverage for the "images" material: the agent's photos are the whole picture.

Every segment carries an image (validated before charging), and each photo
is on screen for its segment's spoken interval (user_media). Two things can
still leave a gap after TTS: the short pauses between segments, and a photo
that is dropped (download failed, too small, could not be drawn). A dropped
photo is never covered: in the images modes it fails the task (see below).
Only the pauses between surviving photos are stretched over:

- the first full-frame photo starts where the face hands over (0 on a
  faceless video, the hook's end on a hook-only persona video);
- every surviving photo runs until the next one starts;
- the last photo runs to the end of the audio.

A gap is just a pause: stretching a panel over it needs no warning.

Every sent photo must survive. If any photo is skipped at render, the
task fails with IMAGES_DO_NOT_COVER_AUDIO (the charger refunds a failed
task), naming how many photos were sent, how many survived, the counts
per reason, and every skipped photo by segment and image index — so the
caller fixes the photo instead of guessing. The pre-charge density
minimum (one photo per ~3s per segment) already guarantees enough photos
are sent; this rule guarantees none of them die on the way. Together
they guarantee coverage. On a full lip-sync video the face is on screen
the whole time, so photos are optional panels there: a skipped photo is
a warning, never a failure.

Full-frame photos also get a slow zoom (Ken Burns, panel_motion), alternating
in and out, so a photo held for several seconds never looks frozen.
"""

from collections import Counter
from dataclasses import replace
from typing import Optional, Sequence

from app.services import segment_panels
from app.services.segment_panels import Panel

IMAGES_DO_NOT_COVER_AUDIO = "images_do_not_cover_audio"
MOTION_IN = "in"
MOTION_OUT = "out"
# A skip line records a photo that never became a panel; an overlay line
# records only a dropped info card on a photo that survived.
_SKIP_MARKER = " media skipped: "


class ImagesDoNotCoverAudio(Exception):
    """A sent photo did not survive render, or no full-frame image survived.

    The message is the stable code plus a detail naming the skip
    reasons, so the caller can fix the photos instead of guessing:
    "images_do_not_cover_audio: 3 sent, 2 survived, 1 skipped
    (download blocked x1); segment 0 image 1 media skipped: download
    blocked". With no detail the bare code is unchanged.
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


def failure_detail(
    *,
    sent: int,
    survived: int,
    skipped: Sequence[str],
    no_full_frame: bool,
) -> str:
    """The detail for an ImagesDoNotCoverAudio: counts and every skip."""
    summary, fatal = _skip_summary(sent, survived, skipped)
    parts = ["no full-frame image survived"] if no_full_frame else []
    parts.append(summary)
    parts.extend(fatal)
    return "; ".join(parts)


def ensure_coverage(
    panels: Sequence[Panel],
    *,
    face: str,
    hook_end: float,
    audio_duration: float,
    sent: int,
    skipped: Sequence[str],
) -> list[Panel]:
    """Extend surviving panels over the coverage window, or fail naming why.

    In the images modes (faceless and hook-only lip sync) every sent
    photo must survive: any skipped photo fails the task with the
    aggregated skip reasons. Full lip sync shows the face the whole
    time, so media is optional there and a skipped photo never fails.
    Raises ImagesDoNotCoverAudio with the aggregated skip reasons when
    a photo was skipped or no full-frame photo survived.
    """
    window_start = coverage_start(face, hook_end)
    _summary, fatal = _skip_summary(sent, len(panels), skipped)
    has_full = any(panel.caption_bottom is None for panel in panels)
    if face != segment_panels.FACE_FULL and (fatal or not has_full):
        raise ImagesDoNotCoverAudio(
            failure_detail(
                sent=sent, survived=len(panels), skipped=skipped, no_full_frame=not has_full
            )
        )
    return extend_over_gaps(panels, window_start, audio_duration)


def coverage_start(face: str, hook_end: float) -> Optional[float]:
    """Where the photos must start covering, or None when the face fills the video."""
    if face == segment_panels.FACE_FULL:
        return None
    if face == segment_panels.FACE_HOOK:
        return max(0.0, hook_end)
    return 0.0


def extend_over_gaps(
    panels: Sequence[Panel], window_start: Optional[float], audio_duration: float
) -> list[Panel]:
    """Panels whose full-frame photos cover [window_start, audio_duration].

    Framed panels (shown over the face, caption_bottom set) keep their own
    times. Raises ImagesDoNotCoverAudio when there is a window to cover and
    no full-frame photo survived.
    """
    if window_start is None or window_start >= audio_duration:
        return list(panels)
    framed = [panel for panel in panels if panel.caption_bottom is not None]
    full = sorted((panel for panel in panels if panel.caption_bottom is None), key=lambda panel: panel.start)
    if not full:
        raise ImagesDoNotCoverAudio()
    covered: list[Panel] = []
    for position, panel in enumerate(full):
        start = min(panel.start, window_start) if position == 0 else panel.start
        end = full[position + 1].start if position + 1 < len(full) else audio_duration
        end = max(end, panel.end)
        motion = MOTION_IN if position % 2 == 0 else MOTION_OUT
        covered.append(replace(panel, start=start, end=end, motion=motion))
    return sorted([*framed, *covered], key=lambda panel: panel.start)

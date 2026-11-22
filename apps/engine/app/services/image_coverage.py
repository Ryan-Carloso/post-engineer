"""Coverage for the "images" material: the agent's photos are the whole picture.

Every segment carries an image (validated before charging), and each photo
is on screen for at most its cap — MAX_PHOTO_SECONDS by default, or its
requested duration (see below). The surviving photos are laid
out back to back from the coverage window start: a photo may start early
into the pause before its segment, but it never runs past the next photo's
start or past start + its cap — except a requested photo, which runs its
seconds even past the next photo's original slice start. When the photos run out before
the end of the audio the task fails with IMAGES_DO_NOT_COVER_AUDIO naming
how many more photos the window needs, so the caller sends more photos
instead of one photo being stretched over the gap. A dropped photo is
never covered either: in the images modes it fails the task (see below).

- the first full-frame photo starts where the face hands over (0 on a
  faceless video, the hook's end on a hook-only persona video);
- every surviving photo runs at most its cap, back to back;
- the last photo runs to the end of the audio, or the task fails.

Every sent photo must survive. If any photo is skipped at render, the
task fails with IMAGES_DO_NOT_COVER_AUDIO (the charger refunds a failed
task), naming how many photos were sent, how many survived, the counts
per reason, and every skipped photo by segment and image index — so the
caller fixes the photo instead of guessing. The pre-charge density
minimum (one photo per ~3s per segment) catches grossly under-covered
requests before charging; the layout below is the exact guarantee at
render, because the density estimate counts words while the render counts
spoken seconds. On a full lip-sync video the face is on screen the whole
time, so photos are optional panels there: a skipped photo is a warning,
never a failure.

A photo may carry a requested duration (seconds on screen): the agent
holds the turning-point photo longer or flashes one briefly instead of
every photo ticking at the same 2s pace. A requested photo runs its
seconds even past the next photo's original slice start, and the next
photo starts when it ends. A photo without a request keeps the old
pacing: at most MAX_PHOTO_SECONDS, never past the next photo's start —
unless its own slice already covers its cap, in which case the next
photo's start no longer paces it (a requested photo before it may have
shifted the grid). Requested seconds never stretch a photo to cover a
gap: short requests still fail naming the missing photos, and a request
that leaves a later photo no time at all fails naming that photo.

Full-frame photos also get a slow zoom (Ken Burns, panel_motion), alternating
in and out by default or picking a direction from the variation seed, so a
still photo never looks frozen.

A video clip (segment_video) covers its take instead: it loops to fill
its slice, at most MAX_CLIP_LOOPS plays, and never zooms — it already
moves. A clip that loops out still leaves the window short, and the
task fails naming the gap, exactly like a missing photo.
"""

import math
import random
from collections import Counter
from dataclasses import replace
from typing import Optional, Sequence

from app.services import segment_panels, segment_video
from app.services.segment_panels import Panel
from app.services.segment_photo_duration import photo_cap

IMAGES_DO_NOT_COVER_AUDIO = "images_do_not_cover_audio"
MOTION_IN = "in"
MOTION_OUT = "out"
MAX_PHOTO_SECONDS = 2.0
_COVERAGE_EPSILON_SECONDS = 0.01
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


def _photo_motion(position: int, rng: Optional[random.Random]) -> str:
    """Zoom direction for one full-frame photo: the fixed alternation, or the seed's pick."""
    if rng is None:
        return MOTION_IN if position % 2 == 0 else MOTION_OUT
    return rng.choice((MOTION_IN, MOTION_OUT))


def ensure_coverage(
    panels: Sequence[Panel],
    *,
    face: str,
    hook_end: float,
    audio_duration: float,
    sent: int,
    skipped: Sequence[str],
    variation_seed: Optional[int] = None,
) -> list[Panel]:
    """Lay surviving panels over the coverage window, or fail naming why.

    In the images modes (faceless and hook-only lip sync) every sent
    photo must survive: any skipped photo fails the task with the
    aggregated skip reasons. Full lip sync shows the face the whole
    time, so media is optional there and a skipped photo never fails.
    Raises ImagesDoNotCoverAudio with the aggregated skip reasons when
    a photo was skipped or no full-frame photo survived, and when the
    surviving photos run out before the end of the audio at their caps.
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
    return extend_over_gaps(panels, window_start, audio_duration, variation_seed=variation_seed)


def coverage_start(face: str, hook_end: float) -> Optional[float]:
    """Where the photos must start covering, or None when the face fills the video."""
    if face == segment_panels.FACE_FULL:
        return None
    if face == segment_panels.FACE_HOOK:
        return max(0.0, hook_end)
    return 0.0


def extend_over_gaps(
    panels: Sequence[Panel],
    window_start: Optional[float],
    audio_duration: float,
    variation_seed: Optional[int] = None,
) -> list[Panel]:
    """Panels whose full-frame photos cover [window_start, audio_duration].

    Framed panels (shown over the face, caption_bottom set) keep their own
    times. Full-frame photos are laid out back to back from window_start,
    at most MAX_PHOTO_SECONDS each — or their requested duration, when the
    agent asked one photo to hold longer or flash briefly. A photo may
    start early into the pause before its segment, but it never runs past
    the next photo's start or past start + its cap, unless its own slice
    already covers the cap (then a requested photo before it may have
    shifted the grid). Raises ImagesDoNotCoverAudio when there is a
    window to cover and no full-frame photo survived, when the surviving
    photos run out before the end of the audio, naming how many more
    photos the window needs, and when a requested duration leaves a
    later photo no time at all.
    """
    if window_start is None or window_start >= audio_duration:
        return list(panels)
    framed = [panel for panel in panels if panel.caption_bottom is not None]
    full = sorted(
        (panel for panel in panels if panel.caption_bottom is None), key=lambda panel: panel.start
    )
    if not full:
        raise ImagesDoNotCoverAudio()
    requested_any = any(panel.requested_duration is not None for panel in full)
    covered: list[Panel] = []
    cursor = window_start
    photo_position = 0
    rng = random.Random(variation_seed) if variation_seed is not None else None
    for position, panel in enumerate(full):
        start = cursor
        if panel.clip_seconds is not None:
            limit = full[position + 1].start if position + 1 < len(full) else audio_duration
            if limit <= start:
                limit = audio_duration
            cap = min(panel.end - panel.start, segment_video.MAX_CLIP_LOOPS * panel.clip_seconds)
            end = min(limit, start + cap)
            motion = None
        else:
            cap = photo_cap(panel.requested_duration, MAX_PHOTO_SECONDS)
            if panel.requested_duration is not None:
                end = min(audio_duration, start + cap)
            else:
                limit = full[position + 1].start if position + 1 < len(full) else audio_duration
                own_slice = panel.end - panel.start
                if own_slice >= MAX_PHOTO_SECONDS:
                    limit = audio_duration
                elif limit <= start:
                    limit = audio_duration
                end = min(limit, start + cap)
            if end <= start:
                raise ImagesDoNotCoverAudio(
                    "requested durations leave no time for "
                    f"photo {position + 1} of {len(full)} (segment {panel.index})"
                )
            motion = _photo_motion(photo_position, rng)
            photo_position += 1
        covered.append(replace(panel, start=start, end=end, motion=motion))
        cursor = end
    if cursor < audio_duration - _COVERAGE_EPSILON_SECONDS:
        missing = math.ceil((audio_duration - cursor) / MAX_PHOTO_SECONDS)
        if any(panel.clip_seconds is not None for panel in full):
            count_word = "item" if len(full) == 1 else "items"
            cover_verb = "covers" if len(full) == 1 else "cover"
            missing_word = "photo" if missing == 1 else "photos"
            raise ImagesDoNotCoverAudio(
                f"{len(full)} {count_word} {cover_verb} {cursor - window_start:.1f}s of "
                f"{audio_duration - window_start:.1f}s; "
                f"need {missing} more {missing_word} or video clips"
            )
        photo_word = "photo" if len(full) == 1 else "photos"
        cover_verb = "covers" if len(full) == 1 else "cover"
        missing_word = "photo" if missing == 1 else "photos"
        pace = "requested durations" if requested_any else f"{MAX_PHOTO_SECONDS:.0f}s each"
        raise ImagesDoNotCoverAudio(
            f"{len(full)} {photo_word} {cover_verb} {cursor - window_start:.1f}s of "
            f"{audio_duration - window_start:.1f}s at {pace}; "
            f"need {missing} more {missing_word}"
        )
    return sorted([*framed, *covered], key=lambda panel: panel.start)

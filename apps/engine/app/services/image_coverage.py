"""Coverage for the "images" material: the agent's photos are the whole picture.

Every segment carries an image (validated before charging), and each
segment's real spoken time is shared among its photos in proportion to
their weights (image_density.media_weights: the requested duration, or
the 2s pace). The surviving photos are laid out back to back from the
coverage window start: each photo holds until the next photo's slice
starts — so it may start early into the pause before its segment and
absorb the pause after it — and the last photo runs to the end of the
audio.

A requested duration is a weight fitted to the real voice, not absolute
seconds: the request was validated against a words-per-second estimate,
and the real TTS audio is often shorter or longer. Shorter audio
compresses every photo of the segment in proportion, so no photo is ever
squeezed out. Longer audio stretches them, up to FIT_STRETCH times their
pace (fitted_photo_cap). Only a gap beyond that stretch fails the task
with IMAGES_DO_NOT_COVER_AUDIO naming how many more photos the window
needs: the request really had too few photos.

- the first full-frame photo starts where the face hands over (0 on a
  voiceover video, the hook's end on a hook-only persona video);
- every surviving photo holds its fitted slice, back to back;
- the last photo runs to the end of the audio, or the task fails.

Every sent photo must survive. If any photo is skipped at render, the
task fails with IMAGES_DO_NOT_COVER_AUDIO (the charger refunds a failed
task), naming how many photos were sent, how many survived, the counts
per reason, and every skipped photo by segment and image index — so the
caller fixes the photo instead of guessing. On a full lip-sync video the
face is on screen the whole time, so photos are optional panels there: a
skipped photo is a warning, never a failure.

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
from app.services.image_density import MAX_PHOTO_SECONDS
from app.services.photo_content import REASON_DUPLICATE_PHOTO
from app.services.segment_panels import Panel
from app.services.segment_photo_duration import photo_cap

IMAGES_DO_NOT_COVER_AUDIO = "images_do_not_cover_audio"
MOTION_IN = "in"
MOTION_OUT = "out"
_COVERAGE_EPSILON_SECONDS = 0.01
_SKIP_MARKER = " media skipped: "
FIT_STRETCH = 1.5


def fitted_photo_cap(requested: Optional[float]) -> float:
    """The longest a photo may hold once fitted to the real voice.

    Its pace (the requested duration, or MAX_PHOTO_SECONDS) times
    FIT_STRETCH: the real voice may run longer than the words-per-second
    estimate the request was validated against, and a photo absorbs that
    gap instead of failing the render. Only a gap beyond the stretch
    means the request really had too few photos.
    """
    return photo_cap(requested, MAX_PHOTO_SECONDS) * FIT_STRETCH


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


def _skip_summary(sent: int, survived: int, skipped: Sequence[str]) -> tuple[str, list[str], Counter[str]]:
    """("N sent, M survived, K skipped (reason xN, ...)", [fatal skip lines], {reason: count})."""
    fatal = [line for line in skipped if _SKIP_MARKER in line]
    reasons = Counter(line.split(_SKIP_MARKER, 1)[1] for line in fatal)
    summary = f"{sent} sent, {survived} survived, {len(fatal)} skipped"
    if reasons:
        summary += " (" + ", ".join(
            f"{reason} x{count}" for reason, count in reasons.most_common()
        ) + ")"
    return summary, fatal, reasons


def failure_detail(
    *,
    sent: int,
    survived: int,
    skipped: Sequence[str],
    no_full_frame: bool,
) -> str:
    """The detail for an ImagesDoNotCoverAudio: counts, every skip, and the fix for duplicates."""
    summary, fatal, reasons = _skip_summary(sent, survived, skipped)
    parts = ["no full-frame image survived"] if no_full_frame else []
    parts.append(summary)
    parts.extend(fatal)
    if REASON_DUPLICATE_PHOTO in reasons:
        parts.append("fix: use a different photo for each media item")
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

    In the images modes (voiceover and hook-only lip sync) every sent
    photo must survive: any skipped photo fails the task with the
    aggregated skip reasons. Full lip sync shows the face the whole
    time, so media is optional there and a skipped photo never fails.
    Raises ImagesDoNotCoverAudio with the aggregated skip reasons when
    a photo was skipped or no full-frame photo survived, and when the
    surviving photos run out before the end of the audio at their caps.
    """
    window_start = coverage_start(face, hook_end)
    _summary, fatal, _reasons = _skip_summary(sent, len(panels), skipped)
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
    times. Full-frame photos are laid out back to back from window_start:
    each holds until the next photo's slice starts, at most its fitted cap
    (fitted_photo_cap), and the last runs to the end of the audio. Raises
    ImagesDoNotCoverAudio when there is a window to cover and no
    full-frame photo survived, and when the photos held at their fitted
    caps still run out before the end of the audio, naming how many more
    photos the window needs.
    """
    if window_start is None or window_start >= audio_duration:
        return list(panels)
    framed = [panel for panel in panels if panel.caption_bottom is not None]
    full = sorted(
        (panel for panel in panels if panel.caption_bottom is None), key=lambda panel: panel.start
    )
    if not full:
        raise ImagesDoNotCoverAudio()
    covered: list[Panel] = []
    cursor = window_start
    photo_position = 0
    rng = random.Random(variation_seed) if variation_seed is not None else None
    for position, panel in enumerate(full):
        start = cursor
        limit = full[position + 1].start if position + 1 < len(full) else audio_duration
        if limit <= start:
            limit = audio_duration
        if panel.clip_seconds is not None:
            cap = min(panel.end - panel.start, segment_video.MAX_CLIP_LOOPS * panel.clip_seconds)
            motion = None
        else:
            cap = fitted_photo_cap(panel.requested_duration)
            motion = _photo_motion(photo_position, rng)
            photo_position += 1
        end = min(limit, start + cap)
        covered.append(replace(panel, start=start, end=end, motion=motion))
        cursor = end
    if cursor < audio_duration - _COVERAGE_EPSILON_SECONDS:
        missing = math.ceil((audio_duration - cursor) / MAX_PHOTO_SECONDS)
        count_word = "item" if len(full) == 1 else "items"
        cover_verb = "covers" if len(full) == 1 else "cover"
        missing_word = "photo" if missing == 1 else "photos"
        if any(panel.clip_seconds is not None for panel in full):
            raise ImagesDoNotCoverAudio(
                f"{len(full)} {count_word} {cover_verb} {cursor - window_start:.1f}s of "
                f"{audio_duration - window_start:.1f}s; "
                f"need {missing} more {missing_word} or video clips"
            )
        photo_word = "photo" if len(full) == 1 else "photos"
        raise ImagesDoNotCoverAudio(
            f"{len(full)} {photo_word} {cover_verb} {cursor - window_start:.1f}s of "
            f"{audio_duration - window_start:.1f}s at most {FIT_STRETCH:g}x their pace each; "
            f"need {missing} more {missing_word}"
        )
    return sorted([*framed, *covered], key=lambda panel: panel.start)

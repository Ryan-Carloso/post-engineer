"""Coverage for the "images" material: the agent's photos are the whole picture.

Every segment carries an image (validated before charging), and each photo
is on screen for its segment's spoken interval (user_media). Two things can
still leave a gap after TTS: the short pauses between segments, and a photo
that is dropped (download failed, too small, could not be drawn). Nothing
tops a gap up with stock, so the neighbour photo covers it:

- the first full-frame photo starts where the face hands over (0 on a
  faceless video, the hook's end on a hook-only persona video);
- every photo runs until the next one starts;
- the last photo runs to the end of the audio.

A gap longer than a normal pause is reported as a task warning. When no
full-frame photo survives the task fails with IMAGES_DO_NOT_COVER_AUDIO
(the charger refunds a failed task). On a full lip-sync video the face is
on screen the whole time, so there is nothing to cover.

Full-frame photos also get a slow zoom (Ken Burns, panel_motion), alternating
in and out, so a photo held for several seconds never looks frozen.
"""

from dataclasses import replace
from typing import Optional, Sequence

from app.services import segment_panels
from app.services.segment_panels import Panel

IMAGES_DO_NOT_COVER_AUDIO = "images_do_not_cover_audio"
# A pause between two segments is well under this; a longer gap means a photo is missing.
GAP_WARNING_SECONDS = 1.0
REASON_GAP_COVERED = "a neighbour image covers a missing image"
MOTION_IN = "in"
MOTION_OUT = "out"


class ImagesDoNotCoverAudio(Exception):
    """No full-frame image survived, so the images material has nothing to show."""

    def __init__(self) -> None:
        super().__init__(IMAGES_DO_NOT_COVER_AUDIO)


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

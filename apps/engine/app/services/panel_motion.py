"""Ken Burns motion for full-frame segment photos (images material).

A still photo looks frozen, so each one zooms slowly in
or out over the seconds it is on screen. The zoom rate matches the still
material clips (image_material: 3% per second) and is capped, so the zoom
stays small over a photo's at most two seconds on screen. The photo is scaled up first:
zoompan rounds the crop window to whole pixels, and on a frame-sized source
that rounding shows as a visible jitter.
"""

import math
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.segment_panels import Panel

FPS = 30
ZOOM_PER_SECOND = 0.03
MAX_ZOOM = 1.12
SUPERSAMPLE = 2
CROSSFADE_SECONDS = 0.5


def zoom_for(seconds: float) -> float:
    """The zoom reached at the end of a photo shown for this many seconds."""
    return min(MAX_ZOOM, 1 + ZOOM_PER_SECOND * max(0.0, seconds))


def frame_count(panel: "Panel", lead_seconds: float = 0.0) -> int:
    """Frames zoompan draws for the panel: its whole time on screen, at least one."""
    return max(1, math.ceil((panel.end - panel.start + lead_seconds) * FPS))


def zoom_filter(
    input_label: str,
    panel: "Panel",
    width: int,
    height: int,
    output_label: str,
    lead_seconds: float = 0.0,
) -> str:
    """Filter chain turning one still into its zooming clip, timed to the panel's start."""
    frames = frame_count(panel, lead_seconds)
    peak = zoom_for(panel.end - panel.start + lead_seconds) - 1
    if panel.motion == "out":
        zoom = f"{1 + peak:.4f}-{peak:.4f}*on/{frames}"
    else:
        zoom = f"1+{peak:.4f}*on/{frames}"
    return (
        f"[{input_label}]scale={width * SUPERSAMPLE}:{height * SUPERSAMPLE},"
        f"zoompan=z='{zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
        f":d={frames}:s={width}x{height}:fps={FPS},"
        f"setpts=PTS-STARTPTS+{panel.start - lead_seconds:.3f}/TB[{output_label}]"
    )


def crossfade_in_filter(input_label: str, fade_start: float, fade_seconds: float, output_label: str) -> str:
    """Filter chain fading one still in over the previous photo, on the alpha channel."""
    return (
        f"[{input_label}]format=yuva420p,"
        f"fade=t=in:st={fade_start:.3f}:d={fade_seconds:.3f}:alpha=1[{output_label}]"
    )

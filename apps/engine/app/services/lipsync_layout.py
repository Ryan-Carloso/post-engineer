"""Lip-sync intro layout: how the persona hook meets the b-roll.

Extracted from app.services.video so the video module stays under the
file-size ratchet. The command builder takes the resolved codec, preset
and fps as parameters instead of reading them from the video module, so
this module imports nothing from app.services and there is no import cycle.
"""

from app.utils import utils


LAYOUT_STANDARD = "standard"
LAYOUT_REACT = "react"
VIDEO_LAYOUTS = frozenset({LAYOUT_STANDARD, LAYOUT_REACT})

# Divider drawn on the seam between the persona and the b-roll in the react
# layout. Without it the two blocks read as two videos stapled together; a 2px
# line at the seam reads as one frame. Sized in output pixels so it stays the
# same visual weight at any resolution.
REACT_DIVIDER_PX = 4
REACT_DIVIDER_COLOR = "white@0.85"


def _react_split_filter(width: int, height: int) -> str:
    """Filter graph for the react layout: persona on top, b-roll below.

    The persona block scales by WIDTH and is cropped from the top edge, so it
    keeps head and shoulders and drops the torso — the least valuable part of
    the frame. The opposite (contain to fit) leaves ~370px of empty bar down
    each side of a 1080-wide block.

    Both halves are cropped to the same size because ``vstack`` requires
    identical widths; half of an odd height would be rejected by the encoder.
    """
    half = height // 2
    divider_y = half - REACT_DIVIDER_PX // 2
    return (
        # b-roll (input 0) fills the lower block, cover-fit then centre-crop.
        f"[0:v]scale={width}:{half}:force_original_aspect_ratio=increase,"
        f"crop={width}:{half},setsar=1[broll];"
        # persona (input 1): scale by width, crop the torso off the bottom.
        f"[1:v]scale={width}:-2,crop={width}:{half},setsar=1[avatar];"
        f"[avatar][broll]vstack=inputs=2[stacked];"
        f"[stacked]drawbox=x=0:y={divider_y}:w={width}:h={REACT_DIVIDER_PX}"
        f":color={REACT_DIVIDER_COLOR}:t=fill[vout]"
    )


def _build_lipsync_intro_command(
    background_video: str,
    lipsync_video: str,
    intro_file: str,
    width: int,
    height: int,
    duration: float,
    layout: str,
    codec: str,
    preset: str,
    fps: int,
) -> list[str]:
    """ffmpeg argv for the hook segment only.

    Inputs are ordered background (0) then lipsync (1) for BOTH layouts, so
    the ``-map`` for audio never depends on which layout is running.

    ``codec``, ``preset`` and ``fps`` are the values the caller already
    resolved for the pipeline (effective codec, configured preset, pipeline
    fps) — this builder only assembles argv, it never probes encoders.
    """
    if layout == LAYOUT_REACT:
        command = [
            utils.get_ffmpeg_binary(),
            "-y",
            "-i",
            background_video,
            "-i",
            lipsync_video,
            "-t",
            str(duration),
            "-filter_complex",
            _react_split_filter(width, height),
            # Video from the filter output; audio from INPUT 1 (the persona).
            # A Pexels b-roll clip carries its own audio, so mapping 0:a?
            # buries the narration under stock footage sound.
            "-map",
            "[vout]",
            "-map",
            "1:a",
        ]
    else:
        command = [
            utils.get_ffmpeg_binary(),
            "-y",
            "-i",
            lipsync_video,
            "-t",
            str(duration),
            "-vf",
            f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1",
            # The standard intro drops audio entirely: this segment REPLACES
            # the background's first seconds, and the background's own audio is
            # re-muxed later from the source timeline.
            "-an",
        ]
    return command + [
        "-c:v",
        codec,
        # Force the pipeline fps: LongCat avatar-v1.5 renders at 25fps and a
        # stream-copied 30fps tail would balloon the concat timeline by the
        # timebase ratio (measured +5.4s on a 27s video).
        "-r",
        str(fps),
        "-preset",
        preset,
        "-pix_fmt",
        "yuv420p",
        intro_file,
    ]

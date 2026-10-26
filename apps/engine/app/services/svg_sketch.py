"""Hand-drawn reveal for catalog SVG art.

The licensed Doodly catalog is flattened: every asset embeds a base64 PNG and
keeps its vector paths in a hidden ``display="none"`` layer, so there is no
outline to trace with ``stroke-dashoffset`` (see svg_draw for the code that
works on genuine line art). This module gets the drawing effect from the raster
instead:

1. extract the embedded PNG,
2. derive a line-art mask with Canny,
3. reveal colour and ink together behind a moving front,
4. drag a pencil along that front, rotated to the local stroke direction.

A real pencil is part of the look, not decoration, so it is rendered once into
an oversized sprite with its tip at the centre: rotating about a point near the
sprite edge would crop the barrel as the angle sweeps.
"""
from __future__ import annotations

import base64
import math
import os
import re
from dataclasses import dataclass
from typing import List, Optional, Tuple

import cv2
import numpy as np
from loguru import logger

from app.services.svg_pencil import Pencil, attach_pencil

_DATA_URI = re.compile(r'xlink:href="data:image/(?:png|jpe?g);base64,([^"]+)"')


_CANVAS_MARGIN = 0.12

# Drawing pace: the pencil travels at a constant speed, so a reveal lasts
# as long as the artwork's strokes take to trace — simple art finishes fast,
# detailed art takes longer. The duration is bounded on both sides so a
# trivial icon never blinks in and a huge illustration never stalls a clip.
# The pace is deliberately fast: even the longest draw finishes within
# roughly the first half of a typical 4-second segment, and the finished
# artwork then holds for the remainder of the clip (see fit_frames_to_clip).
# Speeds are in canvas pixels: callers convert their stroke measure (SVG
# user units for line art, ink area for raster art) before asking.
PENCIL_SPEED_PX_PER_SECOND = 2200.0
DRAW_MIN_SECONDS = 0.75
DRAW_MAX_SECONDS = 2.0
DRAW_FPS = 30


def draw_seconds(stroke_length_px: Optional[float]) -> float:
    """Reveal duration for a stroke length measured in canvas pixels.

    An unmeasured length (None or non-positive) gets the maximum: art we
    cannot measure should still read as drawn, never pop into place.
    """
    if stroke_length_px is None or stroke_length_px <= 0:
        return DRAW_MAX_SECONDS
    return min(
        max(stroke_length_px / PENCIL_SPEED_PX_PER_SECOND, DRAW_MIN_SECONDS),
        DRAW_MAX_SECONDS,
    )


# Seconds the finished drawing is held at the end of a clip.
FINAL_HOLD_SECONDS = 0.5


def fit_frames_to_clip(frames: List[np.ndarray], total: int) -> List[np.ndarray]:
    """Fit a drawing performance into exactly `total` frames.

    combine_videos cuts any clip longer than max_clip_duration into segments
    (shuffled in random mode, truncated in sequential), which would scramble
    or cut off the drawing. So a draw longer than the clip minus the final
    hold is sped up by sampling evenly, always keeping the first and the
    finished last frame; the finished frame then fills the rest of the clip.
    """
    total = max(int(total), 1)
    hold = min(int(FINAL_HOLD_SECONDS * DRAW_FPS), total // 2)
    draw_budget = max(total - hold, 1)
    if len(frames) > draw_budget:
        if draw_budget == 1:
            frames = [frames[-1]]
        else:
            last = len(frames) - 1
            frames = [
                frames[round(index * last / (draw_budget - 1))]
                for index in range(draw_budget)
            ]
    return frames + [frames[-1]] * (total - len(frames))


def draw_frame_count(stroke_length_px: Optional[float] = None) -> int:
    """Frames for one reveal of the given stroke length."""
    return max(int(round(draw_seconds(stroke_length_px) * DRAW_FPS)), 2)


# Canny edges dilated once are ~2px wide, so a raster ink mask's area over
# that width approximates the centreline length the pencil would travel.
_INK_STROKE_WIDTH_PX = 2.0


def stroke_length_from_ink(ink: np.ndarray) -> float:
    """Approximate stroke-centreline length of a raster ink mask, in pixels."""
    return float(np.count_nonzero(ink)) / _INK_STROKE_WIDTH_PX


# Default reveal axis: left to right. Callers pass a diagonal to sweep
# top-left to bottom-right instead.
_HORIZONTAL = (1.0, 0.0)


@dataclass(frozen=True)
class ArtPlacement:
    """An artwork fitted onto the clip canvas."""

    colour: np.ndarray  # (h, w, 3) uint8 — the original illustration
    ink: np.ndarray  # (h, w) bool — the line art drawn over it
    offset_x: int
    offset_y: int


def extract_embedded_png(svg_path: str) -> Optional[np.ndarray]:
    """Decode the base64 raster a catalog SVG carries.

    Returns None when the file has no embedded image: genuine line art has
    nothing to flatten, and callers should use svg_draw instead.
    """
    try:
        with open(svg_path, "r", encoding="utf-8", errors="replace") as handle:
            markup = handle.read()
    except OSError:
        return None
    match = _DATA_URI.search(markup)
    if match is None:
        return None
    try:
        raw = base64.b64decode(match.group(1))
    except (ValueError, TypeError):
        return None
    encoded = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_UNCHANGED)
    return None if image is None else image


def flatten_on_white(
    image: np.ndarray, background: Tuple[int, int, int] = (255, 255, 255)
) -> np.ndarray:
    """Composite an RGBA image onto white, or onto the given BGR colour.

    The catalog art is transparent outside the subject. Blending against
    transparent pixels by setting the RGB channel alone turns the background
    black, which poisons every edge detector downstream. Edge detection uses
    the white default; the displayed colour uses the clip's canvas colour so
    the artwork shows no box around it.
    """
    if image.ndim == 2:
        return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    if image.shape[2] == 3:
        return image.copy()
    alpha = image[..., 3:4].astype(np.float32) / 255.0
    fill = np.array(background, np.float32)
    return (image[..., :3] * alpha + fill * (1.0 - alpha)).astype(np.uint8)


def derive_ink(colour: np.ndarray, low: int = 40, high: int = 110) -> np.ndarray:
    """Line art for a flattened illustration, via Canny plus a 1px dilation.

    The dilation joins the anti-aliased edges Canny leaves broken, so the
    revealed stroke reads as one continuous line rather than dashes.
    """
    grey = cv2.cvtColor(colour, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(grey, low, high)
    edges = cv2.dilate(edges, np.ones((2, 2), np.uint8), iterations=1)
    return edges > 0


def fit_art(
    colour: np.ndarray,
    ink: np.ndarray,
    canvas_width: int,
    canvas_height: int,
    margin: float = _CANVAS_MARGIN,
) -> ArtPlacement:
    """Scale the artwork to the canvas and crop to its bounding box.

    Cropping matters: the source PNG carries a border frame that would be
    picked up as a stroke and drawn as a stray rectangle.
    """
    ys, xs = np.where(ink)
    if xs.size:
        pad = 12
        y0 = max(int(ys.min()) - pad, 0)
        y1 = min(int(ys.max()) + pad + 1, ink.shape[0])
        x0 = max(int(xs.min()) - pad, 0)
        x1 = min(int(xs.max()) + pad + 1, ink.shape[1])
    else:
        y0, y1, x0, x1 = 0, ink.shape[0], 0, ink.shape[1]

    cropped_colour = colour[y0:y1, x0:x1]
    cropped_ink = ink[y0:y1, x0:x1]
    h, w = cropped_ink.shape[:2]

    usable_w = canvas_width * (1.0 - margin)
    usable_h = canvas_height * (1.0 - margin)
    scale = min(usable_w / max(w, 1), usable_h / max(h, 1))

    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    resized_colour = cv2.resize(cropped_colour, (new_w, new_h), interpolation=cv2.INTER_AREA)
    resized_ink = cv2.resize(
        cropped_ink.astype(np.uint8), (new_w, new_h), interpolation=cv2.INTER_NEAREST
    ) > 0

    return ArtPlacement(
        colour=resized_colour,
        ink=resized_ink,
        offset_x=(canvas_width - new_w) // 2,
        offset_y=(canvas_height - new_h) // 2,
    )


def _reveal_axis(
    art_width: int, art_height: int, direction: Tuple[float, float]
) -> np.ndarray:
    """Project every pixel onto the sweep axis, normalised to [0, 1].

    A horizontal reveal is the (1, 0) axis; passing (1, 1) sweeps top-left to
    bottom-right. Projecting instead of comparing a single coordinate is what
    makes the diagonal front a true diagonal rather than a slanted band.
    """
    ux, uy = direction
    norm = math.hypot(ux, uy)
    if norm == 0:
        raise ValueError("reveal direction must not be a zero vector")
    ux, uy = ux / norm, uy / norm

    projection = (
        np.arange(art_width, dtype=np.float32)[None, :] * ux
        + np.arange(art_height, dtype=np.float32)[:, None] * uy
    )
    low = float(projection.min())
    high = float(projection.max())
    if high - low <= 0:
        return np.zeros_like(projection)
    return (projection - low) / (high - low)


def render_frames(
    placement: ArtPlacement,
    pencil: Pencil,
    frame_count: int,
    canvas_width: int,
    canvas_height: int,
    background: Tuple[int, int, int] = (252, 252, 252),
    front_softness: float = 4.0,
    direction: Tuple[float, float] = _HORIZONTAL,
    angle_offset: float = 0.0,
    monochrome: bool = False,
    ink_colour: Tuple[int, int, int] = (35, 35, 35),
) -> List[np.ndarray]:
    """Render the reveal frames, colour and ink advancing behind one front."""
    frames: List[np.ndarray] = []
    masks: List[np.ndarray] = []
    art_h, art_w = placement.ink.shape[:2]
    total = max(int(frame_count), 2)

    horizontal = abs(direction[1]) <= 1e-9
    if horizontal:
        # Keep the pixel-space softness meaningful for the default sweep.
        axis = np.repeat(
            np.arange(art_w, dtype=np.float32)[None, :] / max(art_w, 1), art_h, axis=0
        )
        softness = max(front_softness / max(art_w, 1), 1e-6)
    else:
        axis = _reveal_axis(art_w, art_h, direction)
        softness = max(front_softness / max(art_w, art_h), 1e-6)

    for index in range(total):
        progress = index / (total - 1)
        reveal = np.clip((progress - axis) / softness, 0.0, 1.0)
        canvas = np.full((canvas_height, canvas_width, 3), background[0], np.uint8)
        canvas[:, :] = background
        ox, oy = placement.offset_x, placement.offset_y
        band = placement.ink & (reveal > 0.5)
        if monochrome:
            # Line art only: the contour is drawn on its own, with no colour
            # fill behind it. This is the whiteboard look, and it also hides
            # the Canny noise the colour fill was partly masking.
            patch = np.empty((art_h, art_w, 3), np.uint8)
            patch[:, :] = background
            patch[band] = ink_colour
        else:
            fill = np.array(background, np.float32)
            patch = (
                placement.colour * reveal[..., None] + fill * (1.0 - reveal[..., None])
            ).astype(np.uint8)
        canvas[oy : oy + art_h, ox : ox + art_w] = patch

        frames.append(canvas)
        full_mask = np.zeros((canvas_height, canvas_width), bool)
        full_mask[oy : oy + art_h, ox : ox + art_w] = band
        masks.append(full_mask)

    # clean_final: the completed reveal is the frame the clip hold repeats,
    # so the pencil must not be resting on it.
    return attach_pencil(frames, masks, pencil, angle_offset=angle_offset, clean_final=True)


def render_sketch_clip(
    svg_path: str,
    pencil_png: np.ndarray,
    pencil_tip: Tuple[float, float],
    frame_count: Optional[int] = None,
    canvas_width: int = 1080,
    canvas_height: int = 1920,
    direction: Tuple[float, float] = _HORIZONTAL,
    angle_offset: float = 0.0,
    monochrome: bool = False,
    background: Tuple[int, int, int] = (252, 252, 252),
) -> Optional[List[np.ndarray]]:
    """Full pipeline: catalog SVG -> frames drawn by the pencil.

    A frame_count of None derives the pace from the artwork itself: the
    fitted ink mask's approximate stroke length at the constant pencil
    speed (see draw_seconds). background is the BGR canvas colour.
    """
    embedded = extract_embedded_png(svg_path)
    if embedded is None:
        return None
    ink = derive_ink(flatten_on_white(embedded))
    colour = flatten_on_white(embedded, background)
    placement = fit_art(colour, ink, canvas_width, canvas_height)
    if frame_count is None:
        frame_count = draw_frame_count(stroke_length_from_ink(placement.ink))
    pencil = Pencil(pencil_png, pencil_tip)
    return render_frames(
        placement,
        pencil,
        frame_count,
        canvas_width,
        canvas_height,
        direction=direction,
        angle_offset=angle_offset,
        monochrome=monochrome,
        background=background,
    )


def write_clip(frames: List[np.ndarray], output_path: str, fps: int = 20) -> str:
    """Encode frames with ffmpeg. Returns the written path.

    ffmpeg writes to a temporary file beside output_path, which is renamed
    into place only after a successful encode: callers treat any non-empty
    file at output_path as a finished clip, so a failed or killed encode must
    never leave a partial one there.
    """
    import shutil
    import subprocess
    import tempfile

    directory = tempfile.mkdtemp(prefix="svg-sketch-")
    fd, partial = tempfile.mkstemp(
        dir=os.path.dirname(output_path) or ".", prefix=".svg-clip-", suffix=".mp4"
    )
    os.close(fd)
    try:
        for index, frame in enumerate(frames):
            cv2.imwrite(os.path.join(directory, f"{index:04d}.png"), frame)
        subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-framerate", str(fps),
                "-i", os.path.join(directory, "%04d.png"),
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart", partial,
            ],
            check=True,
            capture_output=True,
        )
        os.replace(partial, output_path)
    finally:
        # Cleanup is best-effort, but a failure is logged, never silent:
        # unnoticed temp dirs and partial clips would fill the disk.
        try:
            shutil.rmtree(directory)
        except OSError as exc:
            logger.warning(f"svg sketch: failed to remove temp dir {directory}: {exc}")
        try:
            if os.path.exists(partial):
                os.unlink(partial)
        except OSError as exc:
            logger.warning(
                f"svg sketch: failed to remove partial clip {partial}: {exc}"
            )
    return output_path


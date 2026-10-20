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

from app.services.svg_pencil import Pencil, attach_pencil

_DATA_URI = re.compile(r'xlink:href="data:image/(?:png|jpe?g);base64,([^"]+)"')


_CANVAS_MARGIN = 0.12

# Drawing pace, in one place so the icon CLI and the catalog CLI cannot drift.
# 1.1s at 30fps: fast enough not to stall a video, slow enough that each stroke
# still reads as being traced rather than popping into place.
DRAW_SECONDS = 1.1
DRAW_FPS = 30


def draw_frame_count() -> int:
    """Frames for one reveal at the configured pace."""
    return max(int(round(DRAW_SECONDS * DRAW_FPS)), 2)


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


def flatten_on_white(image: np.ndarray) -> np.ndarray:
    """Composite an RGBA image onto white.

    The catalog art is transparent outside the subject. Blending against
    transparent pixels by setting the RGB channel alone turns the background
    black, which poisons every edge detector downstream.
    """
    if image.ndim == 2:
        return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    if image.shape[2] == 3:
        return image.copy()
    alpha = image[..., 3:4].astype(np.float32) / 255.0
    return (image[..., :3] * alpha + 255.0 * (1.0 - alpha)).astype(np.uint8)


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
            patch = (
                placement.colour * reveal[..., None] + 255.0 * (1.0 - reveal[..., None])
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
    frame_count: int,
    canvas_width: int = 1080,
    canvas_height: int = 1920,
    direction: Tuple[float, float] = _HORIZONTAL,
    angle_offset: float = 0.0,
    monochrome: bool = False,
) -> Optional[List[np.ndarray]]:
    """Full pipeline: catalog SVG -> frames drawn by the pencil."""
    embedded = extract_embedded_png(svg_path)
    if embedded is None:
        return None
    colour = flatten_on_white(embedded)
    ink = derive_ink(colour)
    placement = fit_art(colour, ink, canvas_width, canvas_height)
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
    )


def write_clip(frames: List[np.ndarray], output_path: str, fps: int = 20) -> str:
    """Encode frames with ffmpeg. Returns the written path."""
    import subprocess
    import tempfile

    directory = tempfile.mkdtemp(prefix="svg-sketch-")
    try:
        for index, frame in enumerate(frames):
            cv2.imwrite(os.path.join(directory, f"{index:04d}.png"), frame)
        subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-framerate", str(fps),
                "-i", os.path.join(directory, "%04d.png"),
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart", output_path,
            ],
            check=True,
            capture_output=True,
        )
    finally:
        import shutil

        shutil.rmtree(directory, ignore_errors=True)
    return output_path


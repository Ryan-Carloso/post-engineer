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
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import List, Optional, Tuple

import cv2
import numpy as np

_DATA_URI = re.compile(r'xlink:href="data:image/(?:png|jpe?g);base64,([^"]+)"')

# Direction smoothing. A full step per frame makes the pencil twitch on
# near-degenerate strokes; full inertia makes it lag behind the ink.
_ANGLE_SMOOTHING = 0.40
_POSITION_SMOOTHING = 0.45

# A stroke needs this many new pixels before its direction is trusted; below
# that the covariance is numerically meaningless and the angle would snap.
_MIN_DIRECTION_SAMPLES = 12
_MIN_VARIANCE = 1e-6

_CANVAS_MARGIN = 0.12

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


class Pencil:
    """A pencil sprite that can be rotated about its graphite tip.

    The sprite is rebuilt once at ``size * 2.4`` with the tip at the centre.
    Rotating inside the source bounds would shear the barrel out of the texture
    on wide angle changes and the pencil would appear sliced.
    """

    def __init__(self, source_png: np.ndarray, tip_in_source: Tuple[float, float], size: int = 460):
        if source_png is None or source_png.shape[2] != 4:
            raise ValueError("pencil sprite must be RGBA")
        self.size = size
        self.texture = int(round(size * 2.4))
        centre = (self.texture / 2.0, self.texture / 2.0)
        translate = np.float32(
            [[1, 0, centre[0] - tip_in_source[0]], [0, 1, centre[1] - tip_in_source[1]]]
        )
        self._centred = cv2.warpAffine(
            source_png, translate, (self.texture, self.texture),
            flags=cv2.INTER_LANCZOS4, borderValue=(0, 0, 0, 0),
        )
        self.tip = centre

    def rotate(self, angle_degrees: float) -> np.ndarray:
        matrix = cv2.getRotationMatrix2D(self.tip, angle_degrees, 1.0)
        return cv2.warpAffine(
            self._centred, matrix, (self.texture, self.texture),
            flags=cv2.INTER_LANCZOS4, borderValue=(0, 0, 0, 0),
        )

    def shadow(self, sprite: np.ndarray, opacity: float = 0.32) -> np.ndarray:
        """The same silhouette in grey, used as a cast shadow."""
        shaded = np.zeros_like(sprite)
        shaded[..., 0:3] = 90
        shaded[..., 3] = (sprite[..., 3].astype(np.float32) * opacity).astype(np.uint8)
        return shaded


def blend(canvas: np.ndarray, sprite: np.ndarray, x: int, y: int) -> None:
    """Alpha-composite a sprite at (x, y), letting it bleed off every edge.

    Clamping the position instead would detach the tip from the stroke it is
    drawing, which is the one thing that must never drift.
    """
    canvas_h, canvas_w = canvas.shape[:2]
    sprite_h, sprite_w = sprite.shape[:2]
    dx0, dy0 = max(0, x), max(0, y)
    dx1, dy1 = min(canvas_w, x + sprite_w), min(canvas_h, y + sprite_h)
    if dx1 <= dx0 or dy1 <= dy0:
        return
    patch = sprite[dy0 - y : dy1 - y, dx0 - x : dx1 - x]
    alpha = patch[..., 3:4].astype(np.float32) / 255.0
    region = canvas[dy0:dy1, dx0:dx1].astype(np.float32)
    canvas[dy0:dy1, dx0:dx1] = (region * (1.0 - alpha) + patch[..., :3] * alpha).astype(np.uint8)


def stroke_direction(
    xs: np.ndarray, ys: np.ndarray, offset_x: int = 0, offset_y: int = 0
) -> Optional[Tuple[Tuple[float, float], float]]:
    """Where the newest ink ends, and which way it is heading.

    Returns ``((x, y), angle_degrees)`` in canvas coordinates, or None when the
    sample is too small or too collinear to yield a trustworthy direction.
    """
    if xs.size < _MIN_DIRECTION_SAMPLES:
        return None
    # BLAS on macOS/ARM raises spurious divide-by-zero and overflow flags on
    # this matmul even for well-conditioned input. The results are validated
    # explicitly below, so the flags are noise rather than signal.
    with np.errstate(all="ignore"):
        points = np.stack([xs.astype(np.float64), ys.astype(np.float64)])
        mean = points.mean(axis=1, keepdims=True)
        centred = points - mean
        covariance = (centred @ centred.T) / xs.size
        # Guard both the matrix and its eigenvalues: a finite covariance can
        # still produce infinite eigenvalues, and the eigenvector that comes
        # out of that is garbage that overflows the projection below.
        if not np.isfinite(covariance).all():
            return None
        eigenvalues, eigenvectors = np.linalg.eigh(covariance)
        if not np.isfinite(eigenvalues).all() or not np.isfinite(eigenvectors).all():
            return None
        if eigenvalues[-1] <= _MIN_VARIANCE:
            return None
        axis = eigenvectors[:, int(np.argmax(eigenvalues))]
        projections = centred.T @ axis
        if not np.isfinite(projections).all():
            return None
    leading = int(np.argmax(projections))
    position = (float(points[0, leading]) + offset_x, float(points[1, leading]) + offset_y)
    angle = math.degrees(math.atan2(float(axis[1]), float(axis[0])))
    return position, angle


def _shortest_turn(current: float, target: float) -> float:
    """Signed smallest rotation from current to target, in (-180, 180]."""
    return ((target - current + 180.0) % 360.0) - 180.0


@dataclass
class PencilFollower:
    """Glides the pencil toward the newest ink and turns it to match.

    ``angle_offset`` flips the pencil so the barrel sits on the opposite side of
    the tip: the stroke direction points away from the hand, and a pencil held
    the other way reads as pushing rather than drawing.
    """

    pencil: Pencil
    smoothing: float = _POSITION_SMOOTHING
    angle_offset: float = 0.0

    def __post_init__(self) -> None:
        self.x: Optional[float] = None
        self.y: Optional[float] = None
        self.angle: Optional[float] = None

    def step(self, sample: Optional[Tuple[Tuple[float, float], float]]) -> None:
        if sample is None:
            return
        position, raw_angle = sample
        angle = raw_angle + self.angle_offset
        if self.x is None:
            self.x, self.y = position
            self.angle = angle
            return
        self.x += (position[0] - self.x) * self.smoothing
        self.y += (position[1] - self.y) * self.smoothing
        assert self.angle is not None
        self.angle += _shortest_turn(self.angle, angle) * _ANGLE_SMOOTHING

    def draw(self, canvas: np.ndarray) -> None:
        if self.x is None or self.y is None or self.angle is None:
            return
        sprite = self.pencil.rotate(self.angle)
        offset_x = int(round(self.x - self.pencil.tip[0]))
        offset_y = int(round(self.y - self.pencil.tip[1]))
        blend(canvas, self.pencil.shadow(sprite), offset_x + 14, offset_y + 20)
        blend(canvas, sprite, offset_x, offset_y)


def attach_pencil(
    frames: List[np.ndarray],
    ink_masks: List[np.ndarray],
    pencil: Pencil,
    shadow_offset: Tuple[int, int] = (14, 20),
    angle_offset: float = 0.0,
) -> List[np.ndarray]:
    """Draw the pencil onto pre-rendered frames, tracking each frame's new ink.

    Separated from frame generation because the ink can come from two very
    different sources: stroke-dashoffset renders of genuine line art
    (svg_draw), or reveal masks over a flattened illustration (render_frames).
    The pencil only needs to know which pixels are newly inked this frame.
    """
    if len(frames) != len(ink_masks):
        raise ValueError(
            f"frames and ink_masks must align: got {len(frames)} and {len(ink_masks)}"
        )

    follower = PencilFollower(pencil=pencil, angle_offset=angle_offset)
    previous: Optional[np.ndarray] = None
    out: List[np.ndarray] = []

    for frame, mask in zip(frames, ink_masks):
        mask_bool = mask.astype(bool)
        fresh = mask_bool if previous is None else (mask_bool & ~previous)
        previous = mask_bool
        ys, xs = np.where(fresh)
        follower.step(stroke_direction(xs, ys))
        follower.draw(frame)
        out.append(frame)

    return out


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

    return attach_pencil(frames, masks, pencil, angle_offset=angle_offset)


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


def build_pencil_svg(gradient: bool = True, output_path: Optional[str] = None) -> str:
    """The pencil artwork, as SVG text.

    Kept here (not just in the demo script) so the sprite the pipeline uses is
    reproducible from the repo rather than from a scratch file.
    """
    import math as _math

    tip = (150.0, 560.0)
    angle = _math.radians(-45)
    direction = (_math.cos(angle), _math.sin(angle))
    normal = (-direction[1], direction[0])
    half_width = 22

    def point(t: float, s: float) -> Tuple[float, float]:
        return (tip[0] + direction[0] * t + normal[0] * s, tip[1] + direction[1] * t + normal[1] * s)

    def quad(t0: float, t1: float, w0: float, w1: float, fill: str) -> str:
        corners = [point(t0, -w0), point(t1, -w1), point(t1, w1), point(t0, w0)]
        path = " ".join(
            f"{'M' if i == 0 else 'L'}{p[0]:.1f},{p[1]:.1f}" for i, p in enumerate(corners)
        ) + " Z"
        return (
            f'<path d="{path}" fill="{fill}" stroke="#3a2f26" stroke-width="4" '
            'stroke-linejoin="round"/>'
        )

    defs = (
        '<defs><linearGradient id="body" x1="0" y1="0" x2="1" y2="0">'
        '<stop offset="0%" stop-color="#b8862a"/><stop offset="30%" stop-color="#f8d468"/>'
        '<stop offset="64%" stop-color="#e3ad38"/><stop offset="100%" stop-color="#9d6f19"/>'
        "</linearGradient></defs>"
    )
    body_fill = "url(#body)" if gradient else "#f2c14e"
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 700" width="700" height="700">',
        defs if gradient else "",
        quad(0, 32, 0, 8, "#2b2926"),
        quad(32, 104, 8, half_width, "#e8c9a0"),
        quad(104, 432, half_width, half_width, body_fill),
        quad(432, 474, half_width + 3, half_width + 3, "#dfe3e8"),
        quad(474, 516, half_width, half_width, "#ef8a90"),
        "</svg>",
    ]
    markup = "".join(parts)
    if output_path:
        with open(output_path, "w", encoding="utf-8") as handle:
            handle.write(markup)
    return markup


def pencil_tip_in_sprite(sprite_size: int, rendered_size: int = 700) -> Tuple[float, float]:
    """Where the graphite tip sits in the rendered sprite."""
    scale = sprite_size / float(rendered_size)
    return (150.0 * scale, 560.0 * scale)
"""Pencil sprite and follower for the hand-drawn SVG reveal.

The pencil is rendered once into an oversized sprite with its tip at the
centre, so rotating it about the tip never crops the barrel. ``PencilFollower``
glides the sprite toward the newest ink each frame and turns it to match the
local stroke direction; ``attach_pencil`` draws it onto pre-rendered frames.

The ink masks can come from two very different sources: stroke-dashoffset
renders of genuine line art (svg_draw), or reveal masks over a flattened
illustration (svg_sketch.render_frames). The pencil only needs to know which
pixels are newly inked each frame.
"""
from __future__ import annotations

import math
import os
import subprocess
import tempfile
from dataclasses import dataclass
from typing import List, Optional, Tuple

import cv2
import numpy as np
from loguru import logger


# Direction smoothing. A full step per frame makes the pencil twitch on
# near-degenerate strokes; full inertia makes it lag behind the ink.
_ANGLE_SMOOTHING = 0.40
_POSITION_SMOOTHING = 0.45

# A stroke needs this many new pixels before its direction is trusted; below
# that the covariance is numerically meaningless and the angle would snap.
_MIN_DIRECTION_SAMPLES = 12
_MIN_VARIANCE = 1e-6


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
        translate = np.array(
            [[1, 0, centre[0] - tip_in_source[0]], [0, 1, centre[1] - tip_in_source[1]]],
            dtype=np.float32,
        )
        self._centred = cv2.warpAffine(
            source_png, translate, (self.texture, self.texture),
            flags=cv2.INTER_LANCZOS4, borderValue=(0.0, 0.0, 0.0, 0.0),
        )
        self.tip = centre

    def rotate(self, angle_degrees: float) -> np.ndarray:
        matrix = cv2.getRotationMatrix2D(self.tip, angle_degrees, 1.0)
        return cv2.warpAffine(
            self._centred, matrix, (self.texture, self.texture),
            flags=cv2.INTER_LANCZOS4, borderValue=(0.0, 0.0, 0.0, 0.0),
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
        assert self.x is not None and self.y is not None
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
    clean_final: bool = False,
) -> List[np.ndarray]:
    """Draw the pencil onto pre-rendered frames, tracking each frame's new ink.

    Separated from frame generation because the ink can come from two very
    different sources: stroke-dashoffset renders of genuine line art
    (svg_draw), or reveal masks over a flattened illustration (render_frames).
    The pencil only needs to know which pixels are newly inked this frame.

    With ``clean_final`` the last frame is left untouched: it is the completed
    drawing, and clip builders pad the hold by repeating it — a pencil drawn
    on it would sit on the finished artwork for the whole hold. The pencil
    belongs to the act of drawing, not to the result.
    """
    if len(frames) != len(ink_masks):
        raise ValueError(
            f"frames and ink_masks must align: got {len(frames)} and {len(ink_masks)}"
        )

    follower = PencilFollower(pencil=pencil, angle_offset=angle_offset)
    previous: Optional[np.ndarray] = None
    out: List[np.ndarray] = []
    last = len(frames) - 1

    for index, (frame, mask) in enumerate(zip(frames, ink_masks)):
        mask_bool = mask.astype(bool)
        fresh = mask_bool if previous is None else (mask_bool & ~previous)
        previous = mask_bool
        ys, xs = np.where(fresh)
        follower.step(stroke_direction(xs, ys))
        if not (clean_final and index == last):
            follower.draw(frame)
        out.append(frame)

    return out


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


# Default sprite size, in px. Same value as the demo tools.
SPRITE_SIZE = 460

# The rasterized sprite, kept after the first successful render: the artwork
# is static, so every clip would otherwise spawn the same rsvg-convert.
_sprite_cache: dict = {}


def load_sprite(size: int = SPRITE_SIZE):
    """Rasterize the pencil artwork into an (RGBA sprite, tip) pair.

    Returns None when rsvg-convert is missing or the sprite is unreadable;
    the caller then falls back to the static still instead of losing the clip.
    Only a successful render is cached, so a transient failure is retried.
    """
    cached = _sprite_cache.get(size)
    if cached is not None:
        return cached

    with tempfile.TemporaryDirectory() as tmp:
        svg_path = os.path.join(tmp, "pencil.svg")
        png_path = os.path.join(tmp, "pencil.png")
        with open(svg_path, "w", encoding="utf-8") as handle:
            handle.write(build_pencil_svg())
        try:
            subprocess.run(
                ["rsvg-convert", "-w", str(size), "-o", png_path, svg_path],
                check=True,
                capture_output=True,
            )
        except (subprocess.CalledProcessError, FileNotFoundError, OSError) as exc:
            logger.warning(f"svg pencil sprite failed: {exc}")
            return None
        sprite = cv2.imread(png_path, cv2.IMREAD_UNCHANGED)
    if sprite is None or sprite.ndim != 3 or sprite.shape[2] != 4:
        logger.warning("svg pencil sprite unreadable")
        return None
    sprite.flags.writeable = False  # shared across clips
    result = (sprite, pencil_tip_in_sprite(size))
    _sprite_cache[size] = result
    return result

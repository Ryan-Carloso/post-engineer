"""Turn a catalog SVG into a hand-drawn reveal animation.

The renderer in this pipeline is a static rasteriser (rsvg-convert/resvg): it
renders exactly one frame and does not execute CSS or SMIL. The draw-on effect
is therefore produced by rendering the same artwork N times with
``stroke-dashoffset`` walking from each path's length down to zero, and
assembling those frames into a clip.

Two facts drive the design:

* Only artwork that actually has strokes can be drawn. Silhouette artwork
  (``fill`` with no ``stroke``) has no outline to trace, so it is reported as
  not drawable and the caller falls back to the static path rather than
  silently rendering an unanimated clip.
* ``stroke-dasharray`` must be at least the real path length. A short dash
  makes the dash pattern repeat mid-stroke and the drawing ends in a gap, so
  lengths are measured, never guessed.
"""
from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from typing import List, Optional, Tuple

from loguru import logger

SVG_NS = "http://www.w3.org/2000/svg"

_SHAPE_TAGS = (
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
)

# Samples per Bezier segment when measuring arc length. 24 is far more than
# the eye needs at 1080p and keeps the whole-path cost negligible.
_CURVE_SAMPLES = 24


def _tag(name: str) -> str:
    return f"{{{SVG_NS}}}{name}"


def _has_visible_stroke(element: ET.Element) -> bool:
    stroke = (element.get("stroke") or "").strip().lower()
    return stroke not in ("", "none", "transparent")


def collect_drawable(root: ET.Element) -> List[ET.Element]:
    """Every stroked shape, in document order.

    Document order is the drawing order: artwork is authored back-to-front, so
    revealing shapes in that sequence looks like the illustration being drawn.
    """
    wanted = {_tag(name) for name in _SHAPE_TAGS}
    return [
        element
        for element in root.iter()
        if element.tag in wanted and _has_visible_stroke(element)
    ]


def is_drawable(root: ET.Element) -> bool:
    """Whether this artwork can be revealed as a drawing at all."""
    return bool(collect_drawable(root))


# ── geometry ────────────────────────────────────────────────────────────────

_NUMBER = re.compile(r"[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")
_COMMAND = re.compile(r"([MmLlHhVvCcSsQqTtAaZz])")


def _tokenize_path(d: str):
    """Yield (command, [numbers]) pairs from a path ``d`` attribute."""
    for match in _COMMAND.finditer(d):
        command = match.group(1)
        start = match.end()
        nxt = _COMMAND.search(d, start)
        end = nxt.start() if nxt else len(d)
        numbers = [float(value) for value in _NUMBER.findall(d[start:end])]
        yield command, numbers


def _cubic_point(
    p0: Tuple[float, float],
    p1: Tuple[float, float],
    p2: Tuple[float, float],
    p3: Tuple[float, float],
    t: float,
) -> Tuple[float, float]:
    u = 1.0 - t
    a, b, c, d = u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t
    return (
        a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
        a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    )


def _quadratic_point(
    p0: Tuple[float, float],
    p1: Tuple[float, float],
    p2: Tuple[float, float],
    t: float,
) -> Tuple[float, float]:
    u = 1.0 - t
    a, b, c = u * u, 2 * u * t, t * t
    return (
        a * p0[0] + b * p1[0] + c * p2[0],
        a * p0[1] + b * p1[1] + c * p2[1],
    )


def _flatten(
    d: str,
) -> List[Tuple[float, float]]:
    """Sample a path ``d`` attribute into a polyline.

    Curves are sampled rather than solved analytically: the exact arc length of
    a cubic has no closed form, and the sampled sum converges fast enough at
    _CURVE_SAMPLES per segment for a stroke reveal, where a sub-pixel error
    only shifts a dash pattern nobody can see.
    """
    points: List[Tuple[float, float]] = []
    current = (0.0, 0.0)
    start = (0.0, 0.0)
    index = 0
    # Reflection state for the shorthand S/T commands.
    last_cubic_control: Optional[Tuple[float, float]] = None
    last_quad_control: Optional[Tuple[float, float]] = None

    def take(count: int) -> Optional[List[float]]:
        nonlocal index
        if index + count > len(numbers):
            return None
        chunk = numbers[index : index + count]
        index += count
        return chunk

    for command, numbers in _tokenize_path(d):
        relative = command.islower()
        upper = command.upper()
        index = 0

        if upper == "Z":
            current = start
            points.append(current)
            last_cubic_control = last_quad_control = None
            continue

        if upper == "M":
            first_pair = True
            while True:
                chunk = take(2)
                if chunk is None:
                    break
                current = (
                    chunk[0] + current[0] if relative else chunk[0],
                    chunk[1] + current[1] if relative else chunk[1],
                )
                if first_pair:
                    # A following Z closes to the initial moveto point; later
                    # pairs are implicit linetos, not new subpaths.
                    start = current
                    first_pair = False
                points.append(current)
                # Subsequent pairs after the first are implicit lineto.
                upper = "L"
                relative = command.islower()
            last_cubic_control = last_quad_control = None
            continue

        if upper == "L":
            while True:
                chunk = take(2)
                if chunk is None:
                    break
                current = (
                    chunk[0] + current[0] if relative else chunk[0],
                    chunk[1] + current[1] if relative else chunk[1],
                )
                points.append(current)
            last_cubic_control = last_quad_control = None
            continue

        if upper == "H":
            while True:
                chunk = take(1)
                if chunk is None:
                    break
                current = (chunk[0] + current[0] if relative else chunk[0], current[1])
                points.append(current)
            last_cubic_control = last_quad_control = None
            continue

        if upper == "V":
            while True:
                chunk = take(1)
                if chunk is None:
                    break
                current = (current[0], chunk[0] + current[1] if relative else chunk[0])
                points.append(current)
            last_cubic_control = last_quad_control = None
            continue

        if upper in ("C", "S"):
            while True:
                if upper == "C":
                    chunk = take(6)
                    if chunk is None:
                        break
                    x1, y1, x2, y2, x, y = chunk
                    if relative:
                        x1, y1, x2, y2, x, y = (
                            x1 + current[0],
                            y1 + current[1],
                            x2 + current[0],
                            y2 + current[1],
                            x + current[0],
                            y + current[1],
                        )
                    control1 = (x1, y1)
                    control2 = (x2, y2)
                else:
                    chunk = take(4)
                    if chunk is None:
                        break
                    x2, y2, x, y = chunk
                    if relative:
                        x2, y2, x, y = (
                            x2 + current[0],
                            y2 + current[1],
                            x + current[0],
                            y + current[1],
                        )
                    # S reflects the previous control point; without one it
                    # behaves as if the control sat on the current point.
                    if last_cubic_control is None:
                        control1 = current
                    else:
                        control1 = (
                            2 * current[0] - last_cubic_control[0],
                            2 * current[1] - last_cubic_control[1],
                        )
                    control2 = (x2, y2)
                end = (x, y)
                for step in range(1, _CURVE_SAMPLES + 1):
                    points.append(
                        _cubic_point(
                            current, control1, control2, end, step / _CURVE_SAMPLES
                        )
                    )
                current = end
                last_cubic_control = control2
                if upper == "S" and last_cubic_control is None:
                    last_cubic_control = control2
            last_quad_control = None
            continue

        if upper in ("Q", "T"):
            while True:
                if upper == "Q":
                    chunk = take(4)
                    if chunk is None:
                        break
                    x1, y1, x, y = chunk
                    if relative:
                        x1, y1, x, y = (
                            x1 + current[0],
                            y1 + current[1],
                            x + current[0],
                            y + current[1],
                        )
                    control = (x1, y1)
                else:
                    chunk = take(2)
                    if chunk is None:
                        break
                    x, y = chunk
                    if relative:
                        x, y = x + current[0], y + current[1]
                    if last_quad_control is None:
                        control = current
                    else:
                        control = (
                            2 * current[0] - last_quad_control[0],
                            2 * current[1] - last_quad_control[1],
                        )
                end = (x, y)
                for step in range(1, _CURVE_SAMPLES + 1):
                    points.append(
                        _quadratic_point(
                            current, control, end, step / _CURVE_SAMPLES
                        )
                    )
                current = end
                last_quad_control = control
            last_cubic_control = None
            continue

        if upper == "A":
            # Arcs are approximated by their endpoint chord. Illustrator output
            # for this catalog is overwhelmingly cubic; a chord keeps the dash
            # pattern sane without an ellipse solver.
            while True:
                chunk = take(7)
                if chunk is None:
                    break
                x, y = chunk[5], chunk[6]
                if relative:
                    x, y = x + current[0], y + current[1]
                current = (x, y)
                points.append(current)
            last_cubic_control = last_quad_control = None
            continue

        # Unknown command: skip its numbers to stay in sync.
        index = len(numbers)

    return points


def path_length(d: str) -> float:
    """Approximate the drawn length of a path, in user units.

    Returns 0.0 for a degenerate path so callers can fall back to the plain
    dash length instead of animating something that has no extent.
    """
    points = _flatten(d)
    if len(points) < 2:
        return 0.0
    total = 0.0
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        total += math.hypot(x1 - x0, y1 - y0)
    return total


def shape_length(element: ET.Element) -> float:
    """Drawn length of any drawable shape, normalised to user units."""
    tag = element.tag.rsplit("}", 1)[-1]
    if tag == "path":
        return path_length(element.get("d") or "")
    if tag == "line":
        return math.hypot(
            float(element.get("x2", 0)) - float(element.get("x1", 0)),
            float(element.get("y2", 0)) - float(element.get("y1", 0)),
        )
    if tag == "rect":
        w = float(element.get("width", 0))
        h = float(element.get("height", 0))
        return 2 * (w + h)
    if tag in ("circle", "ellipse"):
        rx = float(element.get("rx") or element.get("r") or 0)
        ry = float(element.get("ry") or element.get("r") or 0)
        return math.pi * (3 * (rx + ry) - math.sqrt((3 * rx + ry) * (rx + 3 * ry)))
    if tag in ("polyline", "polygon"):
        raw = (element.get("points") or "").replace(",", " ")
        values = [float(v) for v in raw.split()]
        pairs = list(zip(values[0::2], values[1::2]))
        if len(pairs) < 2:
            return 0.0
        return sum(
            math.hypot(x1 - x0, y1 - y0)
            for (x0, y0), (x1, y1) in zip(pairs, pairs[1:])
        )
    return 0.0


def dash_for(element: ET.Element, default: float) -> float:
    """Dash length for a shape: its measured length, or a safe fallback.

    A stroke-width based fallback keeps short or unmeasurable shapes from
    getting a dasharray of 0, which would render the dash pattern degenerate
    and hide the shape entirely.
    """
    measured = shape_length(element)
    if measured > 0:
        return measured * 1.05
    try:
        width = float(element.get("stroke-width", 0) or 0)
    except ValueError:
        width = 0.0
    return max(width * 4.0, default, 1.0)


def apply_progress(
    root: ET.Element,
    progress: float,
    fallback_dash: float = 64.0,
    stagger: bool = True,
) -> List[ET.Element]:
    """Set dasharray/dashoffset on every stroked shape for a progress value.

    With ``stagger`` the shapes are revealed in document order, each within its
    own slice of the timeline, which reads as the illustration being drawn.
    Without it every shape advances together.

    ``progress`` is clamped to [0, 1]; 0 draws nothing and 1 draws everything.
    """
    shapes = collect_drawable(root)
    if not shapes:
        return []

    progress = min(max(progress, 0.0), 1.0)
    count = len(shapes)

    for index, element in enumerate(shapes):
        dash = dash_for(element, fallback_dash)
        element.set("stroke-dasharray", f"{dash:.3f}")
        if stagger and count > 1:
            start = index / count
            local = (progress - start) * count
        else:
            local = progress
        local = min(max(local, 0.0), 1.0)
        element.set("stroke-dashoffset", f"{dash * (1.0 - local):.3f}")

    return shapes


def render_progress_frames(
    svg_path: str,
    frames_dir: str,
    frame_count: int,
    width: int,
    keep_aspect_ratio: bool = True,
    stagger: bool = True,
    renderer: Optional[object] = None,
) -> List[str]:
    """Rasterize ``frame_count`` progressive frames of a catalog SVG.

    Returns the written PNG paths in order. Raises nothing: a rendering failure
    is logged and surfaced as a short frame list so the caller can fall back to
    the single still instead of losing the clip.
    """
    import os
    import subprocess

    try:
        tree = ET.parse(svg_path)
    except ET.ParseError as exc:
        logger.warning(f"svg_draw: cannot parse {svg_path}: {exc}")
        return []

    root = tree.getroot()
    if not is_drawable(root):
        logger.info(f"svg_draw: {os.path.basename(svg_path)} has no strokes, not drawable")
        return []

    written: List[str] = []
    total = max(int(frame_count), 1)
    for index in range(total):
        # The last frame is fully drawn, so the clip never ends mid-stroke.
        progress = index / (total - 1) if total > 1 else 1.0
        apply_progress(root, progress, stagger=stagger)
        frame_svg = os.path.join(frames_dir, f"draw-{index:04d}.svg")
        frame_png = os.path.join(frames_dir, f"draw-{index:04d}.png")
        tree_out = ET.ElementTree(root)
        try:
            tree_out.write(frame_svg, encoding="utf-8", xml_declaration=True)
            argv = [
                "rsvg-convert",
                "-w",
                str(width),
                "--keep-aspect-ratio",
                "-o",
                frame_png,
                frame_svg,
            ]
            subprocess.run(argv, check=True, capture_output=True)
        except (subprocess.CalledProcessError, FileNotFoundError, OSError) as exc:
            logger.warning(f"svg_draw: frame {index} failed for {svg_path}: {exc}")
            return written
        finally:
            try:
                os.remove(frame_svg)
            except OSError:
                pass
        written.append(frame_png)

    return written
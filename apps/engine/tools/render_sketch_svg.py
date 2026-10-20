"""Render a catalog SVG as a hand-drawn reveal.

This is the path for the licensed Doodly artwork: those SVGs embed a base64
PNG and keep their vector paths in a hidden layer, so the drawing comes from a
Canny contour over the raster rather than from stroke-dashoffset (that is the
line-art path, see tools/render_sketch_icon.py).

Usage: uv run python tools/render_sketch_svg.py <path-to.svg> [out.mp4]
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile

import cv2

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import svg_sketch, svg_pencil  # noqa: E402

CANVAS_W, CANVAS_H = 1080, 1920
PEN_SIZE = 460
# Top-left to bottom-right sweep, with the barrel on the far side of the tip.
DIAGONAL = (1.0, 1.0)
PENCIL_FLIP = 180.0
# Line art only (whiteboard look): contour without the colour fill.
MONOCHROME = True


def pencil_sprite():
    with tempfile.TemporaryDirectory() as tmp:
        svg_path = os.path.join(tmp, "pencil.svg")
        png_path = os.path.join(tmp, "pencil.png")
        with open(svg_path, "w", encoding="utf-8") as handle:
            handle.write(svg_pencil.build_pencil_svg(output_path=svg_path))
        subprocess.run(["rsvg-convert", "-w", str(PEN_SIZE), "-o", png_path, svg_path], check=True)
        return cv2.imread(png_path, cv2.IMREAD_UNCHANGED)


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    svg_path = sys.argv[1]
    if not os.path.isfile(svg_path):
        print(f"not found: {svg_path}")
        return 2
    out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        "/tmp/svg-sketch-demo", f"lapis_{os.path.basename(svg_path).rsplit('.', 1)[0]}.mp4"
    )
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    sprite = pencil_sprite()
    tip = svg_pencil.pencil_tip_in_sprite(PEN_SIZE)
    frames = svg_sketch.render_sketch_clip(
        svg_path, sprite, tip, None, CANVAS_W, CANVAS_H,
        direction=DIAGONAL, angle_offset=PENCIL_FLIP,
        monochrome=MONOCHROME,
    )
    if frames is None:
        print(f"no embedded raster in {svg_path} — use tools/render_sketch_icon.py for line art")
        return 1

    svg_sketch.write_clip(frames, out_path, fps=svg_sketch.DRAW_FPS)
    print(f"OK {out_path} ({len(frames)} frames @ {svg_sketch.DRAW_FPS}fps)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
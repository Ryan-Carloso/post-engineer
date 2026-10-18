"""Render a line-art icon being drawn by the pencil.

Two sources of ink meet here: svg_draw produces the frames (stroke-dashoffset
on genuine line art) and svg_sketch attaches the pencil to them. The catalog
Doodly art cannot use this path — it is a flattened PNG, see svg_sketch for the
raster variant.

Usage: uv run python -m tools.render_sketch_icon clock /tmp/out
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import line_art, svg_draw, svg_sketch  # noqa: E402

CANVAS_W, CANVAS_H = 1080, 1920
FRAMES = 44
PEN_SIZE = 460
PENCIL_SIZE = 700
# Barrel on the far side of the tip.
PENCIL_FLIP = 180.0


def pencil_sprite():
    """Build the pencil sprite and its tip position from the tracked SVG."""
    with tempfile.TemporaryDirectory() as tmp:
        svg_path = os.path.join(tmp, "pencil.svg")
        png_path = os.path.join(tmp, "pencil.png")
        with open(svg_path, "w", encoding="utf-8") as handle:
            handle.write(svg_sketch.build_pencil_svg(output_path=svg_path))
        subprocess.run(
            ["rsvg-convert", "-w", str(PEN_SIZE), "-o", png_path, svg_path], check=True
        )
        sprite = cv2.imread(png_path, cv2.IMREAD_UNCHANGED)
    return sprite, svg_sketch.pencil_tip_in_sprite(PEN_SIZE, PENCIL_SIZE)


def icon_frames(name: str, frame_count: int, width: int):
    """Render each progress step of one icon, returning frames and ink masks."""
    with tempfile.TemporaryDirectory() as tmp:
        svg_path = os.path.join(tmp, f"{name}.svg")
        with open(svg_path, "w", encoding="utf-8") as handle:
            handle.write(line_art.icon_svg(name))

        tree = ET.parse(svg_path)
        root = tree.getroot()
        total = max(frame_count, 2)
        frames, masks = [], []

        for index in range(total):
            progress = index / (total - 1)
            svg_draw.apply_progress(root, progress, stagger=True)
            frame_svg = os.path.join(tmp, "frame.svg")
            frame_png = os.path.join(tmp, "frame.png")
            tree.write(frame_svg, encoding="utf-8", xml_declaration=True)
            subprocess.run(
                ["rsvg-convert", "-w", str(width), "--keep-aspect-ratio", "-o", frame_png, frame_svg],
                check=True, capture_output=True,
            )
            rendered = cv2.imread(frame_png, cv2.IMREAD_UNCHANGED)
            alpha = rendered[..., 3] > 40 if rendered.shape[2] == 4 else rendered[..., 0] < 200

            art_h, art_w = alpha.shape[:2]
            scale = min(CANVAS_W * 0.74 / art_w, CANVAS_H * 0.34 / art_h)
            new_w, new_h = max(1, int(art_w * scale)), max(1, int(art_h * scale))
            resized = cv2.resize(rendered, (new_w, new_h), interpolation=cv2.INTER_AREA)
            resized_alpha = cv2.resize(
                alpha.astype(np.uint8), (new_w, new_h), interpolation=cv2.INTER_NEAREST
            ) > 0

            canvas = np.full((CANVAS_H, CANVAS_W, 3), 252, np.uint8)
            ox, oy = (CANVAS_W - new_w) // 2, (CANVAS_H - new_h) // 2
            a = (resized[..., 3:4].astype(np.float32) / 255.0) if resized.shape[2] == 4 else None
            if a is None:
                region = canvas[oy : oy + new_h, ox : ox + new_w].astype(np.float32)
                dark = (resized[..., :3] < 200).any(axis=2)[..., None].astype(np.float32)
                canvas[oy : oy + new_h, ox : ox + new_w] = (region * (1 - dark) + resized[..., :3] * dark).astype(np.uint8)
            else:
                region = canvas[oy : oy + new_h, ox : ox + new_w].astype(np.float32)
                canvas[oy : oy + new_h, ox : ox + new_w] = (region * (1 - a) + resized[..., :3] * a).astype(np.uint8)

            mask = np.zeros((CANVAS_H, CANVAS_W), bool)
            mask[oy : oy + new_h, ox : ox + new_w] = resized_alpha
            frames.append(canvas)
            masks.append(mask)

    return frames, masks


def main() -> int:
    name = sys.argv[1] if len(sys.argv) > 1 else "clock"
    out_dir = sys.argv[2] if len(sys.argv) > 2 else "/tmp/svg-sketch-demo"
    # Optional: seconds of drawing and output fps. Clip length is their
    # product, so either lever can change the pace.
    seconds = float(sys.argv[3]) if len(sys.argv) > 3 else None
    fps = int(sys.argv[4]) if len(sys.argv) > 4 else 20

    frame_count = FRAMES if seconds is None else max(int(round(seconds * fps)), 2)
    os.makedirs(out_dir, exist_ok=True)

    sprite, tip = pencil_sprite()
    pencil = svg_sketch.Pencil(sprite, tip)

    frames, masks = icon_frames(name, frame_count, 700)
    frames = svg_sketch.attach_pencil(frames, masks, pencil, angle_offset=PENCIL_FLIP)

    suffix = "" if seconds is None else f"_{seconds:g}s"
    out = os.path.join(out_dir, f"lapis_{name}{suffix}.mp4")
    svg_sketch.write_clip(frames, out, fps=fps)
    print(f"OK {out} ({len(frames)} frames @ {fps}fps = {len(frames)/fps:.2f}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
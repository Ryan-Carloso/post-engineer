"""Private SVG catalog as video material.

Searches the licensed catalog (svg_catalog), rasterizes matches to stills
with rsvg-convert, and turns them into Ken Burns clips via image_material.
Lives in its own module because material.py is grandfathered over the
file-size cap and may not grow by a single line.
"""
from __future__ import annotations

import hashlib
import os
import subprocess
from typing import List

from loguru import logger

from app.config import config
from app.models.schema import MaterialInfo, VideoAspect
from app.services import image_material, svg_catalog, svg_draw, svg_pencil, svg_sketch, video_download
from app.utils import utils


# Long edge, in px, used when rasterizing a catalog SVG to a still frame.
# 1080 matches the renderer's long edge, so the Ken Burns zoom never upsamples.
_SVG_RASTER_LONG_EDGE = 1080

# Barrel flip so the stroke direction points away from the hand. Same value
# as the demo tools.
_PENCIL_ANGLE_OFFSET = 180.0

# Width, in px, at which line art is rasterized frame by frame. The drawn
# pace conversion (_line_art_travel_px) is expressed against this raster.
_LINE_ART_RENDER_WIDTH = 700


def search_videos_svg(
    search_term: str,
    minimum_duration: int,
    video_aspect: VideoAspect = VideoAspect.portrait,
) -> List[MaterialInfo]:
    """Look up catalog SVG assets matching a keyword.

    The material url is the asset's catalog-relative path: the artwork is
    fetched from R2 only when resolve_material_path renders it, so unused
    matches cost nothing. The aspect is unused: a catalog entry is a still
    image, and the clip is letterboxed to the render size later.
    """
    del video_aspect
    if not svg_catalog.is_enabled():
        return []
    return [
        MaterialInfo(
            provider="svg",
            url=asset.relative_path,
            duration=minimum_duration,
        )
        for asset in svg_catalog.search(search_term)
    ]


def rasterize_svg_to_png(
    svg_path: str,
    output_png: str,
    target_width: int | None = None,
    target_height: int | None = None,
) -> bool:
    """Render an SVG to a PNG still with librsvg.

    When both target dimensions are given, the artwork is fitted inside a
    canvas of exactly that size. This is not cosmetic: combine_videos rejects
    any clip whose aspect leaves more horizontal letterbox than
    MAX_LETTERBOX_BARS, so a square illustration against a 9:16 frame would be
    dropped from the timeline with only a warning.

    Each rsvg-convert output flag must appear exactly once: the tool honours
    the last occurrence of a repeated flag, so a duplicated -o would silently
    discard the earlier value instead of erroring.
    """
    fit_canvas = bool(target_width and target_height)

    if fit_canvas:
        assert target_width is not None and target_height is not None
        scale = min(
            target_width / _SVG_RASTER_LONG_EDGE,
            target_height / _SVG_RASTER_LONG_EDGE,
        )
        render_width = max(1, int(_SVG_RASTER_LONG_EDGE * scale))
        # rsvg-convert has no height knob with --keep-aspect-ratio, so the
        # artwork is rendered wide and then fitted by the canvas step below.
        render_width = min(render_width, max(1, int(target_width)))
    else:
        render_width = _SVG_RASTER_LONG_EDGE

    try:
        subprocess.run(
            [
                "rsvg-convert",
                "-w",
                str(render_width),
                "--keep-aspect-ratio",
                "-o",
                output_png,
                svg_path,
            ],
            check=True,
            capture_output=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        logger.warning(f"svg rasterize failed for {svg_path}: {exc}")
        return False

    if not os.path.isfile(output_png) or os.path.getsize(output_png) == 0:
        return False

    if fit_canvas:
        try:
            _fit_onto_canvas(output_png, target_width, target_height)
        except OSError as exc:
            logger.warning(f"svg canvas fit failed for {svg_path}: {exc}")
            return False

    return os.path.isfile(output_png) and os.path.getsize(output_png) > 0


def _fit_onto_canvas(png_path: str, width: int, height: int) -> None:
    """Center the rendered still on a canvas of exactly width x height.

    The fill colour is configurable because the catalog is cartoon artwork that
    reads as printed art, and black letterbox would look like a bug.
    """
    from PIL import Image

    with Image.open(png_path) as image:
        if image.mode != "RGBA":
            image = image.convert("RGBA")
        canvas = Image.new(
            "RGBA", (int(width), int(height)), _svg_canvas_background()
        )
        # Scale down only: upscaling a rasterized still just adds blur.
        fitted = image.copy()
        fitted.thumbnail((int(width), int(height)), Image.LANCZOS)
        offset = (
            (int(width) - fitted.size[0]) // 2,
            (int(height) - fitted.size[1]) // 2,
        )
        canvas.alpha_composite(fitted, offset)
        canvas.convert("RGB").save(png_path, format="PNG")


def _svg_canvas_background_bgr() -> tuple:
    """The configured canvas colour as a BGR triple, for OpenCV frames."""
    red, green, blue, _ = _svg_canvas_background()
    return (blue, green, red)


def _svg_canvas_background() -> tuple:
    """Parse the configured canvas colour into an RGBA tuple."""
    raw = str(config.app.get("svg_canvas_background", "#FFFFFF")).strip() or "#FFFFFF"
    raw = raw.lstrip("#")
    if len(raw) == 3:
        raw = "".join(char * 2 for char in raw)
    try:
        if len(raw) != 6:
            raise ValueError(f"bad length {len(raw)}")
        return tuple(int(raw[i : i + 2], 16) for i in (0, 2, 4)) + (255,)
    except ValueError:
        logger.warning(f"invalid svg_canvas_background={raw!r}, using white")
        return (255, 255, 255, 255)


def _persist_svg_item(
    item: MaterialInfo,
    save_dir: str,
    max_clip_duration: int,
    video_aspect: VideoAspect = VideoAspect.portrait,
    *,
    create_fallback_dir: bool = True,
) -> str:
    """Render a catalog SVG into a video clip.

    The pencil-drawn animation is tried first: Doodly-style artwork (embedded
    raster) is revealed as a sketch, genuine line art is traced stroke by
    stroke. When the artwork cannot be drawn — or the animation fails — the
    clip falls back to the static still with a Ken Burns drift.

    item.url is the asset's catalog-relative path; the artwork is fetched
    (or read from the local catalog cache) only on a clip cache miss. A
    missing asset raises FileNotFoundError for the caller to log and skip
    the clip; svg mode degrades to a single neutral clip only when the
    whole catalog yields nothing (task.get_video_materials), never per
    segment.

    Cached by a digest of the asset path and the aspect: the same asset in two
    aspects is two different clips. The drawn clip's key also carries the clip
    length and the canvas colour, both of which change its frames, plus its own
    tag so it never collides with the static-still entries.

    An empty save_dir (the shipped default) falls back to the same storage
    cache save_video uses: without it the stills and clips would land as
    CWD-relative paths while every other provider returns absolute ones.
    Only the fallback directory is created — and only when
    create_fallback_dir is true; an explicit save_dir keeps the previous
    contract (no filesystem side effects beyond the render itself).
    """
    if not save_dir:
        save_dir = utils.storage_dir("cache_videos")
        if create_fallback_dir and not os.path.exists(save_dir):
            os.makedirs(save_dir)

    width, height = video_aspect.to_resolution()

    background = _svg_canvas_background_bgr()
    digest = hashlib.sha256(
        f"{item.url}|{width}x{height}|{max_clip_duration}s|{background}|drawn-v2".encode(
            "utf-8"
        )
    ).hexdigest()[:16]
    drawn_mp4 = os.path.join(save_dir, f"svg-drawn-{digest}.mp4")
    if os.path.isfile(drawn_mp4) and os.path.getsize(drawn_mp4) > 0:
        return drawn_mp4

    svg_path = svg_catalog.resolve_asset_path(item.url)
    drawn = _render_drawn_clip(
        svg_path, drawn_mp4, width, height, max_clip_duration, background
    )
    if drawn:
        logger.info(f"svg drawn clip rendered: {os.path.basename(drawn)}")
        return drawn

    digest = hashlib.sha256(f"{item.url}|{width}x{height}".encode("utf-8")).hexdigest()[
        :16
    ]
    png_path = os.path.join(save_dir, f"svg-{digest}.png")
    if not rasterize_svg_to_png(svg_path, png_path, width, height):
        return ""

    return image_material.render_image_file_to_mp4(
        png_path, clip_duration=max_clip_duration
    ) or ""


def _frame_to_canvas(rendered, width: int, height: int, background: tuple):
    """Fit one rasterized frame onto a canvas of the given BGR colour.

    Returns the canvas and the ink mask the pencil follower tracks.
    """
    import cv2
    import numpy as np

    alpha = (
        rendered[..., 3] > 40 if rendered.shape[2] == 4 else rendered[..., 0] < 200
    )
    art_h, art_w = alpha.shape[:2]
    scale = min(width * 0.85 / art_w, height * 0.7 / art_h)
    new_w, new_h = max(1, int(art_w * scale)), max(1, int(art_h * scale))
    resized = cv2.resize(rendered, (new_w, new_h), interpolation=cv2.INTER_AREA)
    resized_alpha = (
        cv2.resize(alpha.astype(np.uint8), (new_w, new_h), interpolation=cv2.INTER_NEAREST)
        > 0
    )

    canvas = np.empty((height, width, 3), np.uint8)
    canvas[:, :] = background
    ox, oy = (width - new_w) // 2, (height - new_h) // 2
    region = canvas[oy : oy + new_h, ox : ox + new_w].astype(np.float32)
    if resized.shape[2] == 4:
        a = resized[..., 3:4].astype(np.float32) / 255.0
        canvas[oy : oy + new_h, ox : ox + new_w] = (
            region * (1 - a) + resized[..., :3] * a
        ).astype(np.uint8)
    else:
        dark = (resized[..., :3] < 200).any(axis=2)[..., None].astype(np.float32)
        canvas[oy : oy + new_h, ox : ox + new_w] = (
            region * (1 - dark) + resized[..., :3] * dark
        ).astype(np.uint8)

    mask = np.zeros((height, width), bool)
    mask[oy : oy + new_h, ox : ox + new_w] = resized_alpha
    return canvas, mask


def _line_art_travel_px(root, width: int, height: int) -> float:
    """On-screen pencil travel for line art, in canvas pixels.

    Stroke lengths are measured in SVG user units; the frames rasterize the
    viewBox at _LINE_ART_RENDER_WIDTH px wide and _frame_to_canvas then fits
    that raster onto the canvas, so the travel the viewer sees is the unit
    length scaled by both factors. Returns 0.0 when the artwork declares no
    dimensions to scale from — the pace then falls back to the maximum.
    """
    view_box = (root.get("viewBox") or "").replace(",", " ").split()
    if len(view_box) == 4:
        try:
            vb_w, vb_h = float(view_box[2]), float(view_box[3])
        except ValueError:
            vb_w = vb_h = 0.0
    else:
        try:
            vb_w = float(root.get("width") or 0)
            vb_h = float(root.get("height") or 0)
        except ValueError:
            vb_w = vb_h = 0.0
    if vb_w <= 0 or vb_h <= 0:
        return 0.0
    units = svg_draw.total_draw_length(root)
    render_scale = _LINE_ART_RENDER_WIDTH / vb_w
    rendered_h = _LINE_ART_RENDER_WIDTH * vb_h / vb_w
    fit_scale = min(width * 0.85 / _LINE_ART_RENDER_WIDTH, height * 0.7 / rendered_h)
    return units * render_scale * fit_scale


def _drawn_line_art_frames(
    svg_path: str,
    pencil_png,
    pencil_tip,
    width: int,
    height: int,
    background: tuple,
    max_frames: int,
):
    """Frames of genuine line art being drawn, pencil attached.

    The production counterpart of tools/render_sketch_icon.py: each frame is
    the artwork with stroke-dashoffset at that progress, rasterized and fitted
    to the target canvas. The frame count follows the artwork's measured
    stroke length at the constant pencil speed (see svg_sketch.draw_seconds),
    capped at max_frames so the draw fits the clip. Returns [] when the artwork has no strokes to trace or a frame fails to
    rasterize.
    """
    import cv2
    import tempfile
    import xml.etree.ElementTree as ET

    try:
        root = ET.parse(svg_path).getroot()
    except ET.ParseError as exc:
        logger.warning(f"svg draw: cannot parse {svg_path}: {exc}")
        return []
    if not svg_draw.is_drawable(root):
        return []

    pencil = svg_pencil.Pencil(pencil_png, pencil_tip)
    frames, masks = [], []
    total = min(
        svg_sketch.draw_frame_count(_line_art_travel_px(root, width, height)),
        max(int(max_frames), 2),
    )
    with tempfile.TemporaryDirectory() as tmp:
        for index in range(total):
            progress = index / (total - 1)
            svg_draw.apply_progress(root, progress, stagger=True)
            frame_svg = os.path.join(tmp, "frame.svg")
            frame_png = os.path.join(tmp, "frame.png")
            ET.ElementTree(root).write(frame_svg, encoding="utf-8", xml_declaration=True)
            try:
                subprocess.run(
                    [
                        "rsvg-convert",
                        "-w",
                        str(_LINE_ART_RENDER_WIDTH),
                        "--keep-aspect-ratio",
                        "-o",
                        frame_png,
                        frame_svg,
                    ],
                    check=True,
                    capture_output=True,
                )
            except (subprocess.CalledProcessError, FileNotFoundError, OSError) as exc:
                logger.warning(f"svg draw: frame {index} failed for {svg_path}: {exc}")
                return []
            rendered = cv2.imread(frame_png, cv2.IMREAD_UNCHANGED)
            if rendered is None:
                logger.warning(f"svg draw: unreadable frame {index} for {svg_path}")
                return []
            canvas, mask = _frame_to_canvas(rendered, width, height, background)
            frames.append(canvas)
            masks.append(mask)
    # clean_final: the completed tracing is the frame the clip hold repeats,
    # so the pencil must not be resting on it.
    return svg_pencil.attach_pencil(
        frames, masks, pencil, angle_offset=_PENCIL_ANGLE_OFFSET, clean_final=True
    )


def _render_drawn_clip(
    svg_path: str,
    out_mp4: str,
    width: int,
    height: int,
    max_clip_duration: int,
    background: tuple,
) -> str:
    """Render the pencil-drawn clip for a catalog SVG, or "" when it cannot.

    Doodly-style artwork (embedded raster) is revealed as a sketch; genuine
    line art is traced stroke by stroke. The clip is exactly
    max_clip_duration long: the draw is sped up when it would not finish in
    time, then held on its last frame (see svg_sketch.fit_frames_to_clip). Any failure
    degrades to the static still path in _persist_svg_item — never to a lost
    clip.
    """
    sprite = svg_pencil.load_sprite()
    if sprite is None:
        return ""
    pencil_png, tip = sprite
    want = max(int(max_clip_duration * svg_sketch.DRAW_FPS), 1)

    try:
        frames = svg_sketch.render_sketch_clip(
            svg_path,
            pencil_png,
            tip,
            None,
            width,
            height,
            direction=(1.0, 1.0),
            angle_offset=_PENCIL_ANGLE_OFFSET,
            monochrome=False,
            background=background,
        )
        if frames is None:
            frames = _drawn_line_art_frames(
                svg_path, pencil_png, tip, width, height, background, want
            )
    except Exception as exc:  # animation must never lose the material
        logger.warning(f"svg drawn clip failed for {svg_path}: {exc}")
        return ""
    if not frames:
        return ""

    frames = svg_sketch.fit_frames_to_clip(frames, want)
    try:
        return svg_sketch.write_clip(frames, out_mp4, fps=svg_sketch.DRAW_FPS)
    except (subprocess.CalledProcessError, OSError) as exc:
        logger.warning(f"svg drawn clip write failed for {svg_path}: {exc}")
        return ""


def resolve_material_path(
    item: MaterialInfo,
    save_dir: str,
    max_clip_duration: int,
    exclude_faces: bool | None,
    video_aspect: VideoAspect = VideoAspect.portrait,
) -> str:
    """Material to a local video file, or "" when it must be skipped.

    Catalog SVGs are fetched from the catalog and rendered into a clip.
    Neutral provider clips are rendered locally (no download, no face
    detection). Every other provider is downloaded. Face detection runs
    only on downloaded footage: an illustrated clip has no real face to
    screen, and the detector would discard most of the cartoon catalog
    for nothing.
    """
    if item.provider == "neutral":
        from app.services import material_verification

        if not save_dir:
            save_dir = utils.storage_dir("cache_videos")
        return material_verification.render_neutral_clip(
            save_dir, max_clip_duration, video_aspect
        )

    if item.provider == "svg":
        rendered = _persist_svg_item(item, save_dir, max_clip_duration, video_aspect)
        if rendered:
            logger.info(f"svg clip rendered: {os.path.basename(rendered)}")
        return rendered

    # Only the download branch needs face detection; importing here keeps
    # catalog-SVG renders from loading the detector stack at all.
    from app.services import face_detect

    path = video_download.save_video(video_url=item.url, save_dir=save_dir)
    if not path:
        return ""
    if face_detect.video_contains_face(path, force_exclude=exclude_faces):
        logger.info(f"video discarded (face detected): {os.path.basename(path)}")
        return ""
    return path

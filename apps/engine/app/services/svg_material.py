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
from app.services import image_material, svg_catalog
from app.utils import utils


# Long edge, in px, used when rasterizing a catalog SVG to a still frame.
# 1080 matches the renderer's long edge, so the Ken Burns zoom never upsamples.
_SVG_RASTER_LONG_EDGE = 1080


def search_videos_svg(
    search_term: str,
    minimum_duration: int,
    video_aspect: VideoAspect = VideoAspect.portrait,
) -> List[MaterialInfo]:
    """Look up catalog SVG assets matching a keyword.

    The aspect is unused: a catalog entry is a still image, and the clip is
    letterboxed to the render size later, when it becomes an mp4.
    """
    del video_aspect
    if not svg_catalog.is_enabled():
        return []
    return [
        MaterialInfo(
            provider="svg",
            url=asset.absolute_path,
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
) -> str:
    """Rasterize a catalog SVG and turn it into a video clip.

    The still is fitted to the target aspect before rendering, because
    combine_videos drops a clip whose letterbox exceeds MAX_LETTERBOX_BARS.

    Cached by a digest of the asset path and the aspect: the same asset in two
    aspects is two different stills.

    An empty save_dir (the shipped default) falls back to the same storage
    cache save_video uses: without it the stills and clips would land as
    CWD-relative paths while every other provider returns absolute ones.
    """
    if not save_dir:
        save_dir = utils.storage_dir("cache_videos")
    if not os.path.exists(save_dir):
        os.makedirs(save_dir)

    width, height = video_aspect.to_resolution()
    digest = hashlib.sha256(
        f"{item.url}|{width}x{height}".encode("utf-8")
    ).hexdigest()[:16]
    png_path = os.path.join(save_dir, f"svg-{digest}.png")
    if not rasterize_svg_to_png(item.url, png_path, width, height):
        return ""

    return image_material.render_image_file_to_mp4(
        png_path, clip_duration=max_clip_duration
    ) or ""


def resolve_material_path(
    item: MaterialInfo,
    save_dir: str,
    max_clip_duration: int,
    exclude_faces: bool | None,
    video_aspect: VideoAspect = VideoAspect.portrait,
) -> str:
    """Material to a local video file, or "" when it must be skipped.

    Catalog SVGs are rasterized into a clip; every other provider is
    downloaded. Face detection runs only on downloaded footage: an illustrated
    clip has no real face to screen, and the detector would discard most of the
    cartoon catalog for nothing.
    """
    # Imported lazily: material.py imports this module at top level, so a
    # top-level import back would be circular. Resolved at call time, which
    # also keeps patch.object(material, "save_video") working in tests.
    from app.services import face_detect
    from app.services.material import save_video

    if item.provider == "svg":
        rendered = _persist_svg_item(item, save_dir, max_clip_duration, video_aspect)
        if rendered:
            logger.info(f"svg clip rendered: {rendered}")
        return rendered

    path = save_video(video_url=item.url, save_dir=save_dir)
    if not path:
        return ""
    if face_detect.video_contains_face(path, force_exclude=exclude_faces):
        logger.info(f"video discarded (face detected): {path}")
        return ""
    return path

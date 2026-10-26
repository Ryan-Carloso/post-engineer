"""Abstract neutral background PNG and clip, sized to the target aspect."""

from __future__ import annotations

import os

from loguru import logger

from app.models.schema import VideoAspect

_BASE_WIDTH = 720
_BASE_HEIGHT = 1280
_CIRCLES = (
    (180, 320, 220, 28),
    (540, 640, 280, 22),
    (360, 980, 240, 26),
)


def render_neutral_png(
    save_dir: str, video_aspect: VideoAspect = VideoAspect.portrait
) -> str:
    """Render an abstract neutral background PNG: gradient plus soft
    circles, implying no place, dish, or person."""
    from PIL import Image, ImageDraw, ImageOps

    width, height = video_aspect.to_resolution()
    scale_x = width / _BASE_WIDTH
    scale_y = height / _BASE_HEIGHT
    radius_scale = min(scale_x, scale_y)
    gradient = ImageOps.colorize(
        Image.linear_gradient("L").resize((1, height)),
        black=(31, 42, 51),
        white=(58, 74, 86),
    )
    image = gradient.resize((width, height)).convert("RGBA")
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for center_x, center_y, radius, alpha in _CIRCLES:
        cx = int(center_x * scale_x)
        cy = int(center_y * scale_y)
        rad = int(radius * radius_scale)
        draw.ellipse(
            (cx - rad, cy - rad, cx + rad, cy + rad),
            fill=(255, 255, 255, alpha),
        )
    image = Image.alpha_composite(image, overlay)
    os.makedirs(save_dir, exist_ok=True)
    path = os.path.join(save_dir, "neutral-background.png")
    image.convert("RGB").save(path, format="PNG")
    return path


def render_neutral_clip(
    save_dir: str, clip_duration: int, video_aspect: VideoAspect
) -> str:
    """Turn the neutral background PNG into a video clip, or "" on failure."""
    try:
        from app.services import image_material

        png_path = render_neutral_png(save_dir, video_aspect)
        return image_material.render_image_file_to_mp4(
            png_path, clip_duration=max(1, int(clip_duration))
        )
    except Exception as exc:  # noqa: BLE001 - a failed neutral is a skipped clip
        logger.warning(f"neutral clip render failed: {exc}")
        return ""

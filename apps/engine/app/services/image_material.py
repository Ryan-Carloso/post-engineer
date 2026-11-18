"""Still images as video material.

Turns a still image into an mp4 clip with a Ken Burns zoom, for the
neutral-background canvas (neutral_background.render_neutral_clip).
Lives in its own module because video.py is grandfathered over the file-size
cap and may not grow by a single line.
"""
from __future__ import annotations

from loguru import logger
from moviepy import CompositeVideoClip, ImageClip


MIN_MATERIAL_EDGE = 480


def render_image_file_to_mp4(image_path: str, clip_duration: int = 4) -> str:
    """Turn a still image into an mp4 clip with a Ken Burns zoom.

    Returns the mp4 path, or "" when the image is unreadable or below the
    minimum size. Used by the neutral-background canvas to turn its still
    into a clip.
    """
    from app.services import video as video_service

    try:
        probe = video_service._open_image_clip_with_fallback(image_path)[0]
    except Exception as exc:
        logger.warning(f"skip unreadable image: {image_path}, error: {str(exc)}")
        return ""

    width, height = probe.size[0], probe.size[1]
    if width < MIN_MATERIAL_EDGE or height < MIN_MATERIAL_EDGE:
        logger.warning(
            f"low resolution material: {width}x{height}, "
            f"minimum {MIN_MATERIAL_EDGE}x{MIN_MATERIAL_EDGE} required"
        )
        video_service.close_clip(probe)
        return ""

    video_service.close_clip(probe)
    clip = None
    final_clip = None
    try:
        clip = (
            ImageClip(image_path).with_duration(clip_duration).with_position("center")
        )
        zoom_clip = clip.resized(
            lambda t: 1 + (clip_duration * 0.03) * (t / clip.duration)
        )
        final_clip = CompositeVideoClip([zoom_clip])
        video_file = f"{image_path}.mp4"
        final_clip.write_videofile(video_file, fps=30, logger=None)
        return video_file
    except Exception as exc:
        logger.warning(f"failed to render image clip: {image_path}, error: {str(exc)}")
        return ""
    finally:
        video_service.close_clip(clip)
        video_service.close_clip(final_clip)

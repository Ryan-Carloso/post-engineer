"""Turn one still image into a vertical YouTube Short.

YouTube is the one network with no public API for image posts. The Data API
``posts`` resource (text and image posts on the channel's Posts tab, formerly
Community) is a pilot "limited to select launch partners (approved Google
Cloud projects)", with "Broader public API access ... planned for General
Availability in 2027":
https://developers.google.com/youtube/data/reference/rest/v3/posts

Until then an image published to YouTube becomes an 8-second 9:16 Short: the
whole image centred over a blurred, zoomed copy of itself, a slow zoom, and a
catalogued background track that fades out. REVALIDATE IN 2027: once
``posts.insert`` is open to every project, publish images to YouTube as image
posts and delete this module. Plan: docs/youtube-image-posts.md. Context and decision: PR #YOUTUBE_IMAGE_SHORT_PR.
"""

from __future__ import annotations

import io
import os
import subprocess
from dataclasses import dataclass
from typing import Callable

from loguru import logger
from PIL import Image, ImageOps, UnidentifiedImageError

from app.services.analytics import scrub_error_text
from app.services.music_mood import get_available_music_moods
from app.utils import utils

SHORT_WIDTH = 1080
SHORT_HEIGHT = 1920
SHORT_SECONDS = 8
SHORT_FPS = 30
SHORT_ZOOM_GAIN = 0.06
SHORT_FADE_OUT_SECONDS = 1.0
SHORT_MUSIC_VOLUME = 0.5
MAX_IMAGE_SHORT_BYTES = 8 * 1024 * 1024
RENDER_TIMEOUT_SECONDS = 180
ACCEPTED_IMAGE_FORMATS = frozenset({"JPEG", "PNG"})

ERROR_INVALID_IMAGE = "invalid_image"
ERROR_IMAGE_TOO_LARGE = "image_too_large"
ERROR_RENDER_FAILED = "render_failed"


class ImageShortError(Exception):
    """A still image that could not become a Short, with a stable code."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class BackgroundTrack:
    path: str
    start_offset: float


def pick_background_track() -> BackgroundTrack | None:
    """A catalogued track for the first catalogued mood, or None when the catalog is empty."""
    from app.services.video import get_bgm_file, get_bgm_start_offset

    moods = get_available_music_moods()
    if not moods:
        logger.error("BGM catalog is empty: image Short renders without music")
        return None
    path = get_bgm_file(moods[0])
    if not path:
        logger.error(f"no BGM track for mood {moods[0]!r}: image Short renders without music")
        return None
    return BackgroundTrack(path=path, start_offset=get_bgm_start_offset(path))


def normalized_png(image_bytes: bytes) -> bytes:
    """Decode a JPEG or PNG, apply its EXIF rotation, and re-encode it as RGB PNG."""
    if len(image_bytes) > MAX_IMAGE_SHORT_BYTES:
        raise ImageShortError(
            ERROR_IMAGE_TOO_LARGE,
            f"image exceeds {MAX_IMAGE_SHORT_BYTES // 1024 // 1024} MB",
        )
    try:
        with Image.open(io.BytesIO(image_bytes)) as opened:
            if opened.format not in ACCEPTED_IMAGE_FORMATS:
                raise ImageShortError(ERROR_INVALID_IMAGE, "image must be a JPEG or PNG")
            upright = ImageOps.exif_transpose(opened).convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ImageShortError(ERROR_INVALID_IMAGE, "image could not be decoded") from exc
    buffer = io.BytesIO()
    upright.save(buffer, format="PNG")
    return buffer.getvalue()


def filter_graph() -> str:
    """The ffmpeg filter graph: blurred cover background, centred contained image, slow zoom."""
    frames = SHORT_SECONDS * SHORT_FPS
    zoom = f"1+{SHORT_ZOOM_GAIN}*on/{frames}"
    fade_start = SHORT_SECONDS - SHORT_FADE_OUT_SECONDS
    return ";".join(
        [
            "[0:v]split=2[cover][contain]",
            f"[cover]scale={SHORT_WIDTH}:{SHORT_HEIGHT}:force_original_aspect_ratio=increase,"
            f"crop={SHORT_WIDTH}:{SHORT_HEIGHT},gblur=sigma=40[background]",
            f"[contain]scale={SHORT_WIDTH}:{SHORT_HEIGHT}:force_original_aspect_ratio=decrease[foreground]",
            "[background][foreground]overlay=(W-w)/2:(H-h)/2:shortest=1,"
            f"scale={SHORT_WIDTH * 2}:{SHORT_HEIGHT * 2},"
            f"zoompan=z='{zoom}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:"
            f"s={SHORT_WIDTH}x{SHORT_HEIGHT}:fps={SHORT_FPS},format=yuv420p[video]",
            f"[1:a]atrim=0:{SHORT_SECONDS},asetpts=PTS-STARTPTS,"
            f"afade=t=in:st=0:d=0.5,afade=t=out:st={fade_start}:d={SHORT_FADE_OUT_SECONDS},"
            f"volume={SHORT_MUSIC_VOLUME}[audio]",
        ]
    )


def ffmpeg_command(
    ffmpeg: str, image_path: str, track: BackgroundTrack | None, output_path: str
) -> list[str]:
    """The full ffmpeg invocation for one Short; a missing track becomes silence."""
    if track is None:
        audio_input = [
            "-f", "lavfi", "-t", str(SHORT_SECONDS), "-i", "anullsrc=r=44100:cl=stereo",
        ]
    else:
        audio_input = ["-ss", f"{track.start_offset:.3f}", "-i", track.path]
    return [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-loop", "1", "-framerate", str(SHORT_FPS), "-t", str(SHORT_SECONDS), "-i", image_path,
        *audio_input,
        "-filter_complex", filter_graph(),
        "-map", "[video]", "-map", "[audio]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "128k",
        "-t", str(SHORT_SECONDS), "-movflags", "+faststart",
        output_path,
    ]


def render_image_short(
    image_bytes: bytes,
    work_dir: str,
    *,
    pick_track: Callable[[], BackgroundTrack | None] = pick_background_track,
    run: Callable[..., subprocess.CompletedProcess[bytes]] = subprocess.run,
) -> bytes:
    """Render a JPEG/PNG into an MP4 Short and return its bytes."""
    image_path = os.path.join(work_dir, "image.png")
    output_path = os.path.join(work_dir, "short.mp4")
    with open(image_path, "wb") as handle:
        handle.write(normalized_png(image_bytes))
    command = ffmpeg_command(utils.get_ffmpeg_binary(), image_path, pick_track(), output_path)
    try:
        completed = run(command, capture_output=True, timeout=RENDER_TIMEOUT_SECONDS, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        message = scrub_error_text(f"image Short render failed: {exc}", max_chars=300)
        logger.error(message)
        raise ImageShortError(ERROR_RENDER_FAILED, message) from exc
    if completed.returncode != 0 or not os.path.isfile(output_path):
        stderr = completed.stderr.decode("utf-8", errors="replace") if completed.stderr else ""
        message = scrub_error_text(
            f"image Short render failed (exit {completed.returncode}): {stderr}", max_chars=300
        )
        logger.error(message)
        raise ImageShortError(ERROR_RENDER_FAILED, message)
    with open(output_path, "rb") as handle:
        return handle.read()

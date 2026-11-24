"""A segment photo shown over the video, as a framed panel or full frame.

Where the persona's face is on screen the photo is a rounded panel with a
white border and a soft shadow, 30px from the bottom edge and about 38% of
the frame tall, so the face shows behind it and the captions sit above it.
Everywhere else (voiceover videos, the images after a hook-only lip-sync
intro) the photo is full frame: contained over a blurred copy of itself, so a
photo that does not fill the frame never leaves black bars.

The panels are prepared at the materials stage (download, checks, drawing)
and written to a manifest in the task directory; the overlay runs when the
final video is assembled. A panel that cannot be drawn or overlaid costs only
the photo, never the video, and is reported as a task warning.

A video clip (segment_video) is a panel too, but a moving one: it plays
full-frame for its seconds, looped on its input and trimmed, and is
never zoomed. Its Panel carries the clip's seconds and frame size.
"""

import contextlib
import json
import os
import subprocess
from collections.abc import Callable
from dataclasses import asdict, dataclass
from typing import Optional, Sequence

from loguru import logger
from PIL import Image, ImageDraw, ImageFilter, ImageOps

from app.models.schema import VideoAspect
from app.services import media_overlay, panel_motion, image_fetch, video
from app.utils import utils

FACE_NONE = "none"
FACE_HOOK = "hook"
FACE_FULL = "full"

FULL_CARD_SIDE = 36
FULL_CARD_TOP_FRACTION = 0.0724
FULL_CARD_HEIGHT_FRACTION = 0.545

PANEL_WIDTH = 1000
EDGE_MARGIN = 30
HEIGHT_FRACTION = 0.38
RADIUS = 36
BORDER = 4
SHADOW_PAD = 40
SHADOW_OFFSET = 8
SHADOW_BLUR = 14
BACKDROP_BLUR = 30
SHADOW_ALPHA = 120
CAPTION_GAP = 24

MANIFEST_NAME = "segment-panels.json"
OVERLAY_TIMEOUT_SECONDS = 600
REASON_RENDER_FAILED = "segment photos were not added to the video: render failed"


@dataclass(frozen=True)
class BuiltPanel:
    """A drawn panel image and where it goes on the frame."""

    path: str
    x: int
    y: int
    card_reason: Optional[str]
    caption_bottom: Optional[int] = None


@dataclass(frozen=True)
class Panel:
    """A built panel with the seconds it is on screen."""

    index: int
    path: str
    x: int
    y: int
    start: float
    end: float
    caption_bottom: Optional[int] = None
    motion: Optional[str] = None
    clip_seconds: Optional[float] = None
    frame_width: Optional[int] = None
    frame_height: Optional[int] = None
    requested_duration: Optional[float] = None


def _scale(width: int, height: int) -> float:
    return min(width, height) / 1080


def panel_rect(width: int, height: int) -> tuple[int, int, int, int]:
    """(x, y, width, height) of the panel on a frame of this size."""
    scale = _scale(width, height)
    panel_width = min(width - 2 * round(40 * scale), round(PANEL_WIDTH * scale))
    panel_height = round(height * HEIGHT_FRACTION)
    edge = round(EDGE_MARGIN * scale)
    return (width - panel_width) // 2, height - edge - panel_height, panel_width, panel_height


def full_card_rect(width: int, height: int) -> tuple[int, int, int, int]:
    """The rectangle the info card is laid out in on a full-frame photo."""
    side = round(FULL_CARD_SIDE * _scale(width, height))
    top = round(height * FULL_CARD_TOP_FRACTION)
    return side, top, width - side, top + round(height * FULL_CARD_HEIGHT_FRACTION)


def build_full(
    photo_path: str,
    overlay: Optional[dict],
    font_for: Optional[media_overlay.FontFor],
    aspect: VideoAspect,
    out_path: str,
) -> Optional[BuiltPanel]:
    """Draw one full-frame photo as an opaque PNG; None when it cannot be read.

    The whole photo is contained over a blurred copy of itself (the same
    composition place photos use), so nothing is cropped away and a photo
    that does not fill the frame leaves no black bars.
    """
    width, height = aspect.to_resolution()
    still_path = f"{out_path}.still.jpg"
    try:
        if not image_fetch.compose_portrait_still(photo_path, still_path, aspect):
            return None
        with Image.open(still_path) as opened:
            layer = opened.convert("RGBA")
        card_reason: Optional[str] = None
        if overlay is not None:
            if font_for is None:
                card_reason = media_overlay.REASON_NO_FONT
            else:
                card_reason = media_overlay.paint_card(
                    layer, overlay, font_for, _scale(width, height), full_card_rect(width, height)
                )
        layer.convert("RGB").save(out_path, "PNG")
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        logger.warning(f"segment full-frame photo unusable: {type(exc).__name__}")
        return None
    finally:
        with contextlib.suppress(OSError):
            os.remove(still_path)
    return BuiltPanel(path=out_path, x=0, y=0, card_reason=card_reason)


def build_panel(
    photo_path: str,
    overlay: Optional[dict],
    font_for: Optional[media_overlay.FontFor],
    aspect: VideoAspect,
    out_path: str,
) -> Optional[BuiltPanel]:
    """Draw one panel as a transparent PNG; None when the photo cannot be read.

    The whole photo is shown (contained over a blurred copy of itself), and a
    card that cannot be drawn leaves the plain photo, reported in `card_reason`.
    """
    width, height = aspect.to_resolution()
    scale = _scale(width, height)
    x, y, panel_width, panel_height = panel_rect(width, height)
    try:
        with Image.open(photo_path) as opened:
            photo = ImageOps.exif_transpose(opened).convert("RGB")
        backdrop = ImageOps.fit(photo, (panel_width, panel_height), Image.Resampling.LANCZOS)
        backdrop = backdrop.filter(ImageFilter.GaussianBlur(BACKDROP_BLUR * scale))
        front = ImageOps.contain(photo, (panel_width, panel_height), Image.Resampling.LANCZOS)
        backdrop.paste(front, ((panel_width - front.width) // 2, (panel_height - front.height) // 2))
        panel = backdrop.convert("RGBA")
        card_reason: Optional[str] = None
        if overlay is not None:
            if font_for is None:
                card_reason = media_overlay.REASON_NO_FONT
            else:
                card_reason = media_overlay.paint_card(panel, overlay, font_for, scale, (0, 0, panel_width, panel_height))
        pad = round(SHADOW_PAD * scale)
        radius = round(RADIUS * scale)
        canvas = Image.new("RGBA", (panel_width + 2 * pad, panel_height + 2 * pad), (0, 0, 0, 0))
        shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        offset = round(SHADOW_OFFSET * scale)
        ImageDraw.Draw(shadow).rounded_rectangle(
            (pad, pad + offset, pad + panel_width, pad + panel_height + offset), radius=radius, fill=(0, 0, 0, SHADOW_ALPHA)
        )
        canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(SHADOW_BLUR * scale)))
        mask = Image.new("L", panel.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, panel_width - 1, panel_height - 1), radius=radius, fill=255)
        rounded = Image.new("RGBA", panel.size, (0, 0, 0, 0))
        rounded.paste(panel, (0, 0), mask)
        canvas.alpha_composite(rounded, (pad, pad))
        ImageDraw.Draw(canvas).rounded_rectangle(
            (pad, pad, pad + panel_width - 1, pad + panel_height - 1),
            radius=radius,
            outline=(255, 255, 255, 255),
            width=max(1, round(BORDER * scale)),
        )
        canvas.save(out_path, "PNG")
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        logger.warning(f"segment panel unusable: {type(exc).__name__}")
        return None
    return BuiltPanel(path=out_path, x=x - pad, y=y - pad, card_reason=card_reason, caption_bottom=y - round(CAPTION_GAP * scale))


def _manifest_path(task_id: str) -> str:
    return os.path.join(utils.task_dir(task_id), MANIFEST_NAME)


def write_manifest(task_id: str, panels: Sequence[Panel], warnings: Sequence[str]) -> None:
    """Persist the prepared panels for the final-assembly step."""
    with open(_manifest_path(task_id), "w", encoding="utf-8") as handle:
        json.dump({"panels": [asdict(panel) for panel in panels], "warnings": list(warnings)}, handle)


def _read_manifest(task_id: str) -> tuple[list[Panel], list[str]]:
    path = _manifest_path(task_id)
    if not os.path.exists(path):
        return [], []
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    return [Panel(**item) for item in data["panels"]], list(data["warnings"])


def caption_bands(task_id: str) -> list[tuple[float, float, int]]:
    """(start, end, lowest caption pixel) for every panel on screen.

    A full-frame photo covers the frame and imposes no band (caption_layout).
    """
    panels, _warnings = _read_manifest(task_id)
    return [
        (panel.start, panel.end, panel.caption_bottom)
        for panel in panels
        if panel.caption_bottom is not None
    ]


def _clip_filter(input_label: str, panel: Panel, output_label: str) -> str:
    """Filter chain fitting one clip to the frame for its seconds on screen.

    The clip is scaled up to fill the frame and centre-cropped, then
    trimmed to the panel's seconds (the looped input supplies the frames)
    and re-timed to start at the panel's start, like the zoompan path:
    without the shift the clip's frames would play from t=0 instead of
    from the take.
    """
    seconds = max(0.0, panel.end - panel.start)
    width, height = panel.frame_width, panel.frame_height
    return (
        f"[{input_label}]scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height},trim=0:{seconds:.3f},"
        f"setpts=PTS-STARTPTS+{panel.start:.3f}/TB[{output_label}]"
    )


def overlay_command(
    video_path: str,
    panels: Sequence[Panel],
    output_path: str,
    codec: str,
    preset: str,
    ffmpeg: str,
    frame_size: Optional[tuple[int, int]] = None,
    transition_mode: object = None,
) -> list[str]:
    """ffmpeg argv overlaying each panel for its seconds, in segment order.

    A still panel is a looped image (shortest=1 ends it with the video). A
    panel with motion is a single image zoompan turns into a finite clip of
    frame_size, so its overlay passes the video through after the clip ends.
    A video clip is looped on its input (stream_loop) and trimmed to its
    seconds, so a short clip fills its take and a long one is cut; its
    audio track is never mapped, so only the spoken script is heard. A
    clip without a frame size is a caller bug: fail loudly, never guess.
    """
    command = [ffmpeg, "-y", "-i", video_path]
    for panel in panels:
        if panel.clip_seconds is not None:
            if panel.frame_width is None or panel.frame_height is None:
                raise ValueError("a video clip panel needs a frame size")
            command += ["-stream_loop", "-1", "-i", panel.path]
        elif _moves(panel, frame_size):
            command += ["-i", panel.path]
        else:
            command += ["-loop", "1", "-i", panel.path]
    crossfade = transition_mode == "Crossfade"
    steps: list[str] = []
    source = "0:v"
    seen_full = False
    for position, panel in enumerate(panels):
        target = f"v{position}"
        layer = f"{position + 1}:v"
        ending = "shortest=1"
        lead = 0.0
        if panel.clip_seconds is not None:
            steps.append(_clip_filter(layer, panel, f"c{position}"))
            layer, ending = f"c{position}", "eof_action=pass"
            seen_full = False
        elif frame_size is not None and _moves(panel, frame_size):
            if crossfade and seen_full:
                previous = panels[position - 1]
                lead = min(panel_motion.CROSSFADE_SECONDS, max(0.0, previous.end - previous.start))
            steps.append(
                panel_motion.zoom_filter(
                    layer, panel, frame_size[0], frame_size[1], f"m{position}", lead_seconds=lead
                )
            )
            layer, ending = f"m{position}", "eof_action=pass"
            if lead > 0:
                steps.append(
                    panel_motion.crossfade_in_filter(layer, panel.start - lead, lead, f"f{position}")
                )
                layer = f"f{position}"
            seen_full = True
        else:
            seen_full = False
        steps.append(
            f"[{source}][{layer}]overlay={panel.x}:{panel.y}"
            f":enable='between(t,{panel.start - lead:.3f},{panel.end:.3f})':{ending}[{target}]"
        )
        source = target
    return command + [
        "-filter_complex", ";".join(steps),
        "-map", f"[{source}]",
        "-map", "0:a?",
        "-c:v", codec,
        "-preset", preset,
        "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        output_path,
    ]


def _moves(panel: Panel, frame_size: Optional[tuple[int, int]]) -> bool:
    return panel.motion is not None and frame_size is not None


def _frame_size(panels: Sequence[Panel]) -> Optional[tuple[int, int]]:
    """The full-frame photo size zoompan renders at, when any panel moves."""
    moving = next((panel for panel in panels if panel.motion is not None), None)
    if moving is None:
        return None
    with Image.open(moving.path) as opened:
        return opened.size


def overlay_onto(
    task_id: str, video_path: str, record: Callable[..., None], transition_mode: object = None
) -> str:
    """The video with its segment panels.

    Without a manifest or without panels the video passes through untouched.
    A failed render keeps the video without photos and calls
    `record(task_id, media_warnings=...)` with the stored warnings plus the
    render failure, so the status endpoint still tells the caller the photos
    are missing. No panel landed, so the manifest then carries none and the
    final encode imposes no caption band for a photo that is not there.
    """
    panels, warnings = _read_manifest(task_id)
    if not panels:
        return video_path
    output_path = f"{os.path.splitext(video_path)[0]}-panels.mp4"
    try:
        command = overlay_command(
            video_path,
            panels,
            output_path,
            video._get_effective_video_codec(),
            video._get_configured_video_preset(),
            utils.get_ffmpeg_binary(),
            frame_size=_frame_size(panels),
            transition_mode=transition_mode,
        )
        video._run_ffmpeg_bounded(command, timeout=OVERLAY_TIMEOUT_SECONDS, failure_message="segment panel overlay failed")
    except (RuntimeError, subprocess.TimeoutExpired, OSError) as exc:
        logger.error(f"segment panel overlay failed: {type(exc).__name__}")
        record(task_id, media_warnings=[*warnings, REASON_RENDER_FAILED])
        write_manifest(task_id, [], warnings)
        return video_path
    return output_path

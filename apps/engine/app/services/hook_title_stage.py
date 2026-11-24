"""Materials-stage step for the hook title: when it shows and drawing it.

Kept apart from user_media (over its size budget) and from hook_title (pure
text and drawing, no pipeline imports). The title shows from the first frame
for at most HOOK_TITLE_SECONDS, cut short by the first segment (the hook)
and by the audio, so a title never outlasts the line it headlines.
"""

import os
from typing import Any, Optional

from loguru import logger

from app.models.schema import VideoAspect
from app.services import hook_title, media_overlay, video
from app.services.segment_intervals import segment_intervals_from_subtitle

BAND_NAME = "hook-title.png"
REASON_NO_WINDOW = "hook title not added: no time on screen"


def _first_segment_end(segments: Any, subtitle_path: str, audio_duration: float) -> Optional[float]:
    """Where the first segment (the hook) stops being spoken; None without segments."""
    if not segments:
        return None
    dicts = [
        segment if isinstance(segment, dict) else dict(segment.model_dump(exclude_none=True))
        for segment in segments
    ]
    intervals, _fallback = segment_intervals_from_subtitle(dicts, subtitle_path, audio_duration)
    return intervals[0][1] if intervals else None


def _font(params: Any) -> Optional[media_overlay.FontFor]:
    try:
        return media_overlay.font_loader(video._resolve_font_with_fallback(params))
    except (ValueError, OSError, AttributeError) as exc:
        logger.warning(f"hook title font unavailable: {type(exc).__name__}")
        return None


def prepare_title(
    params: Any, subtitle_path: str, audio_duration: float, aspect: VideoAspect, task_dir: str
) -> tuple[Optional[hook_title.TitleLayer], list[str]]:
    """The drawn title and its skip warnings: (layer, []) or (None, [stable reason]).

    No hook_title on the request is no title and no warning.
    """
    text = getattr(params, "hook_title", None)
    if text is None:
        return None, []
    end = hook_title.title_end(
        _first_segment_end(getattr(params, "segments", None), subtitle_path, audio_duration), audio_duration
    )
    if end <= 0:
        return None, [REASON_NO_WINDOW]
    layer, reason = hook_title.build_title(
        text, _font(params), aspect.to_resolution(), os.path.join(task_dir, BAND_NAME), end
    )
    return layer, [] if reason is None else [reason]

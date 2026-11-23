"""Lip-sync captions stay within two lines so they clear the speaker's chin.

The final encode of a lip-sync video moves the caption to
`LIPSYNC_CAPTION_POSITION`. A cue that wraps to a third line grows the block
past the chin, so on that path a cue is split into balanced, time-shared
parts until every part wraps to at most `LIPSYNC_MAX_LINES` lines. Other
paths are returned unchanged.
"""

from app.models.schema import VideoParams
from app.services import full_lipsync, subtitle_cues
from app.services.subtitle_text import wrap_text

LIPSYNC_MAX_LINES = 2


def max_lines(params: VideoParams) -> int | None:
    moved = (
        params.subtitle_position == "custom"
        and params.custom_position == full_lipsync.LIPSYNC_CAPTION_POSITION
    )
    if moved and full_lipsync.captions_on_face(params):
        return LIPSYNC_MAX_LINES
    return None


def text_box(font_size: int, has_background: bool, max_width: float) -> tuple[int, int]:
    pad_x = int(font_size * 0.6) if has_background else 0
    return pad_x, max(1, int(max_width) - 2 * pad_x)


def _line_count(text: str, width: int, font_path: str, font_size: int) -> int:
    wrapped, _ = wrap_text(text, max_width=width, font=font_path, fontsize=font_size)
    return wrapped.count("\n") + 1


def split_to_fit(text: str, fits) -> list[str]:
    words = text.split()
    for chunk_words in range(len(words), 0, -1):
        parts = subtitle_cues.split_cue(text, chunk_words)
        if all(fits(part) for part in parts):
            return parts
    return subtitle_cues.split_cue(text, 1)


def cap_items(subtitles, params: VideoParams, font_path: str, video_width: int, has_background: bool):
    limit = max_lines(params)
    if limit is None:
        return list(subtitles)
    _, width = text_box(params.font_size, has_background, video_width * 0.9)

    def fits(part: str) -> bool:
        return _line_count(part, width, font_path, params.font_size) <= limit

    capped = []
    for (start, end), text in subtitles:
        parts = split_to_fit(text, fits)
        total = sum(len(part) for part in parts)
        cursor, covered = start, 0
        for part in parts:
            covered += len(part)
            part_end = end if covered == total else start + (end - start) * covered / total
            capped.append(((cursor, part_end), part))
            cursor = part_end
    return capped

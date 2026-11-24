"""The on-screen hook title (`hook_title`): a short headline over the first seconds.

The text rules mirror shared/script-segments/hook-title.ts (a file-parsing
test pins the literals), so the web API, the MCP and the engine refuse the
same title with the same stable code before any token is charged. A title is
a headline: punctuation and case are kept as written, only whitespace runs
are collapsed and the ends trimmed. A newline or any control character is
refused, because the engine decides where the two lines break.

The title is drawn at the materials stage as one transparent PNG band at the
top of the frame (white text, dark stroke), below the status bar and clear of
the face. A title that cannot be drawn is refused with a stable reason and
the video ships without it (the caller records that as a task warning).
Nothing here logs the text.
"""

import re
import unicodedata
from dataclasses import dataclass
from typing import Optional

from loguru import logger
from PIL import Image, ImageDraw

from app.services import media_overlay

HOOK_TITLE_MAX_WORDS = 7
HOOK_TITLE_MAX_CHARS = 60
HOOK_TITLE_SECONDS = 3.0

CODE_EMPTY = "HOOK_TITLE_EMPTY"
CODE_TOO_MANY_WORDS = "HOOK_TITLE_TOO_MANY_WORDS"
CODE_TOO_LONG = "HOOK_TITLE_TOO_LONG"
CODE_INVALID_CHARS = "HOOK_TITLE_INVALID_CHARS"

TITLE_SIZES = (96, 88, 80)
MAX_LINES = 2
TOP_FRACTION = 0.0724
MAX_BOTTOM_FRACTION = 0.22
SIDE_MARGIN = 36
STROKE_WIDTH = 6
FLOOR_GAP = 24
TEXT_COLOR = (255, 255, 255, 255)
STROKE_COLOR = (0, 0, 0, 255)

REASON_NO_FONT = "hook title not added: font unavailable"
REASON_NO_FIT = "hook title not added: text does not fit"
REASON_RENDER_FAILED = "hook title not added: render failed"

# JS `\s` also matches U+FEFF (a byte-order mark); Python `\s` does not. Match it
# here so a direct caller and the web API normalize to the same stored title.
_SPACES = re.compile(r"[\s\ufeff]+")


class HookTitleError(ValueError):
    """A title that breaks a rule: `code` is the stable code, the message names the rule."""

    def __init__(self, code: str, rule: str) -> None:
        super().__init__(f"{code}: {rule}")
        self.code = code


def normalize(value: str) -> str:
    """Whitespace runs collapsed, ends trimmed; punctuation and case untouched."""
    return _SPACES.sub(" ", value).strip()


def check_text(value: str) -> str:
    """The normalized title, or HookTitleError for the first rule it breaks."""
    if any(unicodedata.category(char) == "Cc" for char in value):
        raise HookTitleError(CODE_INVALID_CHARS, "hook_title must not contain a newline or a control character.")
    text = normalize(value)
    if not text:
        raise HookTitleError(CODE_EMPTY, "hook_title must not be empty or only spaces.")
    if len(text) > HOOK_TITLE_MAX_CHARS:
        raise HookTitleError(CODE_TOO_LONG, f"hook_title must have at most {HOOK_TITLE_MAX_CHARS} characters.")
    if len(text.split(" ")) > HOOK_TITLE_MAX_WORDS:
        raise HookTitleError(CODE_TOO_MANY_WORDS, f"hook_title must have at most {HOOK_TITLE_MAX_WORDS} words.")
    return text


@dataclass(frozen=True)
class TitleLayer:
    """A drawn title band, where it goes and when it is on screen.

    `floor` is the lowest pixel the band reaches plus a gap: nothing the
    viewer must read (a caption, an info card) may start above it while the
    title shows.
    """

    path: str
    x: int
    y: int
    start: float
    end: float
    floor: int


def title_end(first_segment_end: Optional[float], audio_duration: float) -> float:
    """Where the title leaves: its window, cut short by the first segment and the audio."""
    limits = [HOOK_TITLE_SECONDS, audio_duration]
    if first_segment_end is not None:
        limits.append(first_segment_end)
    return max(0.0, min(limits))


def card_top(title: Optional[TitleLayer], panel_start: float) -> Optional[int]:
    """Where a full-frame info card starts so it clears the title, or None to keep its place.

    The card PNG is static, so a photo that starts while the title shows
    keeps the lower card for its whole time on screen.
    """
    return title.floor if title is not None and panel_start < title.end else None


def _scale(width: int, height: int) -> float:
    return min(width, height) / 1080


def build_title(
    text: str,
    font_for: Optional[media_overlay.FontFor],
    size: tuple[int, int],
    out_path: str,
    end: float,
) -> tuple[Optional[TitleLayer], Optional[str]]:
    """Draw the title band as a transparent PNG: (layer, None) or (None, stable reason).

    The largest size whose wrapped lines (at most two) end above the face
    zone is used; text that fits at none is refused, never shrunk or cut.
    """
    width, height = size
    if font_for is None:
        return None, REASON_NO_FONT
    scale = _scale(width, height)
    top = round(height * TOP_FRACTION)
    stroke = max(1, round(STROKE_WIDTH * scale))
    inner = width - 2 * round(SIDE_MARGIN * scale) - 2 * stroke
    try:
        # The band is its lines plus a stroke above and below, so its bottom edge is
        # `top + 2 * stroke + lines * line_height`: that is what must clear the limit.
        chosen = _choose(text, font_for, scale, inner, top + 2 * stroke, round(height * MAX_BOTTOM_FRACTION))
        if chosen is None:
            return None, REASON_NO_FIT
        pixels, lines, line_height = chosen
        font = font_for(pixels)
        band_height = len(lines) * line_height + 2 * stroke
        band = Image.new("RGBA", (width, band_height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(band)
        for number, line in enumerate(lines):
            draw.text(
                ((width - font.getlength(line)) / 2, stroke + number * line_height),
                line,
                font=font,
                fill=TEXT_COLOR,
                stroke_width=stroke,
                stroke_fill=STROKE_COLOR,
            )
    except OSError as exc:
        logger.warning(f"hook title font unavailable: {type(exc).__name__}")
        return None, REASON_NO_FONT
    try:
        band.save(out_path, "PNG")
    except OSError as exc:
        logger.warning(f"hook title not written: {type(exc).__name__}")
        return None, REASON_RENDER_FAILED
    layer = TitleLayer(
        path=out_path,
        x=0,
        y=top,
        start=0.0,
        end=end,
        floor=top + band_height + round(FLOOR_GAP * scale),
    )
    return layer, None


def _choose(
    text: str, font_for: media_overlay.FontFor, scale: float, inner: float, top: int, limit: int
) -> Optional[tuple[int, list[str], int]]:
    """(pixel size, lines, line height) of the largest size whose band ends at or above `limit`.

    `top` is the band's top edge plus the stroke padding at both its top and bottom.
    """
    for size in TITLE_SIZES:
        fitted = media_overlay.fit(text, font_for, (size,), scale, inner, MAX_LINES)
        if fitted is None:
            continue
        pixels, lines = fitted
        line_height = media_overlay.line_height(font_for(pixels), scale)
        if top + len(lines) * line_height <= limit:
            return pixels, lines, line_height
    return None

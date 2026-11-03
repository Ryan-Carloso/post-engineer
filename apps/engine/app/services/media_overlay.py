"""The info card painted on a segment photo (a panel or a full-frame photo).

A place photo is more useful with the real name, the address and the price
on screen. The card sits at the top of the photo, inset from its edges so
the photo still shows around it, and never grows past about half of the
rectangle it is laid out in. It has no border of its own. The photo is an
overlay on the video and the subtitles are burned in after it, so the
subtitles always land on top of the card.

Text is never truncated or shrunk below a readable size. A title that does
not fit in two lines, or a card that would outgrow its box, is refused with
a stable reason and the photo ships without a card (the caller records the
reason as a task warning). Nothing here logs the text: it comes from the
caller's research, not from this service.
"""

import re
from collections.abc import Callable
from typing import Optional

from loguru import logger
from PIL import Image, ImageDraw, ImageFont

FontFor = Callable[[int], ImageFont.FreeTypeFont]

# Layout constants are for a 1080-pixel short edge and scale with it.
INSET = 24
MAX_HEIGHT_FRACTION = 0.55
PADDING = 30
RADIUS = 26
LINE_GAP = 8
BLOCK_GAP = 16
TITLE_SIZES = (56, 50, 46, 42, 38)
SUBTITLE_SIZES = (36, 32, 28)
BADGE_SIZE = 32
BADGE_PAD_X = 20
BADGE_PAD_Y = 7
MAX_TITLE_LINES = 2
MAX_SUBTITLE_LINES = 2

CARD_FILL = (12, 12, 12, 175)
TEXT_COLOR = (255, 255, 255, 255)
SUBTITLE_COLOR = (230, 230, 230, 255)
BADGE_FILL = (255, 196, 0, 255)
BADGE_TEXT = (20, 20, 20, 255)

REASON_NO_TITLE = "overlay has no title"
REASON_NO_FIT = "overlay text does not fit"
REASON_NO_FONT = "overlay font unavailable"

_SPACES = re.compile(r"\s+")


def font_loader(font_path: str) -> FontFor:
    """A size -> font function for one font file; raises OSError on a broken file."""

    def load(size: int) -> ImageFont.FreeTypeFont:
        return ImageFont.truetype(font_path, size)

    return load


def _clean(value: object) -> str:
    return _SPACES.sub(" ", value).strip() if isinstance(value, str) else ""


def _wrap(text: str, font: ImageFont.FreeTypeFont, max_width: float) -> Optional[list[str]]:
    """Greedy word wrap; None when a single word is wider than the line."""
    lines: list[str] = []
    current = ""
    for word in text.split(" "):
        if font.getlength(word) > max_width:
            return None
        candidate = f"{current} {word}".strip()
        if current and font.getlength(candidate) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def _fit(
    text: str, font_for: FontFor, sizes: tuple[int, ...], scale: float, max_width: float, max_lines: int
) -> Optional[tuple[int, list[str]]]:
    """The largest size whose wrapped text fits: (pixel size, lines)."""
    for size in sizes:
        pixels = round(size * scale)
        lines = _wrap(text, font_for(pixels), max_width)
        if lines is not None and len(lines) <= max_lines:
            return pixels, lines
    return None


def _line_height(font: ImageFont.FreeTypeFont, scale: float) -> int:
    ascent, descent = font.getmetrics()
    return ascent + descent + round(LINE_GAP * scale)


def _layout(overlay: dict, font_for: FontFor, scale: float, box_width: int, max_height: int) -> Optional[dict]:
    """Sizes, wrapped lines and total height of the card; None when it cannot fit."""
    inner = box_width - 2 * round(PADDING * scale)
    title = _clean(overlay.get("title"))
    subtitle = _clean(overlay.get("subtitle"))
    badge = _clean(overlay.get("badge"))
    title_fit = _fit(title, font_for, TITLE_SIZES, scale, inner, MAX_TITLE_LINES)
    if title_fit is None:
        return None
    layout: dict = {"title": title_fit, "subtitle": None, "badge": None}
    total = 2 * round(PADDING * scale)
    total += len(title_fit[1]) * _line_height(font_for(title_fit[0]), scale)
    if subtitle:
        subtitle_fit = _fit(subtitle, font_for, SUBTITLE_SIZES, scale, inner, MAX_SUBTITLE_LINES)
        if subtitle_fit is None:
            return None
        layout["subtitle"] = subtitle_fit
        total += round(BLOCK_GAP * scale)
        total += len(subtitle_fit[1]) * _line_height(font_for(subtitle_fit[0]), scale)
    if badge:
        badge_font = font_for(round(BADGE_SIZE * scale))
        if badge_font.getlength(badge) + 2 * round(BADGE_PAD_X * scale) > inner:
            return None
        layout["badge"] = (round(BADGE_SIZE * scale), badge)
        total += _line_height(badge_font, scale) + 2 * round(BADGE_PAD_Y * scale) + round(BLOCK_GAP * scale)
    if total > max_height:
        return None
    layout["height"] = total
    return layout


def card_geometry(rect: tuple[int, int, int, int], scale: float) -> tuple[int, int, int, int]:
    """(left, top, width, max height) the card may use inside a panel rect."""
    left, top, right, bottom = rect
    inset = round(INSET * scale)
    return left + inset, top + inset, (right - left) - 2 * inset, round((bottom - top) * MAX_HEIGHT_FRACTION)


def measure_card(overlay: dict, font_for: FontFor, scale: float, rect: tuple[int, int, int, int]) -> Optional[int]:
    """Pixel height of the card for this text inside `rect`, or None when it cannot fit."""
    if not _clean(overlay.get("title")):
        return None
    _, _, width, max_height = card_geometry(rect, scale)
    layout = _layout(overlay, font_for, scale, width, max_height)
    return None if layout is None else layout["height"]


def paint_card(
    layer: Image.Image, overlay: dict, font_for: FontFor, scale: float, rect: tuple[int, int, int, int]
) -> Optional[str]:
    """Paint the card onto an RGBA layer, inside the panel `rect`.

    Returns None on success, or a stable reason string; on any refusal the
    layer is left untouched.
    """
    if not _clean(overlay.get("title")):
        return REASON_NO_TITLE
    left, top, width, max_height = card_geometry(rect, scale)
    try:
        layout = _layout(overlay, font_for, scale, width, max_height)
    except OSError as exc:
        logger.warning(f"overlay font unavailable: {type(exc).__name__}")
        return REASON_NO_FONT
    if layout is None:
        return REASON_NO_FIT
    card = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    draw.rounded_rectangle(
        (left, top, left + width, top + layout["height"]), radius=round(RADIUS * scale), fill=CARD_FILL
    )
    _draw_text(draw, layout, font_for, scale, left + round(PADDING * scale), top + round(PADDING * scale))
    layer.alpha_composite(card)
    return None


def _draw_text(draw: ImageDraw.ImageDraw, layout: dict, font_for: FontFor, scale: float, x: int, y: int) -> None:
    cursor = y
    if layout["badge"] is not None:
        size, text = layout["badge"]
        font = font_for(size)
        pad_x, pad_y = round(BADGE_PAD_X * scale), round(BADGE_PAD_Y * scale)
        line = _line_height(font, scale)
        pill = (x, cursor, x + round(font.getlength(text)) + 2 * pad_x, cursor + line + 2 * pad_y)
        draw.rounded_rectangle(pill, radius=(pill[3] - pill[1]) // 2, fill=BADGE_FILL)
        draw.text((x + pad_x, cursor + pad_y), text, font=font, fill=BADGE_TEXT)
        cursor = pill[3] + round(BLOCK_GAP * scale)
    size, lines = layout["title"]
    font = font_for(size)
    for text in lines:
        draw.text((x, cursor), text, font=font, fill=TEXT_COLOR)
        cursor += _line_height(font, scale)
    if layout["subtitle"] is not None:
        cursor += round(BLOCK_GAP * scale)
        size, lines = layout["subtitle"]
        font = font_for(size)
        for text in lines:
            draw.text((x, cursor), text, font=font, fill=SUBTITLE_COLOR)
            cursor += _line_height(font, scale)

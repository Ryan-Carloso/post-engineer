"""Subtitle text wrapping for the video renderer.

Extracted from app.services.video so the video module stays under the
file-size ratchet. Pure text measurement: it imports only PIL, never
app.services, so there is no import cycle.
"""

from PIL import ImageFont


def wrap_text(text, max_width, font="Arial", fontsize=60):
    # Subtitle wrapping must happen before the real TextClip is created, or
    # MoviePy will size the render area from the raw text. Measure width with
    # PIL at the current font/size so every line stays within the usable
    # video width — large sizes or long CJK sentences would otherwise
    # overflow the frame.
    font = ImageFont.truetype(font, fontsize)
    max_width = int(max_width)

    def get_text_size(inner_text):
        inner_text = inner_text.strip()
        if not inner_text:
            return 0, fontsize
        left, top, right, bottom = font.getbbox(inner_text)
        return right - left, bottom - top

    width, height = get_text_size(text)
    if width <= max_width:
        return text, height

    def split_long_token(token):
        # When a single token is already too wide (common with spaceless CJK
        # sentences or very long English words), fall back to per-character
        # splitting. The key rule: when a candidate goes over width, commit
        # the last still-valid line first, then start the next line with the
        # current character — never push the over-wide character back onto
        # the previous line.
        lines = []
        current = ""
        for char in token:
            candidate = f"{current}{char}"
            candidate_width, _ = get_text_size(candidate)
            if candidate_width <= max_width or not current:
                current = candidate
                continue
            lines.append(current)
            current = char
        if current:
            lines.append(current)
        return lines

    lines = []
    current = ""
    words = text.split(" ")
    for word in words:
        candidate = f"{current} {word}".strip() if current else word
        candidate_width, _ = get_text_size(candidate)
        if candidate_width <= max_width:
            current = candidate
            continue

        if current:
            lines.append(current)

        word_width, _ = get_text_size(word)
        if word_width <= max_width:
            current = word
        else:
            lines.extend(split_long_token(word))
            current = ""

    if current:
        lines.append(current)

    line_start_punctuation = "，。！？；：、,.!?;:)]}）】》」』”’"
    for index in range(1, len(lines)):
        # When a long CJK sentence is split per character, a trailing period,
        # comma, or other closing punctuation can land alone on the next
        # line, stretching the subtitle background abnormally — like a stray
        # dot hanging under the text. Without redesigning the wrap algorithm,
        # move the previous line's last character in front of the punctuation
        # line so the mark follows its text. Covers common CJK and English
        # closing punctuation.
        if not lines[index] or lines[index][0] not in line_start_punctuation:
            continue
        if len(lines[index - 1]) <= 1:
            continue

        candidate = f"{lines[index - 1][-1]}{lines[index]}"
        candidate_width, _ = get_text_size(candidate)
        if candidate_width <= max_width:
            lines[index] = candidate
            lines[index - 1] = lines[index - 1][:-1]

    result = "\n".join(line.strip() for line in lines if line.strip()).strip()
    height = len(lines) * height
    return result, height

"""Subtitle font size relative to the frame.

`font_size` (config `[ui]` or the request) is a size in pixels for a frame
whose short side is 1080 px: portrait 1080x1920 and landscape 1920x1080 use
it as is, smaller or larger frames scale it so captions keep the same share
of the frame.

generate_video applies it to a copy of the request params: scaling the
caller's params in place would compound across several videos.
"""

# Short side, in pixels, that `font_size` is defined for.
REFERENCE_SHORT_SIDE = 1080
# Lower bound of VideoParams.font_size (pinned by a test against the schema).
MIN_FONT_SIZE = 8


def scaled_font_size(font_size: int, video_width: int, video_height: int) -> int:
    scaled = round(font_size * min(video_width, video_height) / REFERENCE_SHORT_SIDE)
    return max(MIN_FONT_SIZE, scaled)

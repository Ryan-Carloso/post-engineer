"""Failure reporting for the direct ffmpeg clip re-encode in video.py."""

import os
from typing import NoReturn

from loguru import logger

from app.services.analytics import scrub_error_text

# ffmpeg prints its banner and stream info first; the cause is in the last
# lines. Cut by line before scrubbing so no secret is split mid-value, then
# let scrub_error_text cap the characters after the scrub.
FFMPEG_STDERR_TAIL_LINES = 10
FFMPEG_STDERR_TAIL_CHARS = 500
# Bound of the combined raised/logged detail (scrubbed str(exc) + label +
# scrubbed stderr tail).
FFMPEG_REENCODE_DETAIL_CHARS = 500


class FfmpegReencodeError(RuntimeError):
    """A clip re-encode failed. The failure is already logged at ERROR."""


def ffmpeg_stderr_tail(exc: BaseException) -> str:
    """Scrubbed, truncated tail of the stderr captured on exc ('' if none).

    str(CalledProcessError) holds only the command and exit code, so the
    real ffmpeg cause is lost without this. OSError has no stderr.
    """
    stderr = getattr(exc, "stderr", None)
    if isinstance(stderr, bytes):
        stderr = stderr.decode("utf-8", errors="replace")
    if not isinstance(stderr, str):
        return ""
    lines = stderr.strip().splitlines()[-FFMPEG_STDERR_TAIL_LINES:]
    return scrub_error_text("\n".join(lines), max_chars=FFMPEG_STDERR_TAIL_CHARS)


def raise_reencode_failure(src: str, exc: BaseException) -> NoReturn:
    # str(CalledProcessError/TimeoutExpired) echoes the full ffmpeg command
    # line (absolute src/out paths); scrub it like the stderr tail so the
    # log line and the raised message both stay basename-only.
    detail = scrub_error_text(str(exc))
    tail = ffmpeg_stderr_tail(exc)
    if tail:
        sep = "; ffmpeg stderr: "
        # Cap the combination at FFMPEG_REENCODE_DETAIL_CHARS by trimming
        # the tail's FRONT (ffmpeg puts the cause in its last lines), so
        # the raised message and the shared log line keep both the
        # scrubbed exception cause and the stderr's cause. Both parts are
        # already scrubbed, so the cut cannot expose anything unscrubbed.
        over = len(detail) + len(sep) + len(tail) - FFMPEG_REENCODE_DETAIL_CHARS
        if over > 0:
            tail = tail[over:]
        detail = f"{detail}{sep}{tail}"
    logger.error(f"[ffmpeg] re-encode failed for {os.path.basename(src)}: {detail}")
    raise FfmpegReencodeError(
        f"ffmpeg re-encode failed for {os.path.basename(src)}: {detail}"
    ) from exc

"""Photo file primitives: dimensions, content hash, duplicate tracking.

Validation only sees reference strings, so the same image bytes under
two different mediaIds or URLs pass validation. What catches the second
copy is the bytes themselves: content_hash SHA-256-hashes the resolved
photo file, duplicate_skip returns the skip line for a repeat, and
claim records the first label per hash once the panel exists. Warnings
carry labels only, never a URL, path or mediaId.
"""

import contextlib
import hashlib
import os
from typing import Optional

from loguru import logger
from PIL import Image

REASON_DUPLICATE_PHOTO = "duplicate photo"


def probe_size(source_path: str) -> Optional[tuple[int, int]]:
    """Decoded dimensions of an image file, or None when it is not an image."""
    try:
        with Image.open(source_path) as opened:
            return opened.size
    except (OSError, ValueError, Image.DecompressionBombError):
        return None


def content_hash(path: str) -> Optional[str]:
    """SHA-256 of the file bytes, or None when the file cannot be read.

    A file that cannot be read right after a successful resolve is
    treated as unhashable, never as a duplicate.
    """
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError:
        return None
    return digest.hexdigest()


def duplicate_skip(
    seen: dict[str, str], photo: str, index: int, image_index: int, downloaded: str,
    reason: str = REASON_DUPLICATE_PHOTO,
) -> tuple[Optional[str], Optional[str]]:
    """Skip line plus hash to claim, for a photo whose bytes were already placed.

    Returns (skip, None) when a repeat is skipped, (None, hash) on first
    sight, (None, None) when the file cannot be read. The hash is NOT
    recorded here: the caller claims it only once the panel actually
    exists, so a first copy whose panel fails to render does not block
    its repeat. The hook-first photo resolves on a separate path, never
    through here, so it cannot false-positive against segment 0 image 0.
    Hash the photo file itself, before any overlay/panel work — overlays
    differ per item, the photo is what must not repeat.
    """
    photo_hash = content_hash(photo)
    if photo_hash is None:
        return None, None
    label = f"segment {index} image {image_index}"
    first_seen = seen.get(photo_hash)
    if first_seen is not None:
        logger.debug(f"duplicate photo at {label} (first seen at {first_seen})")
        if downloaded:
            with contextlib.suppress(OSError):
                os.remove(downloaded)
        return f"{label} media skipped: {reason}", None
    return None, photo_hash


def claim(seen: dict[str, str], photo_hash: Optional[str], label: str) -> None:
    """Record a placed photo's hash, so its repeat is a duplicate."""
    if photo_hash is not None:
        seen[photo_hash] = label

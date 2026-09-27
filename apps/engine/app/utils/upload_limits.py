"""Chunked upload writer with explicit size caps.

Upload handlers must never call ``file.file.read()`` unbounded: a malicious
client could exhaust server RAM with a single request. This helper streams
the upload in fixed-size chunks, enforces a byte cap, and writes through a
temporary file that is atomically renamed onto the destination — so a
rejected or interrupted upload never leaves a partial file behind.
"""

import os
import tempfile

# Size of each read from the incoming upload stream.
CHUNK_SIZE = 256 * 1024


class UploadTooLargeError(ValueError):
    """Raised when an upload exceeds its configured size cap."""


def save_upload_stream(upload_file, dest_path: str, *, max_bytes: int,
                       chunk_size: int = CHUNK_SIZE) -> int:
    """Stream ``upload_file.file`` to ``dest_path`` without buffering it all.

    The body is copied in ``chunk_size`` reads; as soon as more than
    ``max_bytes`` have arrived, :class:`UploadTooLargeError` is raised and no
    partial file remains. On success the destination is replaced atomically
    (a pre-existing file is overwritten, a failed upload keeps the old one).

    Returns the number of bytes written.
    """
    dest_dir = os.path.dirname(os.path.abspath(dest_path)) or "."
    os.makedirs(dest_dir, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        dir=dest_dir, prefix=".upload-", suffix=".part"
    )
    total = 0
    try:
        try:
            upload_file.file.seek(0)
        except OSError:
            # Non-seekable streams (e.g. a raw socket file) start at the
            # current position; nothing to rewind.
            pass
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = upload_file.file.read(chunk_size)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise UploadTooLargeError(
                        f"upload exceeds the size limit of "
                        f"{max_bytes // 1024 // 1024} MB"
                    )
                out.write(chunk)
        os.replace(tmp_path, dest_path)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    return total

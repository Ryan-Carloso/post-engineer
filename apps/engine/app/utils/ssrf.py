"""SSRF-safe download helpers.

Every network fetch of a user-controlled URL must go through these helpers.
They enforce an http(s) scheme allowlist, require the host to resolve to
global (public) IP addresses on *every* redirect hop, stream the body with an
explicit byte cap, and optionally require an expected Content-Type.

DNS is validated before each request and again after every redirect, so a
redirect chain can never smuggle the fetch onto a private/internal address
(cloud metadata endpoints, intranet hosts, localhost).
"""

import ipaddress
import os
import socket
import tempfile
from typing import Optional
from urllib.parse import urljoin, urlparse

import requests

# Redirect statuses that carry a Location header worth following manually.
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}

# Maximum number of redirects followed for a single download.
MAX_REDIRECTS = 5

# Default ceiling for a streamed download (20 MiB).
DEFAULT_MAX_BYTES = 20 * 1024 * 1024

_CHUNK_SIZE = 256 * 1024


class UnsafeUrlError(ValueError):
    """Raised when a URL fails the public-address / download safety checks."""


def _resolve_global_ips(hostname: str) -> list:
    """Return the host's IPs, raising UnsafeUrlError when unresolvable."""
    try:
        return [ipaddress.ip_address(hostname)]
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise UnsafeUrlError(
            f"URL host could not be resolved: {hostname}."
        ) from exc
    ips = []
    for info in infos:
        try:
            ips.append(ipaddress.ip_address(info[4][0]))
        except ValueError:
            continue
    if not ips:
        raise UnsafeUrlError(
            f"URL host could not be resolved: {hostname}."
        )
    return ips


def assert_public_url(url: str, *, what: str = "URL") -> None:
    """Ensure *url* points at a public address (anti-SSRF).

    Blocks non-http(s) schemes, missing hostnames, literal private IPs,
    hostnames resolving to private IPs, and hosts that do not resolve at all
    (fail closed). Raises :class:`UnsafeUrlError`.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise UnsafeUrlError(f"{what} must be a valid http(s) URL.")
    ips = _resolve_global_ips(parsed.hostname)
    if not all(ip.is_global for ip in ips):
        raise UnsafeUrlError(
            f"{what} must use a public address — private/internal URLs "
            "are not allowed (e.g. 127.0.0.1, 10.x.x.x, 169.254.169.254)."
        )


def download_public_file(
    url: str,
    dest_path: str,
    *,
    what: str = "file",
    max_bytes: int = DEFAULT_MAX_BYTES,
    allowed_content_types: Optional[tuple] = None,
    timeout: int = 60,
    tls_verify: bool = True,
    session=None,
    headers: Optional[dict] = None,
    proxies: Optional[dict] = None,
) -> str:
    """Download *url* to *dest_path* with per-hop SSRF validation.

    Redirects are followed manually (``allow_redirects=False``) so every hop
    is re-validated with :func:`assert_public_url`. The body is streamed with
    an explicit byte cap; oversized downloads are rejected and no partial
    file is left behind. When *allowed_content_types* is given, the response
    Content-Type must start with one of the prefixes (e.g. ``"image/"``).

    Returns *dest_path*. Raises :class:`UnsafeUrlError` on any rejection and
    :class:`OSError` on local I/O failures.
    """
    assert_public_url(url, what=what)
    http = session if session is not None else requests

    current_url = url
    response = None
    try:
        for _ in range(MAX_REDIRECTS + 1):
            response = http.get(
                current_url,
                stream=True,
                timeout=timeout,
                verify=tls_verify,
                allow_redirects=False,
                headers=headers,
                proxies=proxies,
            )
            location = response.headers.get("Location") or response.headers.get(
                "location"
            )
            if response.status_code in _REDIRECT_STATUSES and location:
                response.close()
                response = None
                current_url = urljoin(current_url, location)
                assert_public_url(current_url, what=what)
                continue
            break
        else:  # pragma: no cover - loop always breaks or raises
            raise UnsafeUrlError(f"{what} redirected too many times.")

        if response is None:  # pragma: no cover - defensive
            raise UnsafeUrlError(f"{what} could not be downloaded.")
        if response.status_code >= 300:
            raise UnsafeUrlError(
                f"{what} download failed: HTTP {response.status_code}."
            )

        content_length = response.headers.get("Content-Length") or response.headers.get(
            "content-length"
        )
        if content_length:
            try:
                content_length_value = int(content_length)
            except (TypeError, ValueError):
                content_length_value = None
            # NB: the int() conversion is isolated above because UnsafeUrlError
            # subclasses ValueError — raising inside the try would be swallowed.
            if (
                content_length_value is not None
                and content_length_value > max_bytes
            ):
                raise UnsafeUrlError(
                    f"{what} exceeds the download limit of "
                    f"{max_bytes // 1024 // 1024} MB."
                )

        if allowed_content_types:
            content_type = (
                (response.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            )
            if not any(
                content_type.startswith(prefix) for prefix in allowed_content_types
            ):
                raise UnsafeUrlError(
                    f"{what} has an unexpected content-type "
                    f"({content_type or 'unknown'})."
                )

        downloaded = 0
        too_large = False
        # Write to a temp file in the destination directory and atomically
        # rename only after a complete valid stream. A mid-stream failure
        # (network error, overage) must never corrupt or delete an existing
        # destination file.
        dest_dir = os.path.dirname(os.path.abspath(dest_path)) or "."
        fd, temp_path = tempfile.mkstemp(
            dir=dest_dir, prefix=".download-", suffix=".part"
        )
        try:
            with os.fdopen(fd, "wb") as dest_file:
                for chunk in response.iter_content(chunk_size=_CHUNK_SIZE):
                    if not chunk:
                        continue
                    downloaded += len(chunk)
                    if downloaded > max_bytes:
                        too_large = True
                        break
                    dest_file.write(chunk)
        except BaseException:
            try:
                os.unlink(temp_path)
            except OSError:
                pass
            raise
    finally:
        if response is not None:
            response.close()

    if too_large:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise UnsafeUrlError(
            f"{what} exceeds the download limit of {max_bytes // 1024 // 1024} MB."
        )
    try:
        os.replace(temp_path, dest_path)
    except BaseException:
        # The atomic rename itself failed: the destination is untouched
        # (os.replace never partially renames), but the temp file must go.
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise
    return dest_path

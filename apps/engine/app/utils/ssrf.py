"""SSRF-safe download and webhook helpers.

Every network fetch of a user-controlled URL must go through these helpers.
They enforce an http(s) scheme allowlist, require the host to resolve to
public IP addresses, and open the TCP connection only to those addresses.
The URL host is left in place for the Host header and for TLS SNI.

Downloads follow redirects manually. Every hop resolves again and pins
again. http stays allowed: the product accepts http image URLs. A webhook
is https only, and delivery does not follow redirects (a 3xx response is
a failed delivery).
"""

import ipaddress
import os
import socket
import tempfile
from typing import Optional
from urllib.parse import urljoin, urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.exceptions import NewConnectionError
from urllib3.util.url import parse_url

# Redirect statuses that carry a Location header worth following manually.
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}

# Maximum number of redirects followed for a single download.
MAX_REDIRECTS = 5

# Default ceiling for a streamed download (20 MiB).
DEFAULT_MAX_BYTES = 20 * 1024 * 1024

_CHUNK_SIZE = 256 * 1024

# CPython ipaddress.is_global still reports these as globally reachable.
# They are not safe connect targets (issue #467). 192.0.0.9 and 192.0.0.10
# are global anycast and stay allowed — they are not in these networks.
_EXTRA_V4 = (ipaddress.ip_network("192.88.99.0/24"),)  # deprecated 6to4 anycast
_EXTRA_V6 = (
    ipaddress.ip_network("100:0:0:1::/64"),
    ipaddress.ip_network("5f00::/16"),
)
# Well-known NAT64. The last 32 bits are an embedded IPv4 address.
_NAT64 = ipaddress.ip_network("64:ff9b::/96")


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


def is_public_ip(ip) -> bool:
    """True when *ip* is safe to open a connection to.

    Starts from :meth:`ipaddress.IPv4Address.is_global` /
    :meth:`ipaddress.IPv6Address.is_global`, then rejects the ranges that
    property still allows. A NAT64 address (``64:ff9b::/96``) is public
    only when the embedded IPv4 address is public, so ``64:ff9b::8.8.8.8``
    stays allowed and an embedded loopback or RFC1918 address does not.
    """
    if not ip.is_global:
        return False
    if isinstance(ip, ipaddress.IPv4Address):
        return all(ip not in network for network in _EXTRA_V4)
    if any(ip in network for network in _EXTRA_V6):
        return False
    if ip in _NAT64:
        embedded = ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
        return is_public_ip(embedded)
    return True


def _public_ips(url: str, *, what: str, https_only: bool = False, resolve_host: bool = True) -> list:
    """Validate *url* and return the addresses a later dial may use.

    The host checked is the one the HTTP client would dial from the URL:
    requests connects where urllib3's parser says, and urllib3 ends the
    authority at a backslash while ``urlparse`` takes the host after the
    last ``@``. A URL the two parsers read differently is rejected.

    ``resolve_host=False`` skips DNS: a host *name* is accepted unchecked
    (resolution and pinning happen on the delivery path); ``localhost`` and
    a literal non-public address are still rejected. The returned list is
    empty then — never dial it, there is nothing validated to dial.
    """
    try:
        parsed = urlparse(url)
        parsed_port = parsed.port
    except ValueError as exc:
        raise UnsafeUrlError(f"{what} must be a valid http(s) URL.") from exc
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise UnsafeUrlError(f"{what} must be a valid http(s) URL.")
    # Webhooks are https only. Downloads keep the http allowlist above.
    if https_only and parsed.scheme != "https":
        raise UnsafeUrlError(f"{what} must be a valid https URL.")
    if any(char == "\\" or ord(char) <= 0x20 or ord(char) == 0x7F for char in url):
        raise UnsafeUrlError(f"{what} must be a canonical http(s) URL.")
    try:
        wire = parse_url(url)
    except ValueError as exc:
        raise UnsafeUrlError(f"{what} must be a valid http(s) URL.") from exc
    wire_host = (wire.host or "").strip("[]")
    if (
        wire.scheme != parsed.scheme
        or wire_host != parsed.hostname
        or wire.port != parsed_port
    ):
        raise UnsafeUrlError(f"{what} must be a canonical http(s) URL.")
    if not resolve_host:
        if wire_host == "localhost":
            raise UnsafeUrlError(
                f"{what} must use a public address — private/internal URLs "
                "are not allowed (e.g. 127.0.0.1, 10.x.x.x, 169.254.169.254)."
            )
        try:
            literal = ipaddress.ip_address(wire_host)
        except ValueError:
            return []
        if not is_public_ip(literal):
            raise UnsafeUrlError(
                f"{what} must use a public address — private/internal URLs "
                "are not allowed (e.g. 127.0.0.1, 10.x.x.x, 169.254.169.254)."
            )
        return []
    ips = _resolve_global_ips(wire_host)
    if not ips or not all(is_public_ip(ip) for ip in ips):
        raise UnsafeUrlError(
            f"{what} must use a public address — private/internal URLs "
            "are not allowed (e.g. 127.0.0.1, 10.x.x.x, 169.254.169.254)."
        )
    return ips


def assert_public_url(url: str, *, what: str = "URL", https_only: bool = False, resolve_host: bool = True) -> None:
    """Ensure *url* points at a public address (anti-SSRF).

    Blocks non-http(s) schemes, missing hostnames, literal private IPs,
    hostnames resolving to private IPs, and hosts that do not resolve at all
    (fail closed). ``https_only`` also rejects cleartext http (webhooks).
    Raises :class:`UnsafeUrlError`.

    ``resolve_host=False`` validates the URL shape only — https, a hostname
    present, not ``localhost``, and a literal address public — without
    resolving names. Request-time checks (the task schema) use it so a DNS
    blip cannot reject a valid request; the delivery path still resolves
    and pins before it dials.

    The host checked is the one the HTTP client dials: requests connects
    where urllib3's parser says, and urllib3 ends the authority at a
    backslash while ``urlparse`` takes the host after the last ``@``. A URL
    the two parsers read differently (backslash, whitespace or control
    characters, or any scheme/host/port mismatch) is rejected outright.
    """
    _public_ips(url, what=what, https_only=https_only, resolve_host=resolve_host)


def _header(headers, name: str):
    """Header lookup that accepts a real response or a plain-dict fake.

    ``requests`` folds header names. A test double often stores the
    lowercase name, so both casings are read.
    """
    if not headers:
        return None
    value = headers.get(name)
    if value:
        return value
    return headers.get(name.lower())


def _dial(ip: str, port: int, timeout):
    """TCP connect to an address that was just validated. No DNS lookup."""
    if not isinstance(timeout, (int, float)):
        timeout = None
    sock = socket.create_connection((ip, port), timeout)
    try:
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    except OSError:
        pass
    return sock


def _pinned_connection_class(base, pinned_ip: str):
    """Connection class that dials *pinned_ip* and keeps the URL host.

    ``host`` stays the name from the URL, so the Host header and TLS SNI
    name that host. ``_new_conn`` is the only place the socket is opened,
    and it never calls ``getaddrinfo`` on the URL host.
    """

    class PinnedConnection(base):
        def _new_conn(self):
            try:
                return _dial(pinned_ip, self.port, self.timeout)
            except OSError as exc:
                raise NewConnectionError(
                    self, f"Failed to establish a new connection: {exc}"
                ) from exc

    return PinnedConnection


class _PinnedAdapter(HTTPAdapter):
    """Route every connection from this session to one validated address."""

    def __init__(self, pinned_ip: str):
        self._pinned_ip = pinned_ip
        super().__init__()

    def get_connection_with_tls_context(self, request, verify, proxies=None, cert=None):
        pool = super().get_connection_with_tls_context(
            request, verify, proxies, cert
        )
        # A proxy is the TCP peer, not the URL host. download_public_file
        # does not take a proxies argument, and the session ignores env
        # proxies (trust_env = False). Refuse here too, or the dial would
        # go to the proxy and the pin would never run.
        if proxies:
            raise UnsafeUrlError("A proxied fetch is not supported.")
        pool.ConnectionCls = _pinned_connection_class(pool.ConnectionCls, self._pinned_ip)
        return pool


def _send_pinned(method: str, url: str, ip: str, **kwargs):
    """One request. Redirects are never followed by the HTTP client.

    The caller re-checks and re-pins each redirect hop itself. Closing the
    session before a streamed body is read would drop the socket, so a
    streamed response closes the session when the body is closed.
    """
    session = requests.Session()
    # Env proxies would be the TCP peer, not the validated address.
    session.trust_env = False
    adapter = _PinnedAdapter(ip)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    try:
        # codeql[py/full-ssrf]: guarded — dials only the IP just validated
        response = session.request(method, url, allow_redirects=False, **kwargs)
    except Exception:
        session.close()
        raise
    if kwargs.get("stream"):
        original_close = response.close

        def _close():
            try:
                original_close()
            finally:
                session.close()

        response.close = _close
        return response
    session.close()
    return response


def _open(method: str, url: str, ips: list, *, session=None, **kwargs):
    """Send *method* to *url*, dialing only *ips* unless *session* is injected.

    An injected session is the test double used by the image fetcher. It
    does not open a socket. Production callers leave *session* unset and
    hit :func:`_send_pinned`.
    """
    if session is not None:
        return getattr(session, method.lower())(url, allow_redirects=False, **kwargs)
    last_error = None
    for ip in ips:
        try:
            return _send_pinned(method, url, str(ip), **kwargs)
        except requests.ConnectionError as exc:
            last_error = exc
    if last_error is None:
        raise UnsafeUrlError("URL host had no address to connect to.")
    raise last_error


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
) -> str:
    """Download *url* to *dest_path* with per-hop SSRF validation.

    Redirects are followed manually (``allow_redirects=False``) so every hop
    is re-resolved and the connection is pinned to that hop's addresses.
    The body is streamed with an explicit byte cap; oversized downloads are
    rejected and no partial file is left behind. When *allowed_content_types*
    is given, the response Content-Type must start with one of the prefixes
    (e.g. ``"image/"``).

    Returns *dest_path*. Raises :class:`UnsafeUrlError` on any rejection and
    :class:`OSError` on local I/O failures.
    """
    current_url = url
    response = None
    try:
        for _ in range(MAX_REDIRECTS + 1):
            ips = _public_ips(current_url, what=what)
            response = _open(
                "get",
                current_url,
                ips,
                session=session,
                stream=True,
                timeout=timeout,
                verify=tls_verify,
                headers=headers,
            )
            location = _header(response.headers, "Location")
            if response.status_code in _REDIRECT_STATUSES and location:
                response.close()
                response = None
                current_url = urljoin(current_url, location)
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

        content_length = _header(response.headers, "Content-Length")
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
                (_header(response.headers, "Content-Type") or "").split(";")[0].strip().lower()
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


def post_public_url(url: str, *, json: dict, timeout, session=None):
    """POST *json* to a public https *url*, pinned to the addresses just validated.

    Cleartext http is rejected before any dial. Redirects are not followed.
    The caller treats a 3xx status as delivery failure. Raises
    :class:`UnsafeUrlError` before any dial when *url* is not public https.
    """
    ips = _public_ips(url, what="webhook_url", https_only=True)
    return _open(
        "post",
        url,
        ips,
        session=session,
        json=json,
        timeout=timeout,
        stream=False,
    )

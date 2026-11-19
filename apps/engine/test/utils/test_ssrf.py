"""assert_public_url validates the host the HTTP client actually dials.

requests hands the URL to urllib3, whose parser ends the authority at a
backslash, while urllib.parse keeps the whole netloc and takes the host
after the last "@". A URL on which the two parsers disagree must be
rejected before any request is made (issue #442).

Downloads and webhook posts open a TCP connection only to the addresses
just validated. A later DNS answer is not used (issues #443 and #467).
"""

import ipaddress
import json
import socket
import threading
from pathlib import Path
from unittest.mock import patch

import pytest
import requests
from urllib3.exceptions import (
    LocationParseError,
    MaxRetryError,
    NewConnectionError,
    ProtocolError,
)
from urllib3.util.url import Url

from app.utils import ssrf

PUBLIC_IP = [ipaddress.ip_address("93.184.215.14")]

PARSER_DIFFERENTIAL_URLS = [
    "http://127.0.0.1:8081\\@1.1.1.1/secret",
    "http://169.254.169.254\\@1.1.1.1:9000/latest/meta-data/",
    "http://1.1.1.1\\@127.0.0.1:8081/secret",
    "https://10.0.0.5\\@example.com/a.jpg",
    "http://example.com\t.evil/x",
    "http://example.com\n.evil/x",
    "http://exa mple.com/x",
    "http://example.com\x00.evil/x",
]


class _Response:
    def __init__(self, status_code=200, headers=None, body=b"img"):
        self.status_code = status_code
        self.headers = headers or {"Content-Type": "image/png"}
        self._body = body

    def iter_content(self, chunk_size):
        yield self._body

    def close(self):
        pass


class _Session:
    """requests-like session that replays canned responses and records URLs."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.urls = []

    def get(self, url, **_kwargs):
        self.urls.append(url)
        return self._responses.pop(0)


@pytest.mark.parametrize("url", PARSER_DIFFERENTIAL_URLS)
def test_a_url_the_parsers_disagree_on_is_rejected(url):
    with patch.object(ssrf, "_resolve_global_ips", return_value=PUBLIC_IP):
        with pytest.raises(ssrf.UnsafeUrlError, match="canonical"):
            ssrf.assert_public_url(url, what="Photo")


@pytest.mark.parametrize("url", PARSER_DIFFERENTIAL_URLS)
def test_download_rejects_a_parser_differential_before_fetching(url, tmp_path):
    session = _Session([_Response()])
    dest = tmp_path / "out.png"
    with patch.object(ssrf, "_resolve_global_ips", return_value=PUBLIC_IP):
        with pytest.raises(ssrf.UnsafeUrlError):
            ssrf.download_public_file(
                url, str(dest), allowed_content_types=("image/",), session=session
            )
    assert session.urls == []
    assert not dest.exists()


def test_a_redirect_to_a_parser_differential_is_not_followed(tmp_path):
    first = "https://example.com/a.png"
    session = _Session(
        [
            _Response(
                status_code=302,
                headers={"Location": "http://127.0.0.1:8081\\@1.1.1.1/secret"},
            ),
            _Response(),
        ]
    )
    dest = tmp_path / "out.png"
    with patch.object(ssrf, "_resolve_global_ips", return_value=PUBLIC_IP):
        with pytest.raises(ssrf.UnsafeUrlError, match="canonical"):
            ssrf.download_public_file(first, str(dest), session=session)
    assert session.urls == [first]
    assert not dest.exists()


def test_the_resolved_host_is_the_one_the_client_dials():
    seen = []

    def _resolve(host):
        seen.append(host)
        return PUBLIC_IP

    with patch.object(ssrf, "_resolve_global_ips", side_effect=_resolve):
        ssrf.assert_public_url("https://user:pw@CDN.Example.com:8443/a.png")
    assert seen == ["cdn.example.com"]


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/a.png?size=large#top",
        "http://user:pw@example.com:8443/a",
        "HTTPS://Example.COM/a.png",
        "https://example.com/a%5Cb.png",
        "https://example.com:443/a.png",
        "https://example.com/caf%C3%A9.png",
    ],
)
def test_canonical_public_urls_still_pass(url):
    with patch.object(ssrf, "_resolve_global_ips", return_value=PUBLIC_IP):
        ssrf.assert_public_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "https://1.1.1.1/a.png",
        "https://[2606:4700:4700::1111]/a.png",
        "https://[2606:4700:4700::1111]:8443/a.png",
    ],
)
def test_public_ip_literals_pass_without_dns(url):
    ssrf.assert_public_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:8081/secret",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]:8081/secret",
        "http://10.0.0.5/a.png",
    ],
)
def test_private_literals_are_still_rejected(url):
    with pytest.raises(ssrf.UnsafeUrlError, match="public address"):
        ssrf.assert_public_url(url)


@pytest.mark.parametrize(
    "url",
    ["ftp://example.com/a", "file:///etc/passwd", "http:///nohost", "not a url"],
)
def test_non_http_or_hostless_urls_are_rejected(url):
    with pytest.raises(ssrf.UnsafeUrlError, match="valid http"):
        ssrf.assert_public_url(url)


def test_an_unparseable_port_is_rejected_not_raised_as_another_error():
    with pytest.raises(ssrf.UnsafeUrlError, match="valid http"):
        ssrf.assert_public_url("http://example.com:99999/a")


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/a\\b.png",
        "https://example.com/a\tb.png",
        "https://example.com/a\x7fb.png",
        "https://example.com/a b.png",
    ],
)
def test_a_raw_backslash_or_control_char_is_rejected_even_when_hosts_agree(url):
    with patch.object(ssrf, "_resolve_global_ips", return_value=PUBLIC_IP):
        with pytest.raises(ssrf.UnsafeUrlError, match="canonical"):
            ssrf.assert_public_url(url)


@pytest.mark.parametrize(
    "wire",
    [
        Url(scheme="https", host="10.0.0.5", path="/a.png"),
        Url(scheme="https", host="example.com", port=8081, path="/a.png"),
        Url(scheme="http", host="example.com", path="/a.png"),
    ],
    ids=["host", "port", "scheme"],
)
def test_any_other_parser_disagreement_is_rejected(wire):
    with patch.object(ssrf, "parse_url", return_value=wire), patch.object(
        ssrf, "_resolve_global_ips", return_value=PUBLIC_IP
    ):
        with pytest.raises(ssrf.UnsafeUrlError, match="canonical"):
            ssrf.assert_public_url("https://example.com/a.png")


def test_a_url_the_client_parser_cannot_read_is_rejected():
    with patch.object(
        ssrf, "parse_url", side_effect=LocationParseError("https://example.com/a.png")
    ):
        with pytest.raises(ssrf.UnsafeUrlError, match="valid http"):
            ssrf.assert_public_url("https://example.com/a.png")


CHECKED_IP = "93.184.215.14"
SECOND_IP = "8.8.8.8"

EXTRA_BLOCKED = [
    "192.88.99.0",
    "192.88.99.255",
    "64:ff9b::7f00:1",
    "64:ff9b::a00:1",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b::c058:6301",
    "64:ff9b::",
    "64:ff9b::ffff:ffff",
    "100:0:0:1::",
    "100:0:0:1:ffff:ffff:ffff:ffff",
    "5f00::",
    "5f00:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
]

EXTRA_ALLOWED = [
    "192.88.98.255",
    "192.88.100.0",
    "192.0.0.9",
    "192.0.0.10",
    "64:ff9b::8.8.8.8",
    "100:0:0:2::",
    "5f01::",
    "5eff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
]


def _read_http_request(sock):
    """Read one HTTP/1.1 request, including a Content-Length body."""
    sock.settimeout(2)
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = sock.recv(4096)
        if not chunk:
            return data
        data += chunk
        if len(data) > 65536:
            break
    head, sep, rest = data.partition(b"\r\n\r\n")
    if not sep:
        return data
    length = 0
    for line in head.split(b"\r\n")[1:]:
        if line.lower().startswith(b"content-length:"):
            length = int(line.split(b":", 1)[1].strip() or b"0")
    while len(rest) < length:
        chunk = sock.recv(4096)
        if not chunk:
            break
        rest += chunk
    return head + sep + rest[:length]


def _http_response(status, reason, headers, body):
    payload = {"Content-Length": str(len(body)), "Connection": "close"}
    payload.update(headers)
    lines = [f"HTTP/1.1 {status} {reason}"]
    lines.extend(f"{key}: {value}" for key, value in payload.items())
    return ("\r\n".join(lines) + "\r\n\r\n").encode() + body


def _scripted_socket(respond, seen):
    """Peer that records every request and answers with respond(request)."""
    client, server = socket.socketpair()

    def run():
        try:
            server.settimeout(2)
            while True:
                request = _read_http_request(server)
                if not request:
                    break
                seen.append(request)
                server.sendall(respond(request))
        except OSError:
            pass
        finally:
            server.close()

    threading.Thread(target=run, daemon=True).start()
    return client


def _connecting_to(dials, seen, body_for):
    """Stand in for socket.create_connection. body_for(ip) is the response."""

    def create_connection(address, timeout=None, *args, **kwargs):
        ip, port = address
        dials.append((ip, port, timeout))
        response = body_for(ip)
        return _scripted_socket(lambda _request: response, seen)

    return create_connection


def _patch_connect(dials, seen, body_for, resolve):
    return (
        patch.object(ssrf, "_resolve_global_ips", side_effect=resolve),
        patch.object(ssrf.socket, "getaddrinfo", side_effect=AssertionError("dns")),
        patch.object(
            ssrf.socket,
            "create_connection",
            side_effect=_connecting_to(dials, seen, body_for),
        ),
    )


def test_dial_uses_the_address_it_was_given_and_no_dns():
    seen = []

    def create_connection(address, timeout=None, *args, **kwargs):
        seen.append((address, timeout))
        client, server = socket.socketpair()
        server.close()
        return client

    with patch.object(
        ssrf.socket, "getaddrinfo", side_effect=AssertionError("dns")
    ), patch.object(ssrf.socket, "create_connection", side_effect=create_connection):
        sock = ssrf._dial(CHECKED_IP, 80, 10)
    sock.close()
    assert seen == [((CHECKED_IP, 80), 10)]


def test_download_dials_the_checked_address_when_dns_rebinds(tmp_path):
    """The second lookup is loopback. The file is the first address's body."""
    lookups = []

    def resolve(_host):
        lookups.append(_host)
        if len(lookups) == 1:
            return [ipaddress.ip_address(CHECKED_IP)]
        return [ipaddress.ip_address("127.0.0.1")]

    dials = []
    seen = []

    def body_for(ip):
        body = b"PUBLIC" if ip == CHECKED_IP else b"REBIND!"
        return _http_response(200, "OK", {"Content-Type": "image/png"}, body)

    dest = tmp_path / "out.png"
    patches = _patch_connect(dials, seen, body_for, resolve)
    with patches[0], patches[1], patches[2]:
        ssrf.download_public_file(
            "http://rebind.test/a.png",
            str(dest),
            allowed_content_types=("image/",),
            timeout=10,
        )
    assert dials == [(CHECKED_IP, 80, 10)]
    assert dest.read_bytes() == b"PUBLIC"
    assert seen and b"Host: rebind.test" in seen[0]
    assert b"REBIND!" not in dest.read_bytes()


def test_a_redirect_hop_to_loopback_is_not_dialed(tmp_path):
    def resolve(host):
        if host == "127.0.0.1":
            return [ipaddress.ip_address("127.0.0.1")]
        return [ipaddress.ip_address(CHECKED_IP)]

    dials = []
    seen = []

    def body_for(_ip):
        return _http_response(
            302,
            "Found",
            {"Location": "http://127.0.0.1/secret"},
            b"",
        )

    dest = tmp_path / "out.png"
    patches = _patch_connect(dials, seen, body_for, resolve)
    with patches[0], patches[1], patches[2]:
        with pytest.raises(ssrf.UnsafeUrlError, match="public address"):
            ssrf.download_public_file("http://cdn.example/a.png", str(dest))
    assert [item[0] for item in dials] == [CHECKED_IP]
    assert not dest.exists()
    assert seen and b"/secret" not in seen[0]


def test_a_public_redirect_is_followed_and_pinned_again(tmp_path):
    def resolve(host):
        return {
            "one.example": [ipaddress.ip_address(CHECKED_IP)],
            "two.example": [ipaddress.ip_address(SECOND_IP)],
        }[host]

    dials = []
    seen = []

    def body_for(ip):
        if ip == CHECKED_IP:
            return _http_response(
                302,
                "Found",
                {"Location": "http://two.example/b.png"},
                b"",
            )
        return _http_response(200, "OK", {"Content-Type": "image/png"}, b"SECOND")

    dest = tmp_path / "out.png"
    patches = _patch_connect(dials, seen, body_for, resolve)
    with patches[0], patches[1], patches[2]:
        ssrf.download_public_file(
            "http://one.example/a.png",
            str(dest),
            allowed_content_types=("image/",),
        )
    assert [item[0] for item in dials] == [CHECKED_IP, SECOND_IP]
    assert dest.read_bytes() == b"SECOND"
    assert b"Host: two.example" in seen[1]


def test_a_refused_address_falls_through_to_the_next_public_one(tmp_path):
    def resolve(_host):
        return [ipaddress.ip_address("1.1.1.1"), ipaddress.ip_address(SECOND_IP)]

    dials = []
    seen = []

    def create_connection(address, timeout=None, *args, **kwargs):
        ip, port = address
        dials.append(ip)
        if ip == "1.1.1.1":
            raise OSError("refused")
        response = _http_response(200, "OK", {"Content-Type": "image/png"}, b"OK")
        return _scripted_socket(lambda _request: response, seen)

    dest = tmp_path / "out.png"
    with patch.object(ssrf, "_resolve_global_ips", side_effect=resolve), patch.object(
        ssrf.socket, "create_connection", side_effect=create_connection
    ):
        ssrf.download_public_file(
            "http://cdn.example/a.png",
            str(dest),
            allowed_content_types=("image/",),
        )
    assert dials == ["1.1.1.1", SECOND_IP]
    assert dest.read_bytes() == b"OK"


def test_one_private_address_rejects_the_whole_set(tmp_path):
    def resolve(_host):
        return [
            ipaddress.ip_address(CHECKED_IP),
            ipaddress.ip_address("10.0.0.5"),
        ]

    dials = []

    def create_connection(address, timeout=None, *args, **kwargs):
        dials.append(address[0])
        raise AssertionError("dialed")

    dest = tmp_path / "out.png"
    with patch.object(ssrf, "_resolve_global_ips", side_effect=resolve), patch.object(
        ssrf.socket, "create_connection", side_effect=create_connection
    ):
        with pytest.raises(ssrf.UnsafeUrlError, match="public address"):
            ssrf.download_public_file("http://cdn.example/a.png", str(dest))
    assert dials == []
    assert not dest.exists()


@pytest.mark.parametrize("ip", EXTRA_BLOCKED)
def test_extra_ranges_are_not_public(ip):
    assert ssrf.is_public_ip(ipaddress.ip_address(ip)) is False


@pytest.mark.parametrize("ip", EXTRA_ALLOWED)
def test_addresses_just_outside_the_extra_ranges_stay_public(ip):
    assert ssrf.is_public_ip(ipaddress.ip_address(ip)) is True


@pytest.mark.parametrize(
    "url",
    [
        "http://192.88.99.0/x",
        "http://192.88.99.255/x",
        "http://[64:ff9b::7f00:1]/x",
        "http://[64:ff9b::a9fe:a9fe]/x",
        "http://[100:0:0:1::]/x",
        "http://[5f00::]/x",
    ],
)
def test_assert_public_url_rejects_the_extra_ranges(url):
    with pytest.raises(ssrf.UnsafeUrlError, match="public address"):
        ssrf.assert_public_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://192.88.100.0/x",
        "http://192.88.98.255/x",
        "http://192.0.0.9/x",
        "http://192.0.0.10/x",
        "http://[64:ff9b::8.8.8.8]/x",
        "http://[100:0:0:2::]/x",
        "http://[5f01::]/x",
    ],
)
def test_assert_public_url_allows_the_boundary_neighbors(url):
    ssrf.assert_public_url(url)


def _repo_root():
    for parent in Path(__file__).resolve().parents:
        if (parent / "pnpm-workspace.yaml").is_file():
            return parent
    raise AssertionError("repo root not found from the test file location")


def test_engine_public_ip_matches_the_shared_cases():
    raw = json.loads((_repo_root() / "shared/ssrf/public-ip-cases.json").read_text())
    def unbracket(given):
        return given[1:-1] if given.startswith("[") and given.endswith("]") else given

    for ip in raw["blocked"]:
        assert ssrf.is_public_ip(ipaddress.ip_address(unbracket(ip))) is False, ip
    for ip in raw["allowed"]:
        assert ssrf.is_public_ip(ipaddress.ip_address(unbracket(ip))) is True, ip
    for ip in raw["blockedBeyondPython"]:
        assert ssrf.is_public_ip(ipaddress.ip_address(unbracket(ip))) is True, ip


def _dns_down():
    raise OSError("dns down")


def test_shape_only_validation_accepts_a_hostname_without_dns():
    with patch.object(ssrf.socket, "getaddrinfo", side_effect=_dns_down):
        ssrf.assert_public_url("https://example.com/hook", what="webhook_url", https_only=True, resolve_host=False)


@pytest.mark.parametrize(
    "url",
    [
        "https://localhost/hook",
        "https://127.0.0.1/hook",
        "https://10.0.0.5/hook",
        "https://[::1]/hook",
        "https://[::ffff:7f00:1]/hook",
    ],
)
def test_shape_only_validation_rejects_localhost_and_private_literals(url):
    with patch.object(ssrf.socket, "getaddrinfo", side_effect=_dns_down):
        with pytest.raises(ssrf.UnsafeUrlError, match="public address"):
            ssrf.assert_public_url(url, what="webhook_url", https_only=True, resolve_host=False)


@pytest.mark.parametrize(
    "url",
    [
        "https://8.8.8.8/hook",
        "https://[2606:4700:4700::1111]/hook",
    ],
)
def test_shape_only_validation_accepts_a_public_literal(url):
    with patch.object(ssrf.socket, "getaddrinfo", side_effect=_dns_down):
        ssrf.assert_public_url(url, what="webhook_url", https_only=True, resolve_host=False)


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com/hook",
        "ftp://example.com/hook",
        "not a url",
        "https://",
    ],
)
def test_shape_only_validation_still_rejects_http_and_malformed(url):
    with patch.object(ssrf.socket, "getaddrinfo", side_effect=_dns_down):
        with pytest.raises(ssrf.UnsafeUrlError):
            ssrf.assert_public_url(url, what="webhook_url", https_only=True, resolve_host=False)


def test_engine_webhook_url_matches_the_shared_cases():
    raw = json.loads((_repo_root() / "shared/ssrf/webhook-url-cases.json").read_text())
    with patch.object(ssrf.socket, "getaddrinfo", side_effect=_dns_down):
        for url in raw["accepted"]:
            ssrf.assert_public_url(url, what="webhook_url", https_only=True, resolve_host=False)
        for url in raw["rejected"]:
            with pytest.raises(ssrf.UnsafeUrlError):
                ssrf.assert_public_url(url, what="webhook_url", https_only=True, resolve_host=False)


def test_post_public_url_rejects_cleartext_http_before_a_dial():
    def create_connection(*_args, **_kwargs):
        raise AssertionError("an http webhook must not dial")

    with patch.object(
        ssrf, "_resolve_global_ips", return_value=[ipaddress.ip_address(CHECKED_IP)]
    ), patch.object(ssrf.socket, "create_connection", side_effect=create_connection):
        with pytest.raises(ssrf.UnsafeUrlError, match="https"):
            ssrf.post_public_url(
                "http://rebind.test/hook", json={"ok": True}, timeout=10
            )


def test_https_sni_is_the_url_host_while_the_dial_is_the_checked_ip():
    dials = []
    seen = {}

    def resolve(_host):
        return [ipaddress.ip_address(CHECKED_IP)]

    def create_connection(address, timeout=None, *args, **kwargs):
        dials.append((address, timeout))
        client, server = socket.socketpair()
        server.close()
        return client

    def wrap(*args, **kwargs):
        seen["server_hostname"] = kwargs.get("server_hostname")
        raise requests.exceptions.SSLError("stop after sni")

    with patch.object(ssrf, "_resolve_global_ips", side_effect=resolve), patch.object(
        ssrf.socket, "create_connection", side_effect=create_connection
    ), patch(
        "urllib3.connection._ssl_wrap_socket_and_match_hostname", side_effect=wrap
    ):
        with pytest.raises(requests.exceptions.ConnectionError):
            ssrf.post_public_url(
                "https://rebind.test/hook", json={"ok": True}, timeout=10
            )
    assert dials == [((CHECKED_IP, 443), 10)]
    assert seen["server_hostname"] == "rebind.test"


def test_a_response_with_no_headers_still_saves_the_body(tmp_path):
    class Bare:
        status_code = 200
        headers = None

        def iter_content(self, chunk_size):
            yield b"PNG"

        def close(self):
            return None

    class Session:
        def get(self, url, **kwargs):
            return Bare()

    dest = tmp_path / "out.bin"
    ssrf.download_public_file(
        "http://93.184.215.14/a.bin", str(dest), session=Session()
    )
    assert dest.read_bytes() == b"PNG"


def test_dial_treats_a_non_numeric_timeout_as_blocking():
    seen = []

    def create_connection(address, timeout=None, *args, **kwargs):
        seen.append((address, timeout))
        client, server = socket.socketpair()
        server.close()
        return client

    with patch.object(
        ssrf.socket, "getaddrinfo", side_effect=AssertionError("dns")
    ), patch.object(ssrf.socket, "create_connection", side_effect=create_connection):
        sock = ssrf._dial(CHECKED_IP, 443, object())
    sock.close()
    assert seen == [((CHECKED_IP, 443), None)]


def test_open_refuses_an_empty_address_list_without_dialing():
    def dial(*_args, **_kwargs):
        raise AssertionError("dialed")

    with patch.object(ssrf.socket, "create_connection", side_effect=dial), patch.object(
        ssrf.socket, "getaddrinfo", side_effect=dial
    ):
        with pytest.raises(ssrf.UnsafeUrlError, match="no address"):
            ssrf._open("get", "https://pinned.invalid/a", [])


def _connect_phase_error():
    """ConnectionError shaped like requests raises for a refused TCP connect:
    the wrapped urllib3 chain ends in NewConnectionError, so nothing was sent."""
    return requests.exceptions.ConnectionError(
        MaxRetryError(
            None,
            "https://pinned.invalid/hook",
            reason=NewConnectionError(None, "Failed to establish a new connection"),
        )
    )


def _read_phase_error():
    """ConnectionError shaped like requests raises when the response read
    aborts after the request was transmitted: the server may already have it."""
    return requests.exceptions.ConnectionError(
        ProtocolError("Connection aborted.")
    )


def test_open_retries_a_post_only_after_a_connect_phase_failure():
    ips = [ipaddress.ip_address("93.184.215.14"), ipaddress.ip_address("93.184.215.15")]
    with patch.object(
        ssrf, "_send_pinned", side_effect=[_connect_phase_error(), _Response()]
    ) as send:
        response = ssrf._open("post", "https://pinned.invalid/hook", ips)
    assert response.status_code == 200
    assert [call.args[2] for call in send.call_args_list] == ["93.184.215.14", "93.184.215.15"]


def test_open_does_not_resend_a_post_after_a_read_phase_failure():
    ips = [ipaddress.ip_address("93.184.215.14"), ipaddress.ip_address("93.184.215.15")]
    with patch.object(ssrf, "_send_pinned", side_effect=[_read_phase_error(), _Response()]) as send:
        with pytest.raises(requests.exceptions.ConnectionError):
            ssrf._open("post", "https://pinned.invalid/hook", ips)
    assert send.call_count == 1


def test_open_still_retries_a_get_after_a_read_phase_failure():
    ips = [ipaddress.ip_address("93.184.215.14"), ipaddress.ip_address("93.184.215.15")]
    with patch.object(ssrf, "_send_pinned", side_effect=[_read_phase_error(), _Response()]) as send:
        response = ssrf._open("get", "https://pinned.invalid/a", ips)
    assert response.status_code == 200
    assert send.call_count == 2


def test_a_non_streaming_request_returns_the_pinned_response():
    """stream=False is the webhook path: the body comes back, then the session closes."""
    seen = []
    dials = []

    def create_connection(address, timeout=None, *args, **kwargs):
        dials.append((address, timeout))
        response = _http_response(
            200, "OK", {"Content-Type": "application/json"}, b'{"ok": true}'
        )
        return _scripted_socket(lambda _request: response, seen)

    with patch.object(
        ssrf.socket, "getaddrinfo", side_effect=AssertionError("dns")
    ), patch.object(ssrf.socket, "create_connection", side_effect=create_connection):
        response = ssrf._send_pinned(
            "post",
            "http://pinned.invalid/hook",
            CHECKED_IP,
            json={"ok": True},
            timeout=10,
            stream=False,
        )
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert dials == [((CHECKED_IP, 80), 10)]
    assert seen and b"Host: pinned.invalid" in seen[0]
    response.close()


def test_pinned_adapter_refuses_a_proxy_without_dialing():
    session = requests.Session()
    session.trust_env = False
    session.mount("https://", ssrf._PinnedAdapter(CHECKED_IP))

    def dial(*_args, **_kwargs):
        raise AssertionError("dialed")

    with patch.object(socket, "create_connection", side_effect=dial), patch.object(
        socket, "getaddrinfo", side_effect=dial
    ), patch.object(socket.socket, "connect", side_effect=dial):
        with pytest.raises(ssrf.UnsafeUrlError, match="proxied"):
            session.get(
                "https://pinned.invalid/hook",
                proxies={"https": "http://203.0.113.5:8080"},
                timeout=1,
            )

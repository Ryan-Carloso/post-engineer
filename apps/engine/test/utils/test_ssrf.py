"""assert_public_url validates the host the HTTP client actually dials.

requests hands the URL to urllib3, whose parser ends the authority at a
backslash, while urllib.parse keeps the whole netloc and takes the host
after the last "@". A URL on which the two parsers disagree must be
rejected before any request is made (issue #442).
"""

import ipaddress
from unittest.mock import patch

import pytest
from urllib3.exceptions import LocationParseError
from urllib3.util.url import Url

from app.utils import ssrf

PUBLIC_IP = [ipaddress.ip_address("93.184.215.14")]

# Private host before a backslash, public literal after it: urlparse sees the
# public literal, urllib3 dials the private host and port.
PARSER_DIFFERENTIAL_URLS = [
    "http://127.0.0.1:8081\\@1.1.1.1/secret",
    "http://169.254.169.254\\@1.1.1.1:9000/latest/meta-data/",
    "http://1.1.1.1\\@127.0.0.1:8081/secret",
    "https://10.0.0.5\\@example.com/a.jpg",
    # urlparse strips tab/newline, urllib3 keeps them in the host.
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
    # A future divergence the character filter does not know about: the
    # client's parser reads a different host, port or scheme.
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

"""The persona-voice download uses the pinned SSRF helper.

A URL whose authority urllib3 reads differently from urlparse (issue #442)
never opens a socket. A name that rebinds to loopback after the check is
still fetched from the address that was validated (issue #443).
"""

import ipaddress
import socket
import threading
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services import task as tm
from app.utils import ssrf

CHECKED_IP = "93.184.215.14"


def _read_http_request(sock):
    sock.settimeout(2)
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = sock.recv(4096)
        if not chunk:
            return data
        data += chunk
    return data


def _scripted_socket(response, seen):
    client, server = socket.socketpair()

    def run():
        try:
            server.settimeout(2)
            request = _read_http_request(server)
            if request:
                seen.append(request)
                server.sendall(response)
        except OSError:
            pass
        finally:
            server.close()

    threading.Thread(target=run, daemon=True).start()
    return client


def _response(status, reason, headers, body):
    payload = {"Content-Length": str(len(body)), "Connection": "close"}
    payload.update(headers)
    lines = [f"HTTP/1.1 {status} {reason}"]
    lines.extend(f"{key}: {value}" for key, value in payload.items())
    return ("\r\n".join(lines) + "\r\n\r\n").encode() + body


def test_a_backslash_authority_is_rejected_without_a_dial(tmp_path):
    def create_connection(address, timeout=None, *args, **kwargs):
        raise AssertionError(f"dialed {address}")

    with patch.object(tm.utils, "task_dir", return_value=str(tmp_path)), patch.object(
        ssrf, "_resolve_global_ips", return_value=[ipaddress.ip_address(CHECKED_IP)]
    ), patch.object(ssrf.socket, "create_connection", side_effect=create_connection):
        with pytest.raises(tm.PersonaVoiceError, match="canonical"):
            tm._download_persona_voice(
                "t-442", "http://127.0.0.1:8081\\@1.1.1.1/voice.mp3"
            )
    assert not (tmp_path / "persona_voice").exists()


def test_a_redirect_to_a_backslash_authority_is_not_followed(tmp_path):
    first = "http://example.com/voice.mp3"
    dials = []
    seen = []

    def resolve(host):
        return [ipaddress.ip_address(CHECKED_IP)]

    def create_connection(address, timeout=None, *args, **kwargs):
        dials.append(address)
        location = "http://169.254.169.254\\@1.1.1.1/"
        response = _response(302, "Found", {"Location": location}, b"")
        return _scripted_socket(response, seen)

    with patch.object(tm.utils, "task_dir", return_value=str(tmp_path)), patch.object(
        ssrf, "_resolve_global_ips", side_effect=resolve
    ), patch.object(ssrf.socket, "create_connection", side_effect=create_connection):
        with pytest.raises(tm.PersonaVoiceError, match="canonical"):
            tm._download_persona_voice("t-442", first)
    assert dials == [(CHECKED_IP, 80)]
    assert len(seen) == 1
    assert not (tmp_path / "persona_voice").exists()


def test_persona_voice_dials_the_checked_ip_when_dns_rebinds(tmp_path):
    lookups = []
    dials = []
    seen = []

    def resolve(_host):
        lookups.append(_host)
        if len(lookups) == 1:
            return [ipaddress.ip_address(CHECKED_IP)]
        return [ipaddress.ip_address("127.0.0.1")]

    def create_connection(address, timeout=None, *args, **kwargs):
        dials.append(address)
        body = b"PUBLIC" if address[0] == CHECKED_IP else b"REBIND!"
        response = _response(200, "OK", {"Content-Type": "audio/mpeg"}, body)
        return _scripted_socket(response, seen)

    with patch.object(tm.utils, "task_dir", return_value=str(tmp_path)), patch.object(
        ssrf, "_resolve_global_ips", side_effect=resolve
    ), patch.object(
        ssrf.socket, "create_connection", side_effect=create_connection
    ), patch.object(
        ssrf.socket, "getaddrinfo", side_effect=AssertionError("dns")
    ), patch.object(
        tm, "_probe_persona_voice_duration", return_value=1.0
    ):
        path = tm._download_persona_voice("t-443", "http://rebind.test/voice.mp3")
    assert dials == [(CHECKED_IP, 80)]
    assert seen and b"Host: rebind.test" in seen[0]
    assert Path(path).read_bytes() == b"PUBLIC"

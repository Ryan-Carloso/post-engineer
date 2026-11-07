"""The persona-voice download rejects a parser-differential URL before fetching.

The voice sample is fetched with requests after the shared SSRF guard, so a
URL whose authority urllib3 reads differently from urlparse (issue #442)
must never reach requests.get, on the first hop or after a redirect.
"""

import ipaddress
from unittest.mock import MagicMock, patch

import pytest

from app.services import task as tm
from app.utils import ssrf

PUBLIC_IP = [ipaddress.ip_address("93.184.215.14")]


def test_a_backslash_authority_is_rejected_without_a_request(tmp_path):
    with patch.object(tm.utils, "task_dir", return_value=str(tmp_path)), patch.object(
        ssrf, "_resolve_global_ips", return_value=PUBLIC_IP
    ), patch("requests.get") as get:
        with pytest.raises(tm.PersonaVoiceError, match="canonical"):
            tm._download_persona_voice("t-442", "http://127.0.0.1:8081\\@1.1.1.1/voice.mp3")
    get.assert_not_called()
    assert not (tmp_path / "persona_voice").exists()


def test_a_redirect_to_a_backslash_authority_is_not_followed(tmp_path):
    first = "https://example.com/voice.mp3"
    redirect = MagicMock(status_code=302, headers={"location": "http://169.254.169.254\\@1.1.1.1/"})
    with patch.object(tm.utils, "task_dir", return_value=str(tmp_path)), patch.object(
        ssrf, "_resolve_global_ips", return_value=PUBLIC_IP
    ), patch("requests.get", return_value=redirect) as get:
        with pytest.raises(tm.PersonaVoiceError, match="canonical"):
            tm._download_persona_voice("t-442", first)
    assert [call.args[0] for call in get.call_args_list] == [first]

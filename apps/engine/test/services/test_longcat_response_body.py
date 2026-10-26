"""Tests for the LongCat upstream HTTP error body.

A LongCat HTTP failure used to surface only its status code
("LongCat submit failed with HTTP 404"): the response body — the actual
reason, e.g. a disabled Modal workspace — was discarded. The body is now
kept on the exception as ``response_body`` and sent to PostHog as the
``ai_request`` event's ``response_body`` property, and kept OUT of the
exception message, which reaches Discord and the client-visible task
error. This file is separate from ``test_longcat.py`` so that
grandfathered file (over the 500-line cap) does not grow.
"""

import contextlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import requests

from app.models.schema import LipSyncQuality
from app.services import longcat


def _response(status_code: int, content: bytes) -> requests.Response:
    response = requests.Response()
    response.status_code = status_code
    response._content = content
    return response


_LONGCAT_ENV = {
    "LONGCAT_SUBMIT_URL": "https://modal.test/submit",
    "LONGCAT_STATUS_URL": "https://modal.test/status",
    "LONGCAT_DOWNLOAD_URL": "https://modal.test/download",
    "LONGCAT_HTTP_SECRET": "test-secret",
}

_LONGCAT_CONFIG = {
    "poll_interval_seconds": 0,
    "timeout_seconds": 1,
    "intro_duration_seconds": 5,
}


@contextlib.contextmanager
def _stubs():
    with patch.object(longcat, "trim_audio") as trim:
        trim.side_effect = lambda source, target, *args, **kwargs: Path(target).write_bytes(
            b"audio"
        )
        with patch.object(longcat, "audio_duration_seconds", return_value=5.0):
            with patch.dict(os.environ, _LONGCAT_ENV):
                with patch.object(longcat.config, "longcat", _LONGCAT_CONFIG):
                    yield


class TestHttpErrorResponseBody(unittest.TestCase):
    def _run(self, responses):
        queue = list(responses)

        def request(*args: object, **kwargs: object) -> requests.Response:
            return queue.pop(0)

        with tempfile.TemporaryDirectory() as temp_dir:
            image = Path(temp_dir) / "image.png"
            audio = Path(temp_dir) / "audio.mp3"
            output = Path(temp_dir) / "intro.mp4"
            image.write_bytes(b"image")
            audio.write_bytes(b"audio")
            with _stubs():
                return longcat.generate_intro(
                    str(image),
                    str(audio),
                    LipSyncQuality.ok,
                    str(output),
                    request=request,
                )

    def test_submit_http_error_keeps_body_out_of_message(self):
        with self.assertRaises(longcat.LongCatError) as raised:
            self._run([_response(404, b'{"detail":"workspace is disabled"}')])
        self.assertIn("404", str(raised.exception))
        self.assertNotIn("workspace is disabled", str(raised.exception))
        self.assertEqual(
            raised.exception.response_body,
            '{"detail":"workspace is disabled"}',
        )

    def test_http_error_body_is_truncated(self):
        with self.assertRaises(longcat.LongCatError) as raised:
            self._run([_response(500, b"x" * 600)])
        self.assertEqual(len(raised.exception.response_body), 500)

    def test_failure_tracks_response_body_in_posthog(self):
        with patch.object(longcat, "track_ai_request") as track:
            with self.assertRaises(longcat.LongCatError):
                self._run([_response(404, b'{"detail":"workspace is disabled"}')])
        track.assert_called_once()
        props = track.call_args[0][0]
        self.assertFalse(props["success"])
        self.assertIn("404", props["error"])
        self.assertNotIn("workspace is disabled", props["error"])
        self.assertEqual(props["response_body"], '{"detail":"workspace is disabled"}')

    def test_failure_tracks_no_response_body_without_one(self):
        # A non-HTTP failure (e.g. a missing env var) has no upstream
        # body, so the property must be absent, not empty.
        with patch.object(longcat, "track_ai_request") as track:
            with patch.dict(os.environ, _LONGCAT_ENV):
                os.environ.pop("LONGCAT_SUBMIT_URL", None)
                with tempfile.TemporaryDirectory() as temp_dir:
                    image = Path(temp_dir) / "image.png"
                    audio = Path(temp_dir) / "audio.mp3"
                    output = Path(temp_dir) / "intro.mp4"
                    image.write_bytes(b"image")
                    audio.write_bytes(b"audio")
                    with patch.object(longcat, "trim_audio"):
                        with patch.object(longcat.config, "longcat", _LONGCAT_CONFIG):
                            with self.assertRaises(longcat.LongCatError):
                                longcat.generate_intro(
                                    str(image),
                                    str(audio),
                                    LipSyncQuality.ok,
                                    str(output),
                                )
        props = track.call_args[0][0]
        self.assertNotIn("response_body", props)

    def test_secret_in_body_is_scrubbed_before_posthog(self):
        body = b'{"detail":"bad api_key: sk-or-v1-abcdefghij1234567890"}'
        with patch.object(longcat, "track_ai_request") as track:
            with self.assertRaises(longcat.LongCatError):
                self._run([_response(401, body)])
        props = track.call_args[0][0]
        self.assertNotIn("sk-or-v1-abcdefghij1234567890", props["response_body"])
        self.assertIn("[redacted]", props["response_body"])

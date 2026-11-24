"""`classify` only reports a missing object on a genuine 404.

A transient download failure must not be mistaken for a missing
object: `--apply` would upsert the VPS file over the stored copy.
"""

from __future__ import annotations

import requests
import pytest

from scripts.migrate_clone_voices import classify


def _http_error(status: int) -> requests.HTTPError:
    response = requests.Response()
    response.status_code = status
    return requests.HTTPError(response=response)


class _FakeStore:
    def __init__(self, row: dict | None, download) -> None:
        self._row = row
        self._download = download

    def get_by_engine_voice_key(self, name: str) -> dict | None:
        return self._row

    def download_reference_wav(self, storage_path: str) -> bytes:
        return self._download(storage_path)


def _row() -> dict:
    return {"storage_path": "user/cloned-voices/clone/reference.wav"}


def test_download_404_is_a_missing_object() -> None:
    def _download(path: str) -> bytes:
        raise _http_error(404)

    assert classify("clone", _FakeStore(_row(), _download)) == "missing_object"


def test_download_500_is_not_a_missing_object() -> None:
    def _download(path: str) -> bytes:
        raise _http_error(500)

    with pytest.raises(requests.HTTPError):
        classify("clone", _FakeStore(_row(), _download))


def test_download_network_error_is_not_a_missing_object() -> None:
    def _download(path: str) -> bytes:
        raise requests.ConnectionError("dns down")

    with pytest.raises(requests.ConnectionError):
        classify("clone", _FakeStore(_row(), _download))


def test_empty_payload_is_a_missing_object() -> None:
    assert (
        classify("clone", _FakeStore(_row(), lambda path: b""))
        == "missing_object"
    )


def test_downloaded_payload_is_present() -> None:
    assert (
        classify("clone", _FakeStore(_row(), lambda path: b"RIFF"))
        == "present"
    )


def test_missing_row_is_no_row() -> None:
    assert classify("clone", _FakeStore(None, lambda path: b"RIFF")) == "no_row"


def test_row_without_storage_path_is_no_row() -> None:
    assert classify("clone", _FakeStore({}, lambda path: b"RIFF")) == "no_row"

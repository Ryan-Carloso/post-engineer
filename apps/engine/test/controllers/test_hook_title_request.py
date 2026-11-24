"""hook_title on TaskVideoRequest: a bad title is a 400 with a stable code,
before any task row exists (so before any charge)."""

import pytest
from fastapi.testclient import TestClient

from app import asgi
from app.models.schema import TaskVideoRequest, VideoParams
from app.services import hook_title

BASE = {
    "video_title": "Porto",
    "video_description": "Test description.",
    "video_type": "voiceover",
}


def _post(payload: dict, auth_headers: dict) -> object:
    client = TestClient(asgi.app, raise_server_exceptions=False)
    return client.post("/api/v1/videos", json=payload, headers=auth_headers)


@pytest.mark.parametrize(
    ("title", "code"),
    [
        ("one two three four five six seven eight", hook_title.CODE_TOO_MANY_WORDS),
        ("a" * (hook_title.HOOK_TITLE_MAX_CHARS + 1), hook_title.CODE_TOO_LONG),
        ("", hook_title.CODE_EMPTY),
        ("   ", hook_title.CODE_EMPTY),
        ("line one\nline two", hook_title.CODE_INVALID_CHARS),
    ],
)
def test_a_bad_title_is_a_400_carrying_the_stable_code(title, code, auth_headers):
    response = _post({**BASE, "hook_title": title}, auth_headers)
    assert response.status_code == 400
    errors = response.json()["body"]
    assert [error["loc"] for error in errors] == [["body", "hook_title"]]
    assert errors[0]["ctx"]["error"]["code"] == code
    assert code in errors[0]["msg"]


def test_a_valid_title_is_accepted_and_kept_as_written():
    request = TaskVideoRequest(**BASE, hook_title="I entered the sea clothed?")
    assert request.hook_title == "I entered the sea clothed?"


def test_the_stored_title_has_its_whitespace_collapsed():
    assert VideoParams(**BASE, hook_title="  A   B ").hook_title == "A B"


def test_the_title_is_optional():
    assert TaskVideoRequest(**BASE).hook_title is None
    assert TaskVideoRequest(**BASE, hook_title=None).hook_title is None

"""Direct tests for task_file_to_uri, the task output to download URI map."""

import pytest

from app.controllers.v1.task_file_uri import task_file_to_uri


@pytest.fixture
def task_dir(tmp_path):
    directory = tmp_path / "task-1"
    directory.mkdir()
    (directory / "final-1.mp4").write_text("video", encoding="utf-8")
    return str(directory)


def test_non_string_file_is_returned_unchanged(task_dir):
    assert task_file_to_uri(None, "", task_dir, "req-1") is None  # type: ignore[arg-type]


def test_remote_url_is_returned_unchanged(task_dir):
    url = "https://cdn.example.com/final-1.mp4"
    assert task_file_to_uri(url, "", task_dir, "req-1") == url


def test_relative_file_maps_to_the_download_uri(task_dir):
    assert (
        task_file_to_uri("final-1.mp4", "", task_dir, "req-1")
        == "/api/v1/download/final-1.mp4"
    )


def test_endpoint_prefixes_the_download_uri(task_dir):
    assert (
        task_file_to_uri("final-1.mp4", "https://example.com/", task_dir, "req-1")
        == "https://example.com/api/v1/download/final-1.mp4"
    )


def test_absolute_file_inside_the_task_dir_maps_to_a_relative_uri(task_dir):
    assert (
        task_file_to_uri(f"{task_dir}/final-1.mp4", "", task_dir, "req-1")
        == "/api/v1/download/final-1.mp4"
    )


def test_unsafe_path_is_returned_unchanged(task_dir):
    assert (
        task_file_to_uri("../escape.mp4", "", task_dir, "req-1") == "../escape.mp4"
    )

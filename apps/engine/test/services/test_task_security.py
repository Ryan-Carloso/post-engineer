"""Security tests for app.services.task.

Covers:
- prepare_persona_lipsync_video: persona image download goes through the
  SSRF-safe helper (private IPs / resolving hosts rejected, valid public
  images accepted).
- resolve_custom_audio_file: only files inside the task directory or the
  local_videos storage directory are accepted.
"""

import os
import shutil
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import app.services.task as tm
from app.models.schema import PersonaParams, VideoParams


def _addrinfo(*ips):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 0)) for ip in ips]


class _FakeImageResponse:
    def __init__(self, status_code=200, content_type="image/png", chunks=(b"\x89PNG" + b"\x00" * 100,)):
        self.status_code = status_code
        self.headers = {"Content-Type": content_type}
        self._chunks = chunks

    def iter_content(self, chunk_size=8192):
        yield from self._chunks

    def close(self):
        pass


class TestPersonaImageDownloadSecurity(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="task-security-test-")
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def _params(self, avatar_url):
        persona = PersonaParams(
            id="p1", name="Test", avatar_url=avatar_url, voice_id="voice-1"
        )
        return VideoParams(video_subject="test", persona=persona)

    def _run(self, avatar_url, resolved_ips=("93.184.216.34",), response=None):
        patches = [
            patch.object(tm.utils, "task_dir", return_value=self.tmp),
            patch("socket.getaddrinfo", return_value=_addrinfo(*resolved_ips)),
            patch("requests.get", return_value=response or _FakeImageResponse()),
            patch.object(tm.subtitle, "file_to_subtitles", return_value=[]),
            patch.object(tm, "persona_hook_end_seconds", return_value=1.0),
            patch.object(tm.infinitetalk, "generate_intro", return_value="intro.mp4"),
            patch.object(
                tm.video, "replace_video_intro_with_lipsync", return_value="final.mp4"
            ),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        return tm.prepare_persona_lipsync_video(
            "task-1",
            self._params(avatar_url),
            "audio.mp3",
            "bg.mp4",
            0,
            "script",
            "sub.srt",
        )

    def test_rejects_private_ip_image_url(self):
        with self.assertRaises(tm.infinitetalk.InfiniteTalkError):
            self._run("http://169.254.169.254/secret.png")
        self.assertEqual(os.listdir(self.tmp), [])

    def test_rejects_hostname_resolving_to_private_ip(self):
        with self.assertRaises(tm.infinitetalk.InfiniteTalkError):
            self._run(
                "https://avatar.internal.test/pic.png", resolved_ips=("10.1.2.3",)
            )
        self.assertEqual(os.listdir(self.tmp), [])

    def test_rejects_non_image_content_type(self):
        with self.assertRaises(tm.infinitetalk.InfiniteTalkError):
            self._run(
                "https://cdn.example.com/pic",
                response=_FakeImageResponse(content_type="text/html"),
            )
        self.assertEqual(os.listdir(self.tmp), [])

    def test_accepts_valid_public_image(self):
        result = self._run("https://cdn.example.com/avatar.png")
        self.assertEqual(result, "final.mp4")
        files = os.listdir(self.tmp)
        self.assertEqual(len(files), 1)
        self.assertTrue(files[0].startswith("persona"))
        self.assertGreater(os.path.getsize(os.path.join(self.tmp, files[0])), 0)


class TestResolveCustomAudioFile(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="audio-resolve-test-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.local_videos = tempfile.mkdtemp(prefix="local-videos-test-")
        self.addCleanup(shutil.rmtree, self.local_videos, True)

    def _resolve(self, name):
        with (
            patch.object(tm.utils, "task_dir", return_value=self.tmp),
            patch.object(tm.utils, "storage_dir", return_value=self.local_videos),
        ):
            return tm.resolve_custom_audio_file("task-1", name)

    def _touch(self, directory, name):
        path = os.path.join(directory, name)
        with open(path, "wb") as f:
            f.write(b"\x00" * 16)
        return path

    def test_accepts_file_in_task_dir(self):
        self._touch(self.tmp, "custom.mp3")
        resolved = self._resolve("custom.mp3")
        self.assertEqual(os.path.realpath(resolved), os.path.realpath(self.tmp) + os.sep + "custom.mp3")

    def test_accepts_file_in_local_videos(self):
        self._touch(self.local_videos, "shared.mp3")
        resolved = self._resolve("shared.mp3")
        self.assertEqual(
            os.path.realpath(resolved),
            os.path.realpath(self.local_videos) + os.sep + "shared.mp3",
        )

    def test_rejects_absolute_path(self):
        with self.assertRaises(ValueError):
            self._resolve("/etc/hostname")

    def test_rejects_absolute_path_inside_allowed_dir(self):
        # Even an absolute path that lands inside an allowed directory is
        # rejected: callers must pass a basename, never a host path.
        inside = self._touch(self.tmp, "custom.mp3")
        self.assertTrue(os.path.isabs(inside))
        with self.assertRaises(ValueError):
            self._resolve(inside)

    def test_rejects_symlink_escape(self):
        # A symlink inside the task dir pointing to a file outside it must
        # be rejected.
        outside = os.path.join(os.path.dirname(self.tmp), "secret-audio.mp3")
        with open(outside, "wb") as f:
            f.write(b"\x00" * 16)
        self.addCleanup(os.remove, outside)
        link = os.path.join(self.tmp, "link.mp3")
        os.symlink(outside, link)
        with self.assertRaises(ValueError):
            self._resolve("link.mp3")

    def test_rejects_traversal(self):
        with self.assertRaises(ValueError):
            self._resolve("../escape.mp3")

    def test_rejects_unrelated_project_file(self):
        # An existing file outside both allowed directories must be rejected.
        sibling = os.path.join(os.path.dirname(self.tmp), "sibling.txt")
        with open(sibling, "w") as f:
            f.write("x")
        self.addCleanup(os.remove, sibling)
        with self.assertRaises(ValueError):
            self._resolve(sibling)

    def test_rejects_missing_file(self):
        with self.assertRaises(ValueError):
            self._resolve("nope.mp3")


if __name__ == "__main__":
    unittest.main()

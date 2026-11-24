"""Security tests for app.services.task.

Covers:
- prepare_persona_lipsync_video: the first segment photo download goes
  through the SSRF-safe helper (private IPs / resolving hosts rejected,
  valid public images accepted). The persona avatar is never downloaded:
  the hook image is the first photo of the video (issue #766).
- resolve_persona_image_url: house-face paths resolve against
  MPT_UPLOAD_API_BASE_URL, and fail clearly without it.
- resolve_custom_audio_file: only files inside the task directory or the
  local_videos storage directory are accepted.
"""

import io
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
from app.models.schema import PersonaParams, TaskVideoRequest
from app.services.persona_image import resolve_persona_image_url

HOOK = (
    "Stop wasting your trip stuck in a ninety minute line for the original dish "
    "when a better table is still waiting nearby for you today."
)
BODY = (
    "Locals skip the famous house and walk two minutes to a smaller kitchen where "
    "the sauce recipe has not changed since nineteen fifty three and the cook still "
    "greets every table by name before the first plate arrives at your table tonight."
)
CTA = "Save this video before your next trip to Porto."


def _photos(prefix, count):
    return [{"url": f"https://example.com/{prefix}{i}.jpg"} for i in range(count)]


def _valid_png_bytes():
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (1080, 1920), (10, 20, 30)).save(buf, "PNG")
    return buf.getvalue()


def _addrinfo(*ips):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 0)) for ip in ips]


class _FakeImageResponse:
    def __init__(
        self, status_code=200, content_type="image/png", chunks=None
    ):
        self.status_code = status_code
        self.headers = {"Content-Type": content_type}
        self._chunks = chunks if chunks is not None else (_valid_png_bytes(),)

    def iter_content(self, chunk_size=8192):
        yield from self._chunks

    def close(self):
        pass


class TestPersonaImageDownloadSecurity(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="task-security-test-")
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def _params(self, first_photo_url):
        persona = PersonaParams(id="p1", name="Test", avatar_url=first_photo_url, voice_id="voice-1")
        return TaskVideoRequest(
            video_title="test",
            video_description="Test description.",
            video_type="voiceover",
            persona=persona,
            segments=[
                {"kind": "hook", "text": HOOK, "media": [{"url": first_photo_url}, *_photos("h", 4)]},
                {"kind": "content", "text": BODY, "media": _photos("b", 8)},
                {"kind": "content", "text": CTA, "media": _photos("c", 2)},
            ],
        )

    def _run(self, first_photo_url, resolved_ips=("93.184.216.34",), response=None):
        patches = [
            patch.object(tm.utils, "task_dir", return_value=self.tmp),
            patch("socket.getaddrinfo", return_value=_addrinfo(*resolved_ips)),
            patch(
                "app.utils.ssrf._send_pinned",
                return_value=response or _FakeImageResponse(),
            ),
            patch.object(tm.subtitle, "file_to_subtitles", return_value=[]),
            patch.object(tm.persona_hook, "_find_hook_end_seconds", return_value=1.0),
            patch.object(
                tm.longcat,
                "generate_intro_with_container",
                return_value=("intro.mp4", 0.05, "job-1", None),
            ),
            patch.object(tm.video, "replace_video_intro_with_lipsync", return_value="final.mp4"),
            patch("app.services.face_detect.image_contains_face", return_value=True),
        ]
        self.started = [p.start() for p in patches]
        for p in patches:
            self.addCleanup(p.stop)
        return tm.prepare_persona_lipsync_video(
            "task-1",
            self._params(first_photo_url),
            "audio.mp3",
            "bg.mp4",
            0,
            "script",
            "sub.srt",
        )

    def test_rejects_private_ip_image_url(self):
        with self.assertRaises(tm.longcat.LongCatError):
            self._run("http://169.254.169.254/secret.png")
        self.assertEqual(os.listdir(self.tmp), [])

    def test_rejects_hostname_resolving_to_private_ip(self):
        with self.assertRaises(tm.longcat.LongCatError):
            self._run("https://avatar.internal.test/pic.png", resolved_ips=("10.1.2.3",))
        self.assertEqual(os.listdir(self.tmp), [])

    def test_rejects_non_image_content_type(self):
        with self.assertRaises(tm.longcat.LongCatError):
            self._run(
                "https://cdn.example.com/pic",
                response=_FakeImageResponse(content_type="text/html"),
            )
        self.assertEqual(os.listdir(self.tmp), [])

    def test_accepts_valid_public_image(self):
        result, intro_cost_usd, intro_job_id, _ = self._run("https://cdn.example.com/avatar.png")
        self.assertEqual(result, "final.mp4")
        self.assertEqual(intro_cost_usd, 0.05)
        self.assertEqual(intro_job_id, "job-1")
        files = os.listdir(self.tmp)
        self.assertEqual(len(files), 1)
        self.assertTrue(files[0].startswith("persona"))
        self.assertGreater(os.path.getsize(os.path.join(self.tmp, files[0])), 0)

    def test_resolves_house_face_path_against_the_web_base_url(self):
        with patch.dict(os.environ, {"MPT_UPLOAD_API_BASE_URL": "https://web.example.com/"}):
            self.assertEqual(
                resolve_persona_image_url("/caracter-samples/file-3.png"),
                "https://web.example.com/caracter-samples/file-3.png",
            )

    def test_house_face_without_web_base_url_fails_with_a_clear_reason(self):
        with (
            patch.dict(os.environ, {"MPT_UPLOAD_API_BASE_URL": ""}),
            self.assertRaises(tm.longcat.LongCatError) as ctx,
        ):
            resolve_persona_image_url("/caracter-samples/file-3.png")
        self.assertIn("MPT_UPLOAD_API_BASE_URL", str(ctx.exception))

    def test_other_relative_paths_are_not_resolved(self):
        with (
            patch.dict(os.environ, {"MPT_UPLOAD_API_BASE_URL": "https://web.example.com"}),
            self.assertRaises(tm.longcat.LongCatError),
        ):
            self._run("/api/admin/secret.png")
        self.started[2].assert_not_called()


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
        self.assertEqual(
            os.path.realpath(resolved), os.path.realpath(self.tmp) + os.sep + "custom.mp3"
        )

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
        inside = self._touch(self.tmp, "custom.mp3")
        self.assertTrue(os.path.isabs(inside))
        with self.assertRaises(ValueError):
            self._resolve(inside)

    def test_rejects_symlink_escape(self):
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

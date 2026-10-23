"""Direct tests for sanitize_upload_filename.

The helper guards the media upload endpoints against directory traversal:
whatever name a client sends, only the bare filename may reach the disk.
It used to live inside controllers/v1/video.py and was only covered
indirectly; as its own module it needs direct tests (mutmut attributes no
endpoint test to it, which failed the per-file mutation shard).
"""

import unittest

from app.models.exception import HttpException
from app.services.upload_filenames import sanitize_upload_filename


class SanitizeUploadFilenameTests(unittest.TestCase):
    def test_bare_filename_passes_through(self):
        self.assertEqual(sanitize_upload_filename("song.mp3", "req-1"), "song.mp3")

    def test_posix_path_is_stripped_to_the_bare_filename(self):
        self.assertEqual(
            sanitize_upload_filename("/tmp/uploads/song.mp3", "req-1"), "song.mp3"
        )

    def test_windows_path_is_stripped_to_the_bare_filename(self):
        self.assertEqual(
            sanitize_upload_filename("C:\\Users\\me\\song.mp3", "req-1"), "song.mp3"
        )

    def test_traversal_segments_resolve_to_the_bare_filename(self):
        self.assertEqual(
            sanitize_upload_filename("../../etc/passwd", "req-1"), "passwd"
        )
        self.assertEqual(
            sanitize_upload_filename("..\\..\\evil.wav", "req-1"), "evil.wav"
        )

    def test_surrounding_whitespace_is_trimmed(self):
        self.assertEqual(
            sanitize_upload_filename("  padded.mp3  ", "req-1"), "padded.mp3"
        )

    def test_invalid_filenames_raise_a_400_with_the_request_id(self):
        for filename in ("", None, ".", "..", "///", "   "):
            with self.subTest(filename=filename):
                with self.assertRaises(HttpException) as caught:
                    sanitize_upload_filename(filename, "req-1")
                self.assertEqual(caught.exception.status_code, 400)
                self.assertEqual(caught.exception.message, "req-1: invalid filename")
                self.assertEqual(caught.exception.task_id, "req-1")


if __name__ == "__main__":
    unittest.main()

import io
import os
import shutil
import tempfile
import unittest
from unittest.mock import MagicMock

from app.utils.upload_limits import UploadTooLargeError, save_upload_stream


class TestSaveUploadStream(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="upload-limits-test-")
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def _make_upload(self, data: bytes):
        upload = MagicMock()
        upload.file = io.BytesIO(data)
        return upload

    def test_save_upload_stream_success(self):
        dest = os.path.join(self.tmp, "sub", "test.bin")
        data = b"hello world 1234567890"
        upload = self._make_upload(data)
        written = save_upload_stream(upload, dest, max_bytes=1024, chunk_size=4)
        self.assertEqual(written, len(data))
        self.assertTrue(os.path.exists(dest))
        with open(dest, "rb") as f:
            self.assertEqual(f.read(), data)

    def test_save_upload_stream_too_large_raises_and_cleans_up(self):
        dest = os.path.join(self.tmp, "test_large.bin")
        data = b"x" * 100
        upload = self._make_upload(data)
        with self.assertRaises(UploadTooLargeError):
            save_upload_stream(upload, dest, max_bytes=50, chunk_size=10)

        # Dest should not exist and no stray temp files left
        self.assertFalse(os.path.exists(dest))
        self.assertEqual(os.listdir(self.tmp), [])

    def test_overwrites_existing_atomically(self):
        dest = os.path.join(self.tmp, "target.bin")
        with open(dest, "wb") as f:
            f.write(b"old content")

        data = b"new content"
        upload = self._make_upload(data)
        written = save_upload_stream(upload, dest, max_bytes=1024)
        self.assertEqual(written, len(data))
        with open(dest, "rb") as f:
            self.assertEqual(f.read(), data)


if __name__ == "__main__":
    unittest.main()

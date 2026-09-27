import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services.task import cleanup_task_intermediates
from app.utils import utils


class TestCpuStorage(unittest.TestCase):
    def test_storage_dir_uses_env_override_and_creates_subdirectory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch.dict(os.environ, {"MPT_STORAGE_DIR": temporary_directory}):
                directory = utils.storage_dir("cache_videos", create=True)

            self.assertEqual(directory, os.path.join(temporary_directory, "cache_videos"))
            self.assertTrue(Path(directory).is_dir())

    def test_cleanup_keeps_preserved_files_and_removes_intermediates(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch.dict(os.environ, {"MPT_STORAGE_DIR": temporary_directory}):
                task_directory = Path(utils.task_dir("task-1"))
                preserved = task_directory / "final.mp4"
                removed = task_directory / "intermediate.wav"
                nested = task_directory / "nested"
                nested.mkdir()
                preserved.write_text("final", encoding="utf-8")
                removed.write_text("temporary", encoding="utf-8")
                (nested / "temporary.txt").write_text("temporary", encoding="utf-8")

                cleanup_task_intermediates("task-1", [str(preserved)])

                self.assertTrue(preserved.exists())
                self.assertFalse(removed.exists())
                self.assertFalse(nested.exists())

    def test_cleanup_ignores_missing_task_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch.dict(os.environ, {"MPT_STORAGE_DIR": temporary_directory}):
                cleanup_task_intermediates("missing", [])


if __name__ == "__main__":
    unittest.main()

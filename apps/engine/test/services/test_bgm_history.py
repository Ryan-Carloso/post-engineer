import tempfile
import unittest
from pathlib import Path

from app.services.bgm_history import SQLiteBgmHistoryRepository


class TestBgmHistory(unittest.TestCase):
    def test_history_is_last_three_and_isolated_per_user(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = SQLiteBgmHistoryRepository(Path(directory) / "history.sqlite3")
            for track in ("one.mp3", "two.mp3", "three.mp3", "four.mp3"):
                repository.record("alice", track)
            repository.record("bob", "other.mp3")

            self.assertEqual(repository.recent("alice"), ["four.mp3", "three.mp3", "two.mp3"])
            self.assertEqual(repository.recent("bob"), ["other.mp3"])

"""Local filesystem voice registry (replaces the Modal HTTP registry)."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services.cloned_voices.local_registry import (
    LocalVoiceRegistry,
    default_registry,
    reference_path_for,
)


class LocalRegistryTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)
        self.registry = LocalVoiceRegistry(directory=self.dir)

    def test_register_writes_the_reference_wav(self):
        self.registry.register_voice("u0123456789ab_c0123456789a", "en", b"RIFF-fake")
        self.assertEqual(
            (self.dir / "u0123456789ab_c0123456789a.wav").read_bytes(), b"RIFF-fake"
        )

    def test_register_overwrites_atomically(self):
        self.registry.register_voice("key1", "en", b"one")
        self.registry.register_voice("key1", "en", b"two")
        self.assertEqual((self.dir / "key1.wav").read_bytes(), b"two")
        self.assertFalse((self.dir / ".key1.tmp").exists())

    def test_delete_removes_and_tolerates_missing(self):
        self.registry.register_voice("key1", "en", b"one")
        self.registry.delete_voice("key1")
        self.assertFalse((self.dir / "key1.wav").exists())
        self.registry.delete_voice("key1")  # no raise

    def test_default_registry_is_local(self):
        self.assertIsInstance(default_registry(), LocalVoiceRegistry)

    def test_reference_path_for_uses_the_registry_dir(self):
        with patch(
            "app.services.cloned_voices.local_registry.local_registry_dir",
            return_value=self.dir,
        ):
            self.assertEqual(reference_path_for("key1"), self.dir / "key1.wav")


if __name__ == "__main__":
    unittest.main()

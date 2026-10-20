"""Unit tests for voices.toml registry helpers."""

import tempfile
import unittest
from pathlib import Path

from chatterbox_registry_volume import (
    delete_voice_on_volume,
    load_voices_toml,
    register_voice_on_volume,
    serialize_voices_toml,
    upsert_voice,
)


class ChatterboxRegistryVolumeTest(unittest.TestCase):
    def test_serialize_roundtrip(self) -> None:
        voices = upsert_voice({}, "ryan", "pt", "ryan/reference.wav")
        text = serialize_voices_toml(voices)
        with tempfile.TemporaryDirectory() as work:
            path = Path(work) / "voices.toml"
            path.write_text(text, encoding="utf-8")
            loaded = load_voices_toml(path)
        self.assertEqual(loaded["ryan"]["reference"], "ryan/reference.wav")
        self.assertEqual(loaded["ryan"]["language_id"], "pt")

    def test_register_and_delete_voice(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            root = Path(work) / "voices"
            root.mkdir()
            config = root / "voices.toml"
            config.write_text("", encoding="utf-8")
            wav = b"RIFF" + b"\x00" * 40
            register_voice_on_volume(root, config, "uabc_clone1", "en", wav)
            self.assertTrue((root / "uabc_clone1" / "reference.wav").is_file())
            self.assertIn("uabc_clone1", load_voices_toml(config))
            self.assertTrue(delete_voice_on_volume(root, config, "uabc_clone1"))
            self.assertNotIn("uabc_clone1", load_voices_toml(config))


if __name__ == "__main__":
    unittest.main()

import unittest
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from app.config import config
from app.services import video as vd

engine_root = Path(__file__).parent.parent.parent
example_config = engine_root / "config.example.toml"


class TestVideoConfigDefaults(unittest.TestCase):
    """
    config.example.toml is the only documented source for a self-hoster's
    codec settings, and the app has its own defaults when the key is absent.

    Those two surfaces drifted before: the example shipped video_preset =
    "medium" while the code used whatever was in config.toml, so a fresh
    install followed the docs and got the slow preset. These assertions pin
    the example to the code's default, and pin the default to the documented
    rationale.
    """

    def setUp(self):
        self.example_text = example_config.read_text(encoding="utf-8")
        # Isolate from the ambient config so these pin the shipped DEFAULT,
        # not whatever this machine's gitignored config.toml happens to say.
        self._original_config = dict(config.app)
        config.app.pop("video_preset", None)
        config.app.pop("video_codec", None)

    def tearDown(self):
        config.app.clear()
        config.app.update(self._original_config)

    def _example_value(self, key: str) -> str:
        for line in self.example_text.splitlines():
            stripped = line.strip()
            if stripped.startswith(f"{key} ="):
                return stripped.split("=", 1)[1].strip().strip('"')
        self.fail(f"{key} not found in config.example.toml")

    def test_example_codec_matches_the_code_default(self):
        """
        The example must not advertise a different codec than the code falls
        back to, or a self-hoster reads a promise the app does not keep.
        """
        self.assertEqual(self._example_value("video_codec"), vd._DEFAULT_VIDEO_CODEC)

    def test_example_preset_matches_the_code_default(self):
        self.assertEqual(self._example_value("video_preset"), "veryfast")

    def test_code_default_preset_is_veryfast(self):
        """
        The default is load-bearing: it is what every CPU-only self-hosted
        deployment encodes with, and medium was measured at ~13 minutes for a
        single lip-sync splice.
        """
        self.assertEqual(vd._get_configured_video_preset(), "veryfast")

    def test_every_documented_preset_is_accepted_by_the_validator(self):
        """
        An option listed in the example that the validator rejects would log
        a warning and silently use a different preset.
        """
        option_lines = [
            line.strip()
            for line in self.example_text.splitlines()
            if line.strip().startswith("# Options:") and "ultrafast" in line
        ]
        self.assertTrue(
            option_lines, "config.example.toml must document the preset options"
        )
        options = [
            part.strip().strip('"')
            for part in option_lines[0].split(":", 1)[1].split(",")
            if part.strip()
        ]
        self.assertTrue(options, "the documented preset option list is empty")
        for option in options:
            self.assertIn(
                option,
                vd._SUPPORTED_VIDEO_PRESETS,
                f"config.example.toml documents preset {option!r}, "
                f"which the validator would reject",
            )


if __name__ == "__main__":
    unittest.main()
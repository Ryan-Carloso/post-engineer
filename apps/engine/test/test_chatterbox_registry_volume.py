"""Unit tests for voices.toml registry helpers."""

import base64
import tempfile
import unittest
from pathlib import Path

from chatterbox_registry_volume import (
    decode_reference_wav,
    delete_voice_on_volume,
    load_voices_toml,
    register_voice_on_volume,
    serialize_voices_toml,
    upsert_voice,
)

WAV_HEADER = b"RIFF" + b"\x24\x00\x00\x00" + b"WAVE" + b"fmt " + b"\x00" * 28


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
            register_voice_on_volume(root, config, "uabc_clone1", "en", WAV_HEADER)
            self.assertTrue((root / "uabc_clone1" / "reference.wav").is_file())
            self.assertIn("uabc_clone1", load_voices_toml(config))
            self.assertTrue(delete_voice_on_volume(root, config, "uabc_clone1"))
            self.assertNotIn("uabc_clone1", load_voices_toml(config))

    def test_load_missing_or_empty_config_returns_empty(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            missing = Path(work) / "voices.toml"
            self.assertEqual(load_voices_toml(missing), {})
            missing.write_text("", encoding="utf-8")
            self.assertEqual(load_voices_toml(missing), {})

    def test_decode_reference_wav_roundtrip(self) -> None:
        payload = base64.b64encode(WAV_HEADER).decode("ascii")
        self.assertEqual(decode_reference_wav(payload), WAV_HEADER)

    def test_decode_reference_wav_rejects_non_wav_payload(self) -> None:
        payload = base64.b64encode(b"this is not audio data").decode("ascii")
        with self.assertRaisesRegex(ValueError, "not a WAV file"):
            decode_reference_wav(payload)

    def test_decode_reference_wav_rejects_truncated_header(self) -> None:
        payload = base64.b64encode(b"RIFF").decode("ascii")
        with self.assertRaisesRegex(ValueError, "not a WAV file"):
            decode_reference_wav(payload)

    def test_decode_reference_wav_rejects_oversized_encoded_payload(self) -> None:
        from chatterbox_registry_volume import MAX_REGISTRY_WAV_BYTES

        payload = "A" * (MAX_REGISTRY_WAV_BYTES * 2 + 4)
        with self.assertRaisesRegex(ValueError, "exceeds size limit"):
            decode_reference_wav(payload)

    def test_voice_name_validation_rejects_trailing_newline(self) -> None:
        from chatterbox_registry_volume import is_valid_voice_name

        self.assertTrue(is_valid_voice_name("ryan"))
        self.assertTrue(is_valid_voice_name("u0123456789ab_0123456789ab"))
        self.assertFalse(is_valid_voice_name("ryan\n"))
        self.assertFalse(is_valid_voice_name("ry an"))
        self.assertFalse(is_valid_voice_name("../ryan"))

    def test_upsert_accepts_bcp47_language_codes(self) -> None:
        for code in ("pt", "en", "pt-BR", "zh-Hans", "es-419"):
            voices = upsert_voice({}, "ryan", code, "ryan/reference.wav")
            self.assertEqual(voices["ryan"]["language_id"], code)

    def test_upsert_rejects_language_with_toml_breaking_characters(self) -> None:
        for bad in ("en\n[injected]", 'en"evil', "e", "english", "en us"):
            with self.assertRaisesRegex(ValueError, "not a valid language code"):
                upsert_voice({}, "ryan", bad, "ryan/reference.wav")

    def test_serialize_escapes_control_characters(self) -> None:
        import tomllib

        voices = {"ryan": {"reference": "ryan/reference.wav", "language_id": "e\nvil"}}
        text = serialize_voices_toml(voices)
        self.assertIn('language_id = "e\\nvil"', text)
        parsed = tomllib.loads(text)
        self.assertEqual(parsed["ryan"]["language_id"], "e\nvil")


if __name__ == "__main__":
    unittest.main()

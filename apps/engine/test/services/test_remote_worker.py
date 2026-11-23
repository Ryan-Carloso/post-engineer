"""Unit tests for app.services.remote_worker (runs inside a Modal CPU container)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services import remote_worker
from chatterbox_registry_volume import load_voices_toml

WAV = b"RIFF\x00\x00\x00\x00WAVEfmt "


class _Clock:
    def __init__(self) -> None:
        self.value = 0.0

    def now(self) -> float:
        return self.value

    def sleep(self, seconds: float) -> None:
        self.value += seconds


class ConfigTests(unittest.TestCase):
    def test_writes_the_config_secret_to_config_toml(self):
        with tempfile.TemporaryDirectory() as root:
            path = remote_worker.write_engine_config(Path(root), {"ENGINE_CONFIG_TOML": "[app]\nx = 1\n"})
            self.assertEqual(path.read_text(encoding="utf-8"), "[app]\nx = 1\n")

    def test_missing_or_blank_config_secret_fails(self):
        with tempfile.TemporaryDirectory() as root:
            for environ in ({}, {"ENGINE_CONFIG_TOML": "  "}):
                with self.subTest(environ=environ), self.assertRaisesRegex(RuntimeError, "ENGINE_CONFIG_TOML"):
                    remote_worker.write_engine_config(Path(root), environ)
            self.assertFalse((Path(root) / "config.toml").exists())

    def test_prepare_points_the_engine_at_the_loopback_tts_once(self):
        with tempfile.TemporaryDirectory() as root:
            environ = {"ENGINE_CONFIG_TOML": "[app]\n"}
            voices = Path(root) / "voices"
            remote_worker.prepare(Path(root), voices, environ)
            secret = environ["CHATTERBOX_HTTP_SECRET"]
            self.assertGreaterEqual(len(secret), 32)
            self.assertEqual(environ["MPT_CHATTERBOX_API_KEY"], secret)
            self.assertEqual(environ["MPT_CHATTERBOX_BASE_URL"], "http://127.0.0.1:4123/v1")
            self.assertEqual(environ["TTS_VOICES_DIR"], str(voices))
            self.assertEqual(environ["MPT_STATE_BACKEND"], "supabase")
            self.assertTrue(voices.is_dir())
            environ["ENGINE_CONFIG_TOML"] = "[changed]\n"
            remote_worker.prepare(Path(root), voices, environ)
            self.assertEqual(environ["CHATTERBOX_HTTP_SECRET"], secret)
            self.assertEqual((Path(root) / "config.toml").read_text(encoding="utf-8"), "[app]\n")


class TtsServerTests(unittest.TestCase):
    def test_command_runs_uvicorn_from_the_tts_virtualenv(self):
        self.assertEqual(
            remote_worker.tts_command({"TTS_PYTHON": "/opt/tts/bin/python"}),
            ["/opt/tts/bin/python", "-m", "uvicorn", "local_tts.server:app", "--host", "127.0.0.1", "--port", "4123"],
        )

    def test_command_without_tts_python_fails(self):
        with self.assertRaisesRegex(RuntimeError, "TTS_PYTHON"):
            remote_worker.tts_command({})

    def test_wait_returns_once_health_answers_with_the_bearer(self):
        clock = _Clock()
        get = MagicMock(side_effect=[OSError("refused"), SimpleNamespace(status_code=200)])
        process = MagicMock()
        process.poll.return_value = None
        remote_worker.wait_for_tts("s3cret", process, get=get, now=clock.now, sleep=clock.sleep)
        self.assertEqual(get.call_count, 2)
        self.assertEqual(get.call_args.kwargs["headers"], {"Authorization": "Bearer s3cret"})

    def test_wait_fails_when_the_server_exits(self):
        process = MagicMock()
        process.poll.return_value = 1
        process.returncode = 1
        clock = _Clock()
        with self.assertRaisesRegex(RuntimeError, "exited with code 1"):
            remote_worker.wait_for_tts("s", process, get=MagicMock(), now=clock.now, sleep=clock.sleep)

    def test_wait_fails_after_the_timeout(self):
        process = MagicMock()
        process.poll.return_value = None
        clock = _Clock()
        get = MagicMock(return_value=SimpleNamespace(status_code=503))
        with self.assertRaisesRegex(RuntimeError, "did not answer within 3s"):
            remote_worker.wait_for_tts("s", process, get=get, now=clock.now, sleep=clock.sleep, timeout=3)
        self.assertEqual(get.call_count, 3)


class CloneVoiceTests(unittest.TestCase):
    def test_clone_key_matches_the_engine_tts_client(self):
        cases = {
            "chatterbox_nano:uabc_def": "uabc_def",
            "chatterbox_nano:uabc_def-Female": "uabc_def",
            "en-US-AriaNeural-Female": None,
            "chatterbox:house": None,
            None: None,
            "chatterbox_nano: ": None,
        }
        for voice, key in cases.items():
            with self.subTest(voice=voice):
                self.assertEqual(remote_worker.clone_voice_key(voice), key)

    def test_stage_registers_the_storage_wav(self):
        store = MagicMock()
        store.get_ready_by_engine_voice_key.return_value = {"storage_path": "u/cloned-voices/c/reference.wav", "language": "pt"}
        store.download_reference_wav.return_value = WAV
        with tempfile.TemporaryDirectory() as root:
            voices = Path(root)
            remote_worker.stage_clone_voice("uabc_def", voices, store)
            self.assertEqual((voices / "uabc_def" / "reference.wav").read_bytes(), WAV)
            self.assertEqual(
                load_voices_toml(voices / "voices.toml")["uabc_def"],
                {"reference": "uabc_def/reference.wav", "language_id": "pt"},
            )
            remote_worker.stage_clone_voice("uabc_def", voices, store)
        store.get_ready_by_engine_voice_key.assert_called_once_with("uabc_def")
        store.download_reference_wav.assert_called_once_with("u/cloned-voices/c/reference.wav")

    def test_stage_without_a_ready_row_fails(self):
        store = MagicMock()
        store.get_ready_by_engine_voice_key.return_value = None
        with tempfile.TemporaryDirectory() as root, self.assertRaisesRegex(RuntimeError, "no ready row"):
            remote_worker.stage_clone_voice("uabc_def", Path(root), store)
        store.download_reference_wav.assert_not_called()


class RunTests(unittest.TestCase):
    def _run(self, voice: str) -> tuple[MagicMock, MagicMock, MagicMock]:
        order = MagicMock()
        payload = {"video_type": "faceless"}
        params = SimpleNamespace(video_type="faceless")
        with patch.object(remote_worker, "prepare", order.prepare), \
                patch.object(remote_worker, "stage_clone_voice", order.stage), \
                patch.object(remote_worker, "ensure_tts_server", order.tts), \
                patch("app.services.cloned_voices.store.ClonedVoiceStore", order.store), \
                patch("app.models.schema.TaskVideoRequest.model_validate", return_value=params) as validate, \
                patch("app.services.task.resolve_persona_audio", return_value=(voice, None)), \
                patch("app.services.task.start", order.start):
            remote_worker.run("t-1", payload, "video", engine_root=Path("/app"), voices_dir=Path("/v"), environ={})
        validate.assert_called_once_with(payload)
        return order, params, order.store

    def test_house_voice_starts_tts_then_the_pipeline(self):
        order, params, _store = self._run("en-US-AriaNeural-Female")
        self.assertEqual(
            [name for name, _args, _kwargs in order.mock_calls],
            ["prepare", "tts", "start"],
        )
        order.start.assert_called_once_with("t-1", params, "video")

    def test_clone_voice_is_staged_before_tts_starts(self):
        order, params, store = self._run("chatterbox_nano:uabc_def")
        self.assertEqual(
            [name for name, _args, _kwargs in order.mock_calls if name in {"prepare", "stage", "tts", "start"}],
            ["prepare", "stage", "tts", "start"],
        )
        order.stage.assert_called_once_with("uabc_def", Path("/v"), store.return_value)
        order.start.assert_called_once_with("t-1", params, "video")


if __name__ == "__main__":
    unittest.main()

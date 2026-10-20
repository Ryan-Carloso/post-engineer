import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.cloned_voices.chatterbox_registry import RegistryNotConfiguredError
from app.services.cloned_voices.constants import (
    ERROR_REGISTRY_NOT_CONFIGURED,
    STATUS_PENDING,
    STATUS_READY,
)
from app.services.cloned_voices.service import (
    ClonedVoiceService,
    list_catalog_entries,
    register_clone_in_background,
)


class ClonedVoiceServiceTests(unittest.TestCase):
    def setUp(self):
        self.store = MagicMock()
        self.registry = MagicMock()
        self.service = ClonedVoiceService(store=self.store, registry=self.registry)

    @patch("app.services.cloned_voices.service.normalize_reference_audio")
    @patch("app.services.cloned_voices.service._track_clone")
    def test_create_from_upload_starts_pending(self, _track, mock_normalize):
        mock_normalize.return_value = MagicMock(wav_bytes=b"wav", duration_seconds=3.0)
        self.store.new_clone_id.return_value = "clone-1"
        self.store.make_engine_voice_key.return_value = "uabc_clone1"
        self.store.storage_path_for.return_value = "user/cloned-voices/clone-1/reference.wav"
        self.store.insert_pending.return_value = {
            "id": "clone-1",
            "status": STATUS_PENDING,
            "engine_voice_key": "uabc_clone1",
        }

        result = self.service.create_from_upload(
            "user-1",
            b"source",
            "en",
            consent_acknowledged=True,
        )

        self.store.upload_reference_wav.assert_called_once()
        self.store.insert_pending.assert_called_once()
        self.assertEqual(result["row"]["status"], STATUS_PENDING)

    @patch("app.services.cloned_voices.service.track_event")
    def test_register_background_marks_ready(self, _track):
        self.store.get_for_user.return_value = {"engine_voice_key": "uabc_clone1"}
        register_clone_in_background(
            "user-1",
            "clone-1",
            b"wav",
            "en",
            store=self.store,
            registry=self.registry,
        )
        self.registry.register_voice.assert_called_once_with("uabc_clone1", "en", b"wav")
        self.store.mark_ready.assert_called_once_with("user-1", "clone-1")

    @patch("app.services.cloned_voices.service.track_event")
    def test_register_background_marks_failed_when_registry_missing(self, _track):
        self.store.get_for_user.return_value = {"engine_voice_key": "uabc_clone1"}
        self.registry.register_voice.side_effect = RegistryNotConfiguredError()
        register_clone_in_background(
            "user-1",
            "clone-1",
            b"wav",
            "en",
            store=self.store,
            registry=self.registry,
        )
        self.store.mark_failed.assert_called_once_with(
            "user-1",
            "clone-1",
            ERROR_REGISTRY_NOT_CONFIGURED,
        )

    def test_delete_removes_registry_storage_and_row(self):
        self.store.get_for_user.return_value = {
            "engine_voice_key": "uabc_clone1",
            "storage_path": "user/cloned-voices/clone-1/reference.wav",
        }
        self.store.delete_row.return_value = True
        self.assertTrue(self.service.delete("user-1", "clone-1"))
        self.registry.delete_voice.assert_called_once_with("uabc_clone1")
        self.store.delete_storage_object.assert_called_once()
        self.store.delete_row.assert_called_once()

    @patch("app.services.cloned_voices.service.chatterbox_tts")
    def test_preview_requires_ready_status(self, mock_tts):
        self.store.get_for_user.return_value = {
            "status": STATUS_PENDING,
            "engine_voice_key": "uabc_clone1",
        }
        from app.services.cloned_voices.audio import ReferenceAudioError

        with self.assertRaises(ReferenceAudioError):
            self.service.preview_mp3("user-1", "clone-1")

        mock_tts.assert_not_called()

    @patch("app.services.cloned_voices.service.chatterbox_tts")
    def test_preview_returns_mp3_bytes(self, mock_tts):
        from app.services.voice_providers import TtsResult

        self.store.get_for_user.return_value = {
            "status": STATUS_READY,
            "engine_voice_key": "uabc_clone1",
            "language": "en-us",
        }
        mock_tts.return_value = TtsResult(sub_maker=MagicMock())

        with patch("builtins.open", unittest.mock.mock_open(read_data=b"mp3-bytes")):
            audio = self.service.preview_mp3("user-1", "clone-1")
        self.assertEqual(audio, b"mp3-bytes")

    def test_delete_returns_false_when_row_missing(self):
        self.store.get_for_user.return_value = None
        self.assertFalse(self.service.delete("user-1", "missing"))

    def test_create_requires_consent(self):
        from app.services.cloned_voices.audio import ReferenceAudioError

        with self.assertRaises(ReferenceAudioError):
            self.service.create_from_upload("user-1", b"x", "en", consent_acknowledged=False)

    def test_list_catalog_entries_maps_ready_rows(self):
        self.store.list_ready_for_user.return_value = [
            {"engine_voice_key": "uabc_clone1"},
            {"engine_voice_key": None},
        ]
        entries = list_catalog_entries("user-1", store=self.store)
        self.assertEqual(entries, [{"id": "chatterbox:uabc_clone1"}])

    @patch("app.services.cloned_voices.service.track_event")
    def test_register_background_noop_when_row_missing(self, _track):
        self.store.get_for_user.return_value = None
        register_clone_in_background(
            "user-1",
            "clone-1",
            b"wav",
            "en",
            store=self.store,
            registry=self.registry,
        )
        self.registry.register_voice.assert_not_called()

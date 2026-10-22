import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.cloned_voices.constants import (
    ERROR_REGISTRY_FAILED,
    STATUS_PENDING,
    STATUS_READY,
)
from app.services.cloned_voices.service import (
    ClonedVoiceService,
    list_catalog_entries,
    reconcile_missing_references,
    reconcile_pending_registrations,
    register_clone_in_background,
)


class ClonedVoiceServiceTests(unittest.TestCase):
    def setUp(self):
        self.store = MagicMock()
        self.registry = MagicMock()
        self.service = ClonedVoiceService(store=self.store, registry=self.registry)

    @patch("app.services.cloned_voices.service.clean_reference_audio")
    @patch("app.services.cloned_voices.service._track_clone")
    def test_create_from_upload_starts_pending(self, _track, mock_clean):
        # Cleaning is the default: the stored reference is the cleaned WAV.
        mock_clean.return_value = MagicMock(wav_bytes=b"wav", duration_seconds=3.0)
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
            name="  My voice  ",
        )

        mock_clean.assert_called_once_with(b"source")
        self.store.upload_reference_wav.assert_called_once()
        self.store.insert_pending.assert_called_once()
        self.assertEqual(
            self.store.insert_pending.call_args.kwargs["name"], "My voice"
        )
        self.assertEqual(result["row"]["status"], STATUS_PENDING)

    @patch("app.services.cloned_voices.service.normalize_reference_audio")
    @patch("app.services.cloned_voices.service._track_clone")
    def test_create_from_upload_without_cleaning_uses_plain_normalize(self, _track, mock_normalize):
        mock_normalize.return_value = MagicMock(wav_bytes=b"wav", duration_seconds=3.0)
        self.store.new_clone_id.return_value = "clone-1"
        self.store.make_engine_voice_key.return_value = "uabc_clone1"
        self.store.storage_path_for.return_value = "user/cloned-voices/clone-1/reference.wav"
        self.store.insert_pending.return_value = {"id": "clone-1", "status": STATUS_PENDING}

        self.service.create_from_upload(
            "user-1",
            b"source",
            "en",
            consent_acknowledged=True,
            use_cleaned=False,
        )

        mock_normalize.assert_called_once_with(b"source")

    @patch("app.services.cloned_voices.service.clean_reference_audio")
    def test_clean_preview_wav_returns_cleaned_bytes(self, mock_clean):
        mock_clean.return_value = MagicMock(wav_bytes=b"clean-wav")
        self.assertEqual(self.service.clean_preview_wav(b"source"), b"clean-wav")
        mock_clean.assert_called_once_with(b"source")

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
    def test_register_background_marks_failed_when_registry_raises(self, _track):
        self.store.get_for_user.return_value = {"engine_voice_key": "uabc_clone1"}
        self.registry.register_voice.side_effect = RuntimeError("disk full")
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
            ERROR_REGISTRY_FAILED,
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

    def test_delete_still_removes_row_when_storage_delete_fails(self):
        self.store.get_for_user.return_value = {
            "engine_voice_key": "uabc_clone1",
            "storage_path": "user/cloned-voices/clone-1/reference.wav",
        }
        self.store.delete_storage_object.return_value = False
        self.store.delete_row.return_value = True
        self.assertTrue(self.service.delete("user-1", "clone-1"))
        self.store.delete_storage_object.assert_called_once_with(
            "user/cloned-voices/clone-1/reference.wav"
        )
        self.store.delete_row.assert_called_once_with("user-1", "clone-1")

    @patch("app.services.cloned_voices.service.clone_tts")
    def test_preview_requires_ready_status(self, mock_tts):
        self.store.get_for_user.return_value = {
            "status": STATUS_PENDING,
            "engine_voice_key": "uabc_clone1",
        }
        from app.services.cloned_voices.audio import ReferenceAudioError

        with self.assertRaises(ReferenceAudioError):
            self.service.preview_mp3("user-1", "clone-1")

        mock_tts.assert_not_called()

    @patch("app.services.cloned_voices.service.clone_tts")
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

    @patch("app.services.cloned_voices.service.track_event")
    def test_register_background_marks_failed_when_mark_ready_raises(self, _track):
        self.store.get_for_user.return_value = {"engine_voice_key": "uabc_clone1"}
        self.store.mark_ready.side_effect = RuntimeError("supabase down")
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
            ERROR_REGISTRY_FAILED,
        )

    @patch("app.services.cloned_voices.service.track_event")
    def test_register_background_never_raises_when_store_fully_down(self, _track):
        self.store.get_for_user.return_value = {"engine_voice_key": "uabc_clone1"}
        self.store.mark_ready.side_effect = RuntimeError("supabase down")
        self.store.mark_failed.side_effect = RuntimeError("supabase down")
        # Must not raise: an escaping exception would strand the row in
        # pending with no signal at all.
        register_clone_in_background(
            "user-1",
            "clone-1",
            b"wav",
            "en",
            store=self.store,
            registry=self.registry,
        )
        self.store.mark_failed.assert_called_once()

    @patch("app.services.cloned_voices.service.track_event")
    def test_reconcile_pending_reregisters_orphaned_rows(self, _track):
        self.store.list_pending.return_value = [
            {
                "id": "clone-1",
                "user_id": "user-1",
                "storage_path": "user-1/cloned-voices/clone-1/reference.wav",
                "engine_voice_key": "uabc_clone1",
                "language": "pt",
            }
        ]
        self.store.download_reference_wav.return_value = b"wav"
        self.store.get_for_user.return_value = {"engine_voice_key": "uabc_clone1"}

        recovered = reconcile_pending_registrations(
            store=self.store, registry=self.registry
        )

        self.assertEqual(recovered, 1)
        self.store.download_reference_wav.assert_called_once_with(
            "user-1/cloned-voices/clone-1/reference.wav"
        )
        self.registry.register_voice.assert_called_once_with("uabc_clone1", "pt", b"wav")
        self.store.mark_ready.assert_called_once_with("user-1", "clone-1")

    @patch("app.services.cloned_voices.service.track_event")
    def test_reconcile_pending_skips_rows_whose_reference_is_gone(self, _track):
        self.store.list_pending.return_value = [
            {
                "id": "clone-1",
                "user_id": "user-1",
                "storage_path": "user-1/cloned-voices/clone-1/reference.wav",
                "engine_voice_key": "uabc_clone1",
                "language": "en",
            }
        ]
        self.store.download_reference_wav.side_effect = RuntimeError("storage 404")

        recovered = reconcile_pending_registrations(
            store=self.store, registry=self.registry
        )

        self.assertEqual(recovered, 0)
        self.registry.register_voice.assert_not_called()

    def test_reconcile_pending_noops_without_supabase_env(self):
        with patch.dict(
            "os.environ", {"SUPABASE_URL": "", "SUPABASE_SERVICE_ROLE_KEY": ""}
        ):
            self.assertEqual(reconcile_pending_registrations(), 0)

    def _ready_row(self):
        return {
            "id": "clone-1",
            "user_id": "user-1",
            "storage_path": "user-1/cloned-voices/clone-1/reference.wav",
            "engine_voice_key": "uabc_clone1",
            "language": "en",
        }

    def test_reconcile_missing_references_restores_lost_files(self):
        self.store.list_ready.return_value = [self._ready_row()]
        self.store.download_reference_wav.return_value = b"wav"
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "uabc_clone1.wav"
            with patch(
                "app.services.cloned_voices.service.reference_path_for",
                return_value=missing,
            ):
                restored = reconcile_missing_references(
                    store=self.store, registry=self.registry
                )
        self.assertEqual(restored, 1)
        self.store.download_reference_wav.assert_called_once_with(
            "user-1/cloned-voices/clone-1/reference.wav"
        )
        self.registry.register_voice.assert_called_once_with("uabc_clone1", "en", b"wav")

    def test_reconcile_missing_references_skips_present_files(self):
        self.store.list_ready.return_value = [self._ready_row()]
        with tempfile.TemporaryDirectory() as tmp:
            present = Path(tmp) / "uabc_clone1.wav"
            present.write_bytes(b"wav")
            with patch(
                "app.services.cloned_voices.service.reference_path_for",
                return_value=present,
            ):
                restored = reconcile_missing_references(
                    store=self.store, registry=self.registry
                )
        self.assertEqual(restored, 0)
        self.store.download_reference_wav.assert_not_called()
        self.registry.register_voice.assert_not_called()

    def test_reconcile_missing_references_survives_download_failure(self):
        self.store.list_ready.return_value = [self._ready_row()]
        self.store.download_reference_wav.side_effect = RuntimeError("storage 404")
        with tempfile.TemporaryDirectory() as tmp:
            with patch(
                "app.services.cloned_voices.service.reference_path_for",
                return_value=Path(tmp) / "uabc_clone1.wav",
            ):
                restored = reconcile_missing_references(
                    store=self.store, registry=self.registry
                )
        self.assertEqual(restored, 0)
        self.registry.register_voice.assert_not_called()

    def test_reconcile_missing_references_noops_without_supabase_env(self):
        with patch.dict(
            "os.environ", {"SUPABASE_URL": "", "SUPABASE_SERVICE_ROLE_KEY": ""}
        ):
            self.assertEqual(reconcile_missing_references(), 0)

    def test_reconcile_missing_references_survives_list_failure(self):
        self.store.list_ready.side_effect = RuntimeError("postgrest down")
        restored = reconcile_missing_references(
            store=self.store, registry=self.registry
        )
        self.assertEqual(restored, 0)

    def test_reconcile_missing_references_skips_malformed_rows(self):
        self.store.list_ready.return_value = [
            {"id": "clone-x", "user_id": "user-1"},  # no key/path
            self._ready_row(),
        ]
        self.store.download_reference_wav.return_value = b"wav"
        with tempfile.TemporaryDirectory() as tmp:
            with patch(
                "app.services.cloned_voices.service.reference_path_for",
                return_value=Path(tmp) / "missing.wav",
            ):
                restored = reconcile_missing_references(
                    store=self.store, registry=self.registry
                )
        self.assertEqual(restored, 1)

    @patch("app.services.cloned_voices.service.normalize_reference_audio")
    @patch("app.services.cloned_voices.service._track_clone")
    def test_create_removes_uploaded_wav_when_insert_fails(self, _track, mock_normalize):
        mock_normalize.return_value = MagicMock(wav_bytes=b"wav", duration_seconds=3.0)
        self.store.new_clone_id.return_value = "clone-1"
        self.store.make_engine_voice_key.return_value = "uabc_clone1"
        self.store.storage_path_for.return_value = "user/cloned-voices/clone-1/reference.wav"
        self.store.insert_pending.side_effect = RuntimeError("insert failed")
        self.store.delete_storage_object.return_value = True

        with self.assertRaises(RuntimeError):
            self.service.create_from_upload(
                "user-1",
                b"source",
                "en",
                consent_acknowledged=True,
                use_cleaned=False,
            )

        self.store.delete_storage_object.assert_called_once_with(
            "user/cloned-voices/clone-1/reference.wav"
        )

"""Unit tests for ClonedVoiceStore helpers and REST wiring."""

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock

from app.services.cloned_voices.store import ClonedVoiceStore


class ClonedVoiceStoreTest(unittest.TestCase):
    def test_make_engine_voice_key(self) -> None:
        user_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        clone_id = "11111111-2222-3333-4444-555555555555"
        key = ClonedVoiceStore.make_engine_voice_key(user_id, clone_id)
        self.assertEqual(key, "ua1b2c3d4e5f6_111111112222")

    def test_storage_path_for(self) -> None:
        path = ClonedVoiceStore.storage_path_for("user-1", "clone-1")
        self.assertEqual(path, "user-1/cloned-voices/clone-1/reference.wav")

    def test_insert_pending_posts_row(self) -> None:
        requests = MagicMock()
        response = MagicMock()
        response.status_code = 201
        response.json.return_value = [{"id": "clone-1", "status": "pending"}]
        response.raise_for_status = MagicMock()
        requests.request.return_value = response
        store = ClonedVoiceStore(
            url="https://supabase.example",
            service_key="service-key",
            requests_module=requests,
        )
        row = store.insert_pending(
            user_id="user-1",
            clone_id="clone-1",
            consent_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            storage_path="user-1/cloned-voices/clone-1/reference.wav",
            engine_voice_key="uabc_def012",
            language="pt",
        )
        self.assertEqual(row["id"], "clone-1")
        requests.request.assert_called_once()
        call = requests.request.call_args
        self.assertEqual(call[0][0], "POST")
        self.assertIn("cloned_voices", call[0][1])

    def test_init_requires_supabase_url(self) -> None:
        with self.assertRaises(RuntimeError) as ctx:
            ClonedVoiceStore(url="", service_key="key", requests_module=MagicMock())
        self.assertIn("SUPABASE_URL", str(ctx.exception))

    def test_get_for_user_returns_none_when_empty(self) -> None:
        requests = MagicMock()
        response = MagicMock()
        response.raise_for_status = MagicMock()
        response.json.return_value = []
        requests.request.return_value = response
        store = ClonedVoiceStore(
            url="https://supabase.example",
            service_key="service-key",
            requests_module=requests,
        )
        self.assertIsNone(store.get_for_user("user-1", "clone-1"))

<<<<<<< HEAD
=======
    def test_upload_reference_wav_posts_to_storage(self) -> None:
        requests = MagicMock()
        response = MagicMock()
        response.status_code = 200
        requests.post.return_value = response
        store = ClonedVoiceStore(
            url="https://supabase.example",
            service_key="service-key",
            requests_module=requests,
        )
        store.upload_reference_wav("user-1/cloned-voices/c1/reference.wav", b"wav")
        requests.post.assert_called_once()
        self.assertIn("/storage/v1/object/", requests.post.call_args[0][0])

    def test_delete_row_returns_true_on_204(self) -> None:
        requests = MagicMock()
        response = MagicMock()
        response.status_code = 204
        requests.request.return_value = response
        store = ClonedVoiceStore(
            url="https://supabase.example",
            service_key="service-key",
            requests_module=requests,
        )
        self.assertTrue(store.delete_row("user-1", "clone-1"))
>>>>>>> a98576e (test(engine): cover cloned voice store upload and delete_row)

if __name__ == "__main__":
    unittest.main()

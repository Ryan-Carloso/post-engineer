"""resolve_existing_media failure paths that end the slot for good."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock

import requests

from app.services.fill_schedule.publish_existing_media import resolve_existing_media

NOW = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)
UPLOAD_ID = "22222222-2222-4222-8222-222222222222"
USER_ID = "user-1"


def _slot(**overrides):
    slot = {
        "id": "slot-1",
        "user_id": USER_ID,
        "status": "ready",
        "media_kind": "upload",
        "media_ref": UPLOAD_ID,
        "schedules": {"id": "sched-1", "user_id": USER_ID},
    }
    slot.update(overrides)
    return slot


def _not_found() -> requests.exceptions.HTTPError:
    error = requests.exceptions.HTTPError("404 Client Error")
    response = requests.models.Response()
    response.status_code = 404
    error.response = response
    return error


class PermanentFailureTests(unittest.TestCase):
    def _resolve(self, store, slot):
        fail = MagicMock()
        self.assertIsNone(resolve_existing_media(store, fail, slot, NOW))
        fail.assert_called_once()
        return fail.call_args[0][0]

    def test_upload_slot_without_an_upload_id_fails_before_any_read(self) -> None:
        store = MagicMock()
        for missing in (None, ""):
            with self.subTest(media_ref=missing):
                reason = self._resolve(store, _slot(media_ref=missing))
                self.assertEqual(reason, "scheduled video upload id is missing")
        store.get_video_upload.assert_not_called()

    def test_upload_row_without_a_storage_path_fails_without_download(self) -> None:
        store = MagicMock()
        store.get_video_upload.return_value = {
            "id": UPLOAD_ID, "user_id": USER_ID, "status": "ready", "storage_path": "",
        }
        reason = self._resolve(store, _slot())
        self.assertEqual(reason, "scheduled video upload has no stored file")
        store.download_storage_object.assert_not_called()
        store.claim_video_upload.assert_not_called()

    def test_image_slot_whose_object_is_gone_fails_without_retry(self) -> None:
        store = MagicMock()
        store.download_storage_object.side_effect = _not_found()
        slot = _slot(
            media_kind="image",
            media_ref=f"scheduled-media/{USER_ID}/a.png",
            media_content_type="image/png",
        )
        reason = self._resolve(store, slot)
        self.assertEqual(reason, "scheduled image file is gone")
        self.assertFalse(
            any("publish_not_before" in call.kwargs for call in store.update_slot.call_args_list)
        )


if __name__ == "__main__":
    unittest.main()

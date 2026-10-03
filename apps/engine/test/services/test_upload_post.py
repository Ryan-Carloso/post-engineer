import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, mock_open, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.upload_post import UploadPostService


_CONFIG_BASE = {
    "upload_post_enabled": True,
    "upload_post_api_key": "test-key",
    "upload_post_username": "testuser",
    "upload_post_platforms": ["tiktok", "instagram", "youtube"],
    "upload_post_auto_upload": True,
    "upload_post_youtube_privacy_status": "unlisted",
}


def _mock_response(success=True):
    r = MagicMock()
    r.json.return_value = {"success": success, "request_id": "abc123"}
    r.raise_for_status = MagicMock()
    return r


def _get(data, key):
    for k, v in data:
        if k == key:
            return v
    return None


def _get_all(data, key):
    return [v for k, v in data if k == key]


def _has_key(data, key):
    return any(k == key for k, v in data)


class TestUploadPostYouTube(unittest.TestCase):

    @patch("app.services.upload_post.config.app", _CONFIG_BASE)
    @patch("app.services.upload_post.os.path.exists", return_value=True)
    @patch("builtins.open", mock_open(read_data=b"fake"))
    @patch("app.services.upload_post.requests.post")
    def test_youtube_fields_en_payload(self, mock_post, _exists):
        mock_post.return_value = _mock_response()
        svc = UploadPostService()

        svc.upload_video("/fake/v.mp4", "Título", youtube_extra={
            "youtube_title": "Mi Short",
            "youtube_description": "Descripción",
            "tags": ["ia", "shorts"],
            "privacyStatus": "unlisted",
        })

        data = mock_post.call_args[1]["data"]
        self.assertEqual(_get(data, "youtube_title"), "Mi Short")
        self.assertEqual(_get(data, "youtube_description"), "Descripción")
        self.assertEqual(_get_all(data, "tags[]"), ["ia", "shorts"])
        self.assertEqual(_get(data, "privacyStatus"), "unlisted")
        self.assertEqual(_get(data, "containsSyntheticMedia"), "true")

    @patch("app.services.upload_post.config.app", _CONFIG_BASE)
    @patch("app.services.upload_post.os.path.exists", return_value=True)
    @patch("builtins.open", mock_open(read_data=b"fake"))
    @patch("app.services.upload_post.requests.post")
    def test_contains_synthetic_media_siempre_true(self, mock_post, _exists):
        mock_post.return_value = _mock_response()
        svc = UploadPostService()

        svc.upload_video("/fake/v.mp4", "T", youtube_extra={"containsSyntheticMedia": False})

        data = mock_post.call_args[1]["data"]
        self.assertEqual(_get(data, "containsSyntheticMedia"), "true")

    @patch("app.services.upload_post.config.app", {
        **_CONFIG_BASE,
        "upload_post_platforms": ["tiktok", "instagram"],
    })
    @patch("app.services.upload_post.os.path.exists", return_value=True)
    @patch("builtins.open", mock_open(read_data=b"fake"))
    @patch("app.services.upload_post.requests.post")
    def test_tiktok_instagram_sin_youtube_fields(self, mock_post, _exists):
        mock_post.return_value = _mock_response()
        svc = UploadPostService()
        svc.upload_video("/fake/v.mp4", "T")

        data = mock_post.call_args[1]["data"]
        self.assertFalse(_has_key(data, "youtube_title"))
        self.assertFalse(_has_key(data, "containsSyntheticMedia"))
        self.assertFalse(_has_key(data, "privacyStatus"))

    @patch("app.services.upload_post.config.app", {
        **_CONFIG_BASE,
        "upload_post_platforms": ["tiktok"],
    })
    @patch("app.services.upload_post.os.path.exists", return_value=True)
    @patch("builtins.open", mock_open(read_data=b"fake"))
    @patch("app.services.upload_post.requests.post")
    def test_youtube_extra_ignorado_si_youtube_no_en_platforms(self, mock_post, _exists):
        mock_post.return_value = _mock_response()
        svc = UploadPostService()
        svc.upload_video("/fake/v.mp4", "T", youtube_extra={"youtube_title": "irrelevante"})

        data = mock_post.call_args[1]["data"]
        self.assertFalse(_has_key(data, "youtube_title"))

    @patch("app.services.upload_post.config.app", _CONFIG_BASE)
    @patch("app.services.upload_post.os.path.exists", return_value=True)
    @patch("builtins.open", mock_open(read_data=b"fake"))
    @patch("app.services.upload_post.requests.post")
    def test_endpoint_y_platform_format_correcto(self, mock_post, _exists):
        mock_post.return_value = _mock_response()
        svc = UploadPostService()
        svc.upload_video("/fake/v.mp4", "T")

        call_url = mock_post.call_args[0][0]
        self.assertTrue(call_url.endswith("/api/upload"), f"Endpoint incorrecto: {call_url}")

        data = mock_post.call_args[1]["data"]
        platforms = _get_all(data, "platform[]")
        self.assertIn("tiktok", platforms)
        self.assertIn("instagram", platforms)
        self.assertIn("youtube", platforms)


class TestUploadPostErrorScrubbing(unittest.TestCase):
    # The failure error dicts are persisted into client-visible task state
    # (cross_post_results), so they get the scrub treatment like every
    # other free-text error surface.

    @patch("app.services.upload_post.config.app", _CONFIG_BASE)
    @patch("app.services.upload_post.os.path.exists", return_value=True)
    @patch("builtins.open", mock_open(read_data=b"fake"))
    @patch("app.services.upload_post.requests.post")
    def test_upload_failure_error_is_scrubbed(self, mock_post, _exists):
        import requests

        mock_post.side_effect = requests.exceptions.RequestException(
            "E" * 450 + " api_key=TOPSECRET123 " + "F" * 200
        )
        svc = UploadPostService()
        result = svc.upload_video("/fake/v.mp4", "Title")
        self.assertFalse(result["success"])
        self.assertIn("[redacted]", result["error"])
        self.assertNotIn("TOPSECRET123", result["error"])
        self.assertLessEqual(len(result["error"]), 500)

    @patch("app.services.upload_post.config.app", _CONFIG_BASE)
    @patch("app.services.upload_post.requests.get")
    def test_check_status_failure_error_is_scrubbed(self, mock_get):
        import requests

        mock_get.side_effect = requests.exceptions.RequestException(
            "E" * 450 + " api_key=TOPSECRET123 " + "F" * 200
        )
        svc = UploadPostService()
        result = svc.check_status("req-1")
        self.assertFalse(result["success"])
        self.assertIn("[redacted]", result["error"])
        self.assertNotIn("TOPSECRET123", result["error"])
        self.assertLessEqual(len(result["error"]), 500)


    # The ERROR log lines sit one line above the scrubbed dicts: they go to
    # the loguru ERROR+ sink, so they get the same scrub treatment.
    @patch("app.services.upload_post.config.app", _CONFIG_BASE)
    @patch("app.services.upload_post.os.path.exists", return_value=True)
    @patch("builtins.open", mock_open(read_data=b"fake"))
    @patch("app.services.upload_post.requests.post")
    def test_upload_failure_log_line_is_scrubbed(self, mock_post, _exists):
        import requests

        from app.services import upload_post as up_module

        mock_post.side_effect = requests.exceptions.RequestException(
            "connection failed: api_key=TOPSECRET123"
        )
        svc = UploadPostService()
        with patch.object(up_module, "logger") as mock_logger:
            svc.upload_video("/fake/v.mp4", "Title")
        logged = " ".join(str(c) for c in mock_logger.error.call_args_list)
        self.assertIn("[redacted]", logged)
        self.assertNotIn("TOPSECRET123", logged)

    @patch("app.services.upload_post.config.app", _CONFIG_BASE)
    @patch("app.services.upload_post.requests.get")
    def test_check_status_failure_log_line_is_scrubbed(self, mock_get):
        import requests

        from app.services import upload_post as up_module

        mock_get.side_effect = requests.exceptions.RequestException(
            "timeout: api_key=TOPSECRET123"
        )
        svc = UploadPostService()
        with patch.object(up_module, "logger") as mock_logger:
            svc.check_status("req-1")
        logged = " ".join(str(c) for c in mock_logger.error.call_args_list)
        self.assertIn("[redacted]", logged)
        self.assertNotIn("TOPSECRET123", logged)


if __name__ == "__main__":
    unittest.main()

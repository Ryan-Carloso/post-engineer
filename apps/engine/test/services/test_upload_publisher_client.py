"""HTTP client tests for the internal upload publisher.

Uses a real local HTTP server as the mock boundary so the tests verify the
actual wire behaviour: auth header, multipart fields, error mapping, retry and
timeout handling.
"""

from __future__ import annotations

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

from app.services import upload_publisher


def _youtube_metadata() -> upload_publisher.YouTubeMetadata:
    return upload_publisher.YouTubeMetadata(
        title="My title",
        description="My description",
        tags=["one", "two"],
        privacy_status="public",
        account_ids=["acc_1"],
    )


class _MockHandler(BaseHTTPRequestHandler):
    """Programmable mock for POST /api/upload-content."""

    responses: list[tuple[int, dict[str, Any]]] = []
    requests: list[dict[str, Any]] = []

    def do_POST(self) -> None:  # noqa: N802
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)
        type(self).requests.append(
            {
                "path": self.path,
                "authorization": self.headers.get("Authorization"),
                "x_api_key": self.headers.get("X-API-Key"),
                "content_type": self.headers.get("Content-Type"),
                "body": body,
            }
        )
        status, payload = type(self).responses.pop(0)
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args: object) -> None:
        pass


class PublishVideoClientTest(unittest.TestCase):
    def setUp(self) -> None:
        self.server = HTTPServer(("127.0.0.1", 0), _MockHandler)
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        _MockHandler.responses = []
        _MockHandler.requests = []

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def test_publish_video_success_sends_contract(self) -> None:
        _MockHandler.responses.append(
            (200, {"success": True, "results": [{"accountId": "acc_1"}]})
        )
        result = upload_publisher.publish_video(
            base_url=self.base_url,
            api_secret="secret-key",
            owner_user_id="user-1",
            metadata=_youtube_metadata(),
            video_path="final.mp4",
            video_bytes=b"mp4-bytes",
            content_type="video/mp4",
            timeout_seconds=5,
            sleep=lambda seconds: None,
        )
        request = _MockHandler.requests[0]
        self.assertEqual(request["path"], "/api/upload-content")
        self.assertEqual(request["authorization"], "Bearer secret-key")
        self.assertIsNone(request["x_api_key"])
        self.assertIn("multipart/form-data", request["content_type"])
        self.assertIn(b"My title", request["body"])
        self.assertIn(b"accountIds", request["body"])
        self.assertIn(b'filename="final.mp4"', request["body"])
        self.assertIn(b'Content-Type: video/mp4', request["body"])
        self.assertIn(b'name="video"', request["body"])
        self.assertIn(b"mp4-bytes", request["body"])
        self.assertEqual(result["success"], True)

    def test_publish_video_strips_trailing_slash_from_base_url(self) -> None:
        _MockHandler.responses.append((200, {"success": True}))
        upload_publisher.publish_video(
            base_url=f"{self.base_url}/",
            api_secret="k",
            owner_user_id="user-1",
            metadata=_youtube_metadata(),
            video_path="final.mp4",
            video_bytes=b"mp4-bytes",
            content_type="video/mp4",
            timeout_seconds=5,
            sleep=lambda seconds: None,
        )
        self.assertEqual(_MockHandler.requests[0]["path"], "/api/upload-content")

    def test_publish_video_sends_owner_user_id_field(self) -> None:
        _MockHandler.responses.append((200, {"success": True}))
        upload_publisher.publish_video(
            base_url=self.base_url,
            api_secret="secret-key",
            owner_user_id="user-1",
            metadata=_youtube_metadata(),
            video_path="final.mp4",
            video_bytes=b"mp4-bytes",
            content_type="video/mp4",
            timeout_seconds=5,
            sleep=lambda seconds: None,
        )
        request = _MockHandler.requests[0]
        self.assertEqual(request["authorization"], "Bearer secret-key")
        self.assertIn(b'name="userId"', request["body"])
        self.assertIn(b"user-1", request["body"])

    def test_publish_video_sends_publish_scope_key(self) -> None:
        _MockHandler.responses.append((200, {"success": True}))
        upload_publisher.publish_video(
            base_url=self.base_url,
            api_secret="secret-key",
            owner_user_id="user-1",
            metadata=_youtube_metadata(),
            video_path="final.mp4",
            video_bytes=b"mp4-bytes",
            content_type="video/mp4",
            timeout_seconds=5,
            sleep=lambda seconds: None,
            publish_scope_key="slot:slot-1:video:final.mp4",
        )
        request = _MockHandler.requests[0]
        self.assertIn(b'name="publishScopeKey"', request["body"])
        self.assertIn(b"slot:slot-1:video:final.mp4", request["body"])

    def test_publish_video_omits_publish_scope_key_when_absent(self) -> None:
        _MockHandler.responses.append((200, {"success": True}))
        upload_publisher.publish_video(
            base_url=self.base_url,
            api_secret="secret-key",
            owner_user_id="user-1",
            metadata=_youtube_metadata(),
            video_path="final.mp4",
            video_bytes=b"mp4-bytes",
            content_type="video/mp4",
            timeout_seconds=5,
            sleep=lambda seconds: None,
        )
        self.assertNotIn(b"publishScopeKey", _MockHandler.requests[0]["body"])

    def test_publish_video_raises_on_client_error(self) -> None:
        _MockHandler.responses.append((401, {"success": False, "error": "Invalid API key."}))
        with self.assertRaises(upload_publisher.PublishError) as caught:
            upload_publisher.publish_video(
                base_url=self.base_url,
                api_secret="bad",
            owner_user_id="user-1",
                metadata=_youtube_metadata(),
                video_path="final.mp4",
                video_bytes=b"mp4-bytes",
                content_type="video/mp4",
                timeout_seconds=5,
                sleep=lambda seconds: None,
            )
        self.assertEqual(caught.exception.status_code, 401)
        self.assertNotIn("Invalid API key.", str(caught.exception))
        self.assertIn("Invalid API key.", caught.exception.response_body or "")

    def test_publish_video_retries_transient_errors(self) -> None:
        _MockHandler.responses.append((503, {"success": False, "error": "unavailable"}))
        _MockHandler.responses.append((429, {"success": False, "error": "rate limited"}))
        _MockHandler.responses.append((200, {"success": True}))
        sleeps: list[float] = []
        result = upload_publisher.publish_video(
            base_url=self.base_url,
            api_secret="k",
            owner_user_id="user-1",
            metadata=_youtube_metadata(),
            video_path="final.mp4",
            video_bytes=b"mp4-bytes",
            content_type="video/mp4",
            timeout_seconds=5,
            sleep=sleeps.append,
        )
        self.assertEqual(result["success"], True)
        self.assertEqual(len(_MockHandler.requests), 3)
        self.assertEqual(sleeps, [1, 2])

    def test_publish_video_does_not_retry_permanent_errors(self) -> None:
        _MockHandler.responses.append((403, {"success": False, "error": "forbidden"}))
        with self.assertRaises(upload_publisher.PublishError):
            upload_publisher.publish_video(
                base_url=self.base_url,
                api_secret="k",
            owner_user_id="user-1",
                metadata=_youtube_metadata(),
                video_path="final.mp4",
                video_bytes=b"mp4-bytes",
                content_type="video/mp4",
                timeout_seconds=5,
                sleep=lambda seconds: None,
            )
        self.assertEqual(len(_MockHandler.requests), 1)

    def test_publish_video_exhausts_retries(self) -> None:
        for _ in range(4):
            _MockHandler.responses.append((503, {"success": False, "error": "down"}))
        with self.assertRaises(upload_publisher.PublishError) as caught:
            upload_publisher.publish_video(
                base_url=self.base_url,
                api_secret="k",
            owner_user_id="user-1",
                metadata=_youtube_metadata(),
                video_path="final.mp4",
                video_bytes=b"mp4-bytes",
                content_type="video/mp4",
                timeout_seconds=5,
                max_attempts=3,
                sleep=lambda seconds: None,
            )
        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(len(_MockHandler.requests), 3)

    def test_publish_video_times_out_against_slow_server(self) -> None:
        class SlowHandler(_MockHandler):
            def do_POST(self) -> None:  # noqa: N802
                import time as time_module

                time_module.sleep(2)
                self.send_response(200)
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"{}")

        slow_server = HTTPServer(("127.0.0.1", 0), SlowHandler)
        threading.Thread(target=slow_server.serve_forever, daemon=True).start()
        try:
            with self.assertRaises(upload_publisher.PublishError) as caught:
                upload_publisher.publish_video(
                    base_url=f"http://127.0.0.1:{slow_server.server_port}",
                    api_secret="k",
            owner_user_id="user-1",
                    metadata=_youtube_metadata(),
                    video_path="final.mp4",
                    video_bytes=b"mp4-bytes",
                    content_type="video/mp4",
                    timeout_seconds=1,
                    max_attempts=1,
                    sleep=lambda seconds: None,
                )
            self.assertIn("failed", str(caught.exception))
        finally:
            slow_server.shutdown()
            slow_server.server_close()

    def test_publish_video_treats_300_as_error(self) -> None:
        _MockHandler.responses.append((300, {"success": False, "error": "ambiguous"}))
        with self.assertRaises(upload_publisher.PublishError) as caught:
            upload_publisher.publish_video(
                base_url=self.base_url,
                api_secret="k",
            owner_user_id="user-1",
                metadata=_youtube_metadata(),
                video_path="final.mp4",
                video_bytes=b"mp4-bytes",
                content_type="video/mp4",
                timeout_seconds=5,
                sleep=lambda seconds: None,
            )
        self.assertEqual(caught.exception.status_code, 300)

    def test_publish_video_fails_fast_without_attempts(self) -> None:
        with self.assertRaises(upload_publisher.PublishError) as caught:
            upload_publisher.publish_video(
                base_url=self.base_url,
                api_secret="k",
            owner_user_id="user-1",
                metadata=_youtube_metadata(),
                video_path="final.mp4",
                video_bytes=b"mp4-bytes",
                content_type="video/mp4",
                timeout_seconds=5,
                max_attempts=0,
                sleep=lambda seconds: None,
            )
        self.assertEqual(str(caught.exception), "upload failed")

    def test_publish_video_retries_connection_errors_with_backoff(self) -> None:
        class FlakyHandler(_MockHandler):
            def do_POST(self) -> None:  # noqa: N802
                self.rfile.read(int(self.headers.get("Content-Length", 0)))
                type(self).requests.append({"path": self.path})
                if len(type(self).requests) < 3:
                    self.wfile.close()
                    return
                body = b'{"success": true}'
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        flaky_server = HTTPServer(("127.0.0.1", 0), FlakyHandler)
        threading.Thread(target=flaky_server.serve_forever, daemon=True).start()
        sleeps: list[float] = []
        try:
            result = upload_publisher.publish_video(
                base_url=f"http://127.0.0.1:{flaky_server.server_port}",
                api_secret="k",
            owner_user_id="user-1",
                metadata=_youtube_metadata(),
                video_path="final.mp4",
                video_bytes=b"mp4-bytes",
                content_type="video/mp4",
                timeout_seconds=5,
                sleep=sleeps.append,
            )
        finally:
            flaky_server.shutdown()
            flaky_server.server_close()
        self.assertEqual(result["success"], True)
        self.assertEqual(len(_MockHandler.requests), 3)
        self.assertEqual(sleeps, [1, 2])

    def test_publish_video_raises_on_invalid_json_success(self) -> None:
        _MockHandler.responses.append((200, {"success": True}))
        _MockHandler.responses.pop()

        class RawHandler(_MockHandler):
            def do_POST(self) -> None:  # noqa: N802
                self.rfile.read(int(self.headers.get("Content-Length", 0)))
                type(self).requests.append({"path": self.path})
                body = b"this is not json"
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        raw_server = HTTPServer(("127.0.0.1", 0), RawHandler)
        RawHandler.requests = []
        threading.Thread(target=raw_server.serve_forever, daemon=True).start()
        try:
            with self.assertRaises(upload_publisher.PublishError) as caught:
                upload_publisher.publish_video(
                    base_url=f"http://127.0.0.1:{raw_server.server_port}",
                    api_secret="k",
            owner_user_id="user-1",
                    metadata=_youtube_metadata(),
                    video_path="final.mp4",
                    video_bytes=b"mp4-bytes",
                    content_type="video/mp4",
                    timeout_seconds=5,
                    sleep=lambda seconds: None,
                )
        finally:
            raw_server.shutdown()
            raw_server.server_close()
        self.assertEqual(str(caught.exception), "upload API returned invalid JSON")

    def test_publish_video_keeps_error_body_out_of_message(self) -> None:
        long_error = "x" * 600
        _MockHandler.responses.append((400, {"success": False, "error": long_error}))
        with self.assertRaises(upload_publisher.PublishError) as caught:
            upload_publisher.publish_video(
                base_url=self.base_url,
                api_secret="k",
            owner_user_id="user-1",
                metadata=_youtube_metadata(),
                video_path="final.mp4",
                video_bytes=b"mp4-bytes",
                content_type="video/mp4",
                timeout_seconds=5,
                sleep=lambda seconds: None,
            )
        exc = caught.exception
        self.assertEqual(str(exc), "upload API returned HTTP 400")
        self.assertEqual(exc.status_code, 400)
        self.assertNotIn("x" * 10, str(exc))
        self.assertEqual(len(exc.response_body or ""), 500)

    def test_publish_video_raises_on_http_200_success_false(self) -> None:
        secret = "SECRET-UPSTREAM-BODY"
        _MockHandler.responses.append(
            (200, {"success": False, "error": secret, "errorType": "CustomErrorType"})
        )
        sleeps: list[float] = []
        with self.assertRaises(upload_publisher.PublishError) as caught:
            upload_publisher.publish_video(
                base_url=self.base_url,
                api_secret="k",
                owner_user_id="user-1",
                metadata=_youtube_metadata(),
                video_path="final.mp4",
                video_bytes=b"mp4-bytes",
                content_type="video/mp4",
                timeout_seconds=5,
                sleep=sleeps.append,
            )
        exc = caught.exception
        self.assertEqual(str(exc), "upload API reported failure")
        self.assertEqual(exc.status_code, 200)
        self.assertNotIn(secret, str(exc))
        self.assertNotIn("CustomErrorType", str(exc))
        self.assertIn(secret, exc.response_body or "")
        self.assertEqual(len(_MockHandler.requests), 1)
        self.assertEqual(sleeps, [])

    def test_publish_video_raises_when_every_account_result_failed(self) -> None:
        secret = "ACCOUNT-SECRET"
        _MockHandler.responses.append(
            (
                200,
                {
                    "success": True,
                    "results": [
                        {"accountId": "a", "success": False, "error": secret},
                        {"accountId": "b", "success": False, "error": secret},
                    ],
                },
            )
        )
        with self.assertRaises(upload_publisher.PublishError) as caught:
            upload_publisher.publish_video(
                base_url=self.base_url,
                api_secret="k",
                owner_user_id="user-1",
                metadata=_youtube_metadata(),
                video_path="final.mp4",
                video_bytes=b"mp4-bytes",
                content_type="video/mp4",
                timeout_seconds=5,
                sleep=lambda seconds: None,
            )
        self.assertEqual(str(caught.exception), "upload API reported failure for every account")
        self.assertNotIn(secret, str(caught.exception))
        self.assertIn(secret, caught.exception.response_body or "")

    def test_publish_video_accepts_partial_account_success(self) -> None:
        _MockHandler.responses.append(
            (
                200,
                {
                    "success": True,
                    "results": [
                        {"accountId": "a", "success": False, "error": "nope"},
                        {"accountId": "b", "success": True, "videoId": "yt-1"},
                    ],
                },
            )
        )
        result = upload_publisher.publish_video(
            base_url=self.base_url,
            api_secret="k",
            owner_user_id="user-1",
            metadata=_youtube_metadata(),
            video_path="final.mp4",
            video_bytes=b"mp4-bytes",
            content_type="video/mp4",
            timeout_seconds=5,
            sleep=lambda seconds: None,
        )
        self.assertEqual(result["success"], True)
        self.assertEqual(result["results"][1]["videoId"], "yt-1")

    def test_publish_video_accepts_empty_account_results(self) -> None:
        _MockHandler.responses.append((200, {"success": True, "results": []}))
        result = upload_publisher.publish_video(
            base_url=self.base_url,
            api_secret="k",
            owner_user_id="user-1",
            metadata=_youtube_metadata(),
            video_path="final.mp4",
            video_bytes=b"mp4-bytes",
            content_type="video/mp4",
            timeout_seconds=5,
            sleep=lambda seconds: None,
        )
        self.assertEqual(result["success"], True)
        self.assertEqual(result["results"], [])

    def test_publish_video_instagram_contract(self) -> None:
        _MockHandler.responses.append((200, {"success": True}))
        upload_publisher.publish_video(
            base_url=self.base_url,
            api_secret="k",
            owner_user_id="user-1",
            metadata=upload_publisher.InstagramMetadata(
                caption="cap",
                account_ids=["ig_1"],
            ),
            video_path="final.mp4",
            video_bytes=b"mp4-bytes",
            content_type="video/mp4",
            timeout_seconds=5,
            sleep=lambda seconds: None,
        )
        body = _MockHandler.requests[0]["body"]
        self.assertIn(b'name="provider"\r\n\r\ninstagram', body)
        self.assertIn(b'name="caption"\r\n\r\ncap', body)
        self.assertIn(b'name="igAccountIds"', body)
        self.assertIn(b'name="file"', body)

    def test_publish_video_instagram_archive_sends_path_without_bytes(self) -> None:
        _MockHandler.responses.append((200, {"success": True, "results": [{"accountId": "ig_1", "success": True}]}))
        result = upload_publisher.publish_video(
            base_url=self.base_url,
            api_secret="k",
            owner_user_id="user-1",
            metadata=upload_publisher.InstagramMetadata(caption="cap", account_ids=["ig_1"]),
            video_path="final.mp4",
            video_bytes=None,
            content_type="video/mp4",
            timeout_seconds=5,
            sleep=lambda seconds: None,
            publish_scope_key="slot:slot-1:video:final.mp4",
            r2_object_path="user-1/faceless/task-7/final-1.mp4",
        )
        self.assertTrue(result["success"])
        body = _MockHandler.requests[0]["body"]
        self.assertIn(b"videoStoragePath=user-1%2Ffaceless%2Ftask-7%2Ffinal-1.mp4", body)
        self.assertNotIn(b"filename=", body)
        self.assertNotIn(b"mp4-bytes", body)

    def test_publish_video_threads_archive_sends_path_without_bytes(self) -> None:
        _MockHandler.responses.append((200, {"success": True, "results": [{"accountId": "tt_1", "success": True}]}))
        upload_publisher.publish_video(
            base_url=self.base_url,
            api_secret="k",
            owner_user_id="user-1",
            metadata=upload_publisher.ThreadsMetadata(caption="cap", account_ids=["tt_1"]),
            video_path="final.mp4",
            video_bytes=None,
            content_type="video/mp4",
            timeout_seconds=5,
            sleep=lambda seconds: None,
            r2_object_path="user-1/faceless/task-7/final-1.mp4",
        )
        body = _MockHandler.requests[0]["body"]
        self.assertIn(b"videoStoragePath=user-1%2Ffaceless%2Ftask-7%2Ffinal-1.mp4", body)
        self.assertNotIn(b"filename=", body)

    def test_publish_video_youtube_ignores_archive_and_requires_bytes(self) -> None:
        _MockHandler.responses.append((200, {"success": True}))
        with self.assertRaises(upload_publisher.PublishError) as caught:
            upload_publisher.publish_video(
                base_url=self.base_url,
                api_secret="k",
                owner_user_id="user-1",
                metadata=_youtube_metadata(),
                video_path="final.mp4",
                video_bytes=None,
                content_type="video/mp4",
                timeout_seconds=5,
                sleep=lambda seconds: None,
                r2_object_path="user-1/faceless/task-7/final-1.mp4",
            )
        self.assertIn("bytes", str(caught.exception))
        self.assertEqual(_MockHandler.requests, [])

    def test_publish_video_youtube_sends_bytes_even_when_archive_given(self) -> None:
        _MockHandler.responses.append((200, {"success": True}))
        upload_publisher.publish_video(
            base_url=self.base_url,
            api_secret="k",
            owner_user_id="user-1",
            metadata=_youtube_metadata(),
            video_path="final.mp4",
            video_bytes=b"mp4-bytes",
            content_type="video/mp4",
            timeout_seconds=5,
            sleep=lambda seconds: None,
            r2_object_path="user-1/faceless/task-7/final-1.mp4",
        )
        body = _MockHandler.requests[0]["body"]
        self.assertIn(b'filename="final.mp4"', body)
        self.assertIn(b"mp4-bytes", body)
        self.assertNotIn(b"videoStoragePath", body)


if __name__ == "__main__":
    unittest.main()

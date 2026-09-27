import os
import unittest
from unittest import mock

from fastapi import Request

from app.controllers.base import verify_token


def _request(headers: dict[str, str]) -> Request:
    return Request({"type": "http", "headers": [(k.encode(), v.encode()) for k, v in headers.items()]})


SECRET = "test-shared-secret"


class SharedSecretAuthentication(unittest.TestCase):
    def setUp(self) -> None:
        os.environ["MONEYPRINT_API_SECRET"] = SECRET

    def tearDown(self) -> None:
        os.environ.pop("MONEYPRINT_API_SECRET", None)

    def test_valid_secret_and_user_header_returns_user(self):
        context = verify_token(
            _request({"authorization": f"Bearer {SECRET}", "x-user-id": "user-uuid-1"})
        )
        self.assertEqual(context.user_id, "user-uuid-1")
        self.assertEqual(context.auth_type, "shared-secret")

    def test_missing_bearer_is_rejected(self):
        with self.assertRaises(Exception):
            verify_token(_request({"x-user-id": "user-1"}))

    def test_wrong_secret_is_rejected(self):
        with self.assertRaises(Exception):
            verify_token(
                _request({"authorization": "Bearer other-secret", "x-user-id": "user-1"})
            )

    def test_missing_user_id_header_is_rejected(self):
        with self.assertRaises(Exception):
            verify_token(_request({"authorization": f"Bearer {SECRET}"}))

    def test_legacy_x_api_key_headers_are_rejected(self):
        with self.assertRaises(Exception):
            verify_token(_request({"x-api-key": "key-1", "x-user-id": "user-1"}))

    def test_unconfigured_secret_fails_explicitly(self):
        with mock.patch.dict(os.environ, clear=False):
            os.environ.pop("MONEYPRINT_API_SECRET", None)
            with self.assertRaises(RuntimeError):
                verify_token(
                    _request({"authorization": f"Bearer {SECRET}", "x-user-id": "user-1"})
                )


if __name__ == "__main__":
    unittest.main()

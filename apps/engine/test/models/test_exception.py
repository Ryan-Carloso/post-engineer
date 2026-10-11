"""Tests for app.models.exception.HttpException structured logging.

HttpException logs itself on construction; it must bind the task id and
status code via loguru so the PostHog sink can forward them as filterable
event properties (instead of a flat, unsearchable message string).
"""

import unittest
from unittest.mock import patch

from app.models.exception import HttpException


class HttpExceptionLoggingTests(unittest.TestCase):
    def test_binds_task_id_and_status_code(self):
        with patch("app.models.exception.logger") as mock_logger:
            HttpException(task_id="task-1", status_code=404, message="nope")
        mock_logger.bind.assert_called_once_with(
            task_id="task-1", http_status_code=404
        )

    def test_binds_generation_id_when_provided(self):
        with patch("app.models.exception.logger") as mock_logger:
            HttpException(
                task_id="task-1",
                status_code=404,
                message="nope",
                generation_id="gen-abc-123",
            )
        mock_logger.bind.assert_called_once_with(
            task_id="task-1", http_status_code=404, generation_id="gen-abc-123"
        )

    def test_omits_generation_id_when_not_provided(self):
        with patch("app.models.exception.logger") as mock_logger:
            HttpException(task_id="task-1", status_code=404, message="nope")
        mock_logger.bind.assert_called_once_with(
            task_id="task-1", http_status_code=404
        )

    def test_4xx_logs_at_warning_level(self):
        with patch("app.models.exception.logger") as mock_logger:
            HttpException(task_id="task-1", status_code=404, message="nope")
        bound = mock_logger.bind.return_value
        # depth=1 attributes the record to the raise site, not __init__,
        # so the PostHog sink groups flat logs by where they were raised.
        bound.opt.assert_called_once_with(depth=1)
        bound.opt.return_value.warning.assert_called_once()
        bound.opt.return_value.error.assert_not_called()

    def test_5xx_logs_at_error_level(self):
        with patch("app.models.exception.logger") as mock_logger:
            HttpException(task_id="task-1", status_code=500, message="boom")
        bound = mock_logger.bind.return_value
        bound.opt.assert_called_once_with(depth=1)
        bound.opt.return_value.error.assert_called_once()
        bound.opt.return_value.warning.assert_not_called()

    def test_400_logs_at_warning_level(self):
        with patch("app.models.exception.logger") as mock_logger:
            HttpException(task_id="task-1", status_code=400, message="bad")
        bound = mock_logger.bind.return_value
        bound.opt.assert_called_once_with(depth=1)
        bound.opt.return_value.warning.assert_called_once()
        bound.opt.return_value.error.assert_not_called()

    def test_task_id_stored_as_attribute(self):
        with patch("app.models.exception.logger"):
            exc = HttpException(task_id="task-1", status_code=500, message="x")
        assert exc.task_id == "task-1"
        assert exc.status_code == 500

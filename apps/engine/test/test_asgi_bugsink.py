"""Tests for the loguru -> PostHog bridge in app.asgi.

app.asgi installs a loguru sink that forwards ERROR+ records to PostHog
as $exception events. These tests exercise that sink directly; under pytest
the real PostHog init (and therefore the sink installation) is always skipped.
"""

import unittest
import sys
from types import SimpleNamespace
from unittest.mock import patch

from app import asgi


def _message(**record_overrides):
    record = {
        "message": "boom",
        "exception": None,
        "extra": {},
        "level": SimpleNamespace(name="ERROR"),
    }
    record.update(record_overrides)
    return SimpleNamespace(record=record)


class PostHogSinkTests(unittest.TestCase):
    def test_plain_error_record_forwards_message(self):
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(_message())
        track_event.assert_called_once()
        event_name, properties = track_event.call_args[0]
        assert event_name == "$exception"
        assert properties["$exception_message"] == "boom"
        assert "$exception_type" not in properties

    def test_plain_error_record_includes_exception_list(self):
        # PostHog error tracking requires $exception_list on every $exception
        # event; without it ingestion flags $cymbal_errors ("missing field
        # $exception_list") and the event never groups in Error Tracking.
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(_message())
        _, properties = track_event.call_args[0]
        exc_list = properties["$exception_list"]
        assert isinstance(exc_list, list) and len(exc_list) == 1
        assert exc_list[0]["value"] == "boom"
        assert exc_list[0]["type"] == "Error"
        assert exc_list[0]["stacktrace"] == {"type": "raw", "frames": []}

    def test_task_id_only_record_stays_error(self):
        # A record that binds task_id without http_status_code (e.g.
        # task.py's task_id/stage/error_type context) is not an
        # HttpException: the classification must stay "Error".
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(_message(extra={"task_id": "task-1"}))
        _, properties = track_event.call_args[0]
        assert properties["task_id"] == "task-1"
        assert properties["$exception_list"][0]["type"] == "Error"

    def test_none_status_code_not_classified_as_http_exception(self):
        # The "is HttpException" gate must match the property-forwarding
        # gate (not-None): a None http_status_code forwards no property,
        # so it must not classify as HttpException either.
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(
                _message(extra={"task_id": "t", "http_status_code": None})
            )
        _, properties = track_event.call_args[0]
        assert "http_status_code" not in properties
        assert properties["$exception_list"][0]["type"] == "Error"

    def test_bool_extra_forwarded_as_scrubbed_string(self):
        # isinstance(True, int) is True: a bool must not take the int
        # exemption — the repo's "a secret is never an int" rule
        # (analytics.py) gates bools out explicitly.
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(
                _message(extra={"task_id": "t", "http_status_code": True})
            )
        _, properties = track_event.call_args[0]
        assert properties["http_status_code"] == "True"
        assert not isinstance(properties["http_status_code"], bool)

    def test_record_with_exception_forwards_exception_details(self):
        error = ValueError("kaput")
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(_message(exception=(ValueError, error, None)))
        track_event.assert_called_once()
        event_name, properties = track_event.call_args[0]
        assert event_name == "$exception"
        assert properties["$exception_type"] == "ValueError"
        assert properties["$exception_message"] == "kaput"

    def test_record_with_exception_builds_exception_list_from_tuple(self):
        try:
            raise ValueError("kaput")
        except ValueError:
            exc_info = sys.exc_info()
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(_message(exception=exc_info))
        _, properties = track_event.call_args[0]
        exc_list = properties["$exception_list"]
        assert len(exc_list) == 1
        assert exc_list[0]["type"] == "ValueError"
        assert exc_list[0]["value"] == "kaput"
        # PostHog models $exception_list[].stacktrace Sentry-style
        # ({"type": "raw", "frames": [...]}, like posthog-python's own
        # capture); a plain string fails ingestion serde.
        stacktrace = exc_list[0]["stacktrace"]
        assert stacktrace["type"] == "raw"
        assert len(stacktrace["frames"]) >= 1
        frame = stacktrace["frames"][-1]
        assert frame["function"] == "test_record_with_exception_builds_exception_list_from_tuple"
        assert isinstance(frame["lineno"], int)

    def test_stacktrace_scrubbed_before_truncate(self):
        # Pin the PR #38 rule (scrub the full free text before truncating):
        # spy on scrub_secret_values and assert it observes the untruncated
        # stacktrace. A truncate-first order would only ever hand it <=5000
        # chars, letting a cut that strips the regex key-anchor leak the
        # value that follows it.
        raw = "x" * 6000
        seen_lengths: list[int] = []
        real_scrub = asgi.scrub_secret_values

        def spy_scrub(text: str) -> str:
            seen_lengths.append(len(text))
            return real_scrub(text)

        error = ValueError("kaput")
        with (
            patch("app.asgi.track_event") as track_event,
            patch("traceback.format_exception", return_value=[raw]),
            patch("app.asgi.scrub_secret_values", side_effect=spy_scrub),
        ):
            asgi._loguru_posthog_sink(_message(exception=(ValueError, error, None)))
        _, properties = track_event.call_args[0]
        assert seen_lengths and max(seen_lengths) > 5000
        assert len(str(properties["$exception_stacktrace"])) <= 5000

    def test_bound_task_context_forwarded_as_properties(self):
        # HttpException logs via logger.bind(task_id=..., http_status_code=...):
        # the sink must surface them as filterable properties so the reason
        # is visible without parsing the flat message.
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(
                _message(
                    message="HttpException: 404, task-1, req-9: task not found",
                    extra={"task_id": "task-1", "http_status_code": 404},
                )
            )
        _, properties = track_event.call_args[0]
        assert properties["task_id"] == "task-1"
        assert properties["http_status_code"] == 404
        assert properties["$exception_list"][0]["type"] == "HttpException"

    def test_stacktrace_frames_capped(self):
        # The _MAX_STACKTRACE_FRAMES cap keeps deep tracebacks (e.g.
        # RecursionError) from blowing up the event payload — pin it, and
        # pin WHICH end survives: Sentry-style frames end with the innermost
        # frame, so the cap must keep the last N (the error site), not the
        # first N (framework boilerplate).
        def _raise_deep() -> None:
            raise ValueError("deep")

        def recurse(depth: int) -> None:
            if depth <= 0:
                _raise_deep()
            else:
                recurse(depth - 1)

        try:
            recurse(200)
        except ValueError:
            exc_info = sys.exc_info()
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(_message(exception=exc_info))
        _, properties = track_event.call_args[0]
        frames = properties["$exception_list"][0]["stacktrace"]["frames"]
        assert len(frames) == asgi._MAX_STACKTRACE_FRAMES
        assert frames[-1]["function"] == "_raise_deep"

    def test_unlisted_extras_are_not_forwarded(self):
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(
                _message(extra={"task_id": "task-1", "secret_blob": "x"})
            )
        _, properties = track_event.call_args[0]
        assert properties["task_id"] == "task-1"
        assert "secret_blob" not in properties

    def test_sink_never_raises(self):
        class BadMessage:
            @property
            def record(self):  # noqa: D102 - test double
                raise RuntimeError("nope")

        # A throwing PostHog client and a broken record must both be swallowed:
        # telemetry must never break the app.
        with patch("app.asgi.track_event", side_effect=RuntimeError("posthog down")):
            asgi._loguru_posthog_sink(BadMessage())
            asgi._loguru_posthog_sink(_message())

"""Tests for the loguru -> PostHog bridge in app.asgi.

app.asgi installs a loguru sink that forwards ERROR+ records to PostHog
as $exception events. These tests exercise that sink directly; under pytest
the real PostHog init (and therefore the sink installation) is always skipped.
"""

import unittest
import sys
from types import SimpleNamespace
from unittest.mock import patch

from loguru import logger

from app import asgi
from app.models.exception import HttpException


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
        # handled: True matches posthog-python's own capture default
        # (exception_utils.py): these records are caught-and-logged, the
        # app keeps serving — pin the semantics explicitly.
        assert exc_list[0]["mechanism"] == {"type": "generic", "handled": True}

    def test_long_message_truncated(self):
        # $exception_list is the surface whose absence broke ingestion;
        # an unbounded value risks the event being dropped exactly when
        # the payload is biggest — cap it like the stacktrace text.
        long_message = "e" * 6000
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(_message(message=long_message))
        _, properties = track_event.call_args[0]
        assert len(str(properties["$exception_message"])) <= 5000
        assert len(str(properties["$exception_list"][0]["value"])) <= 5000

    def test_long_exception_value_truncated(self):
        error = ValueError("e" * 6000)
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(_message(exception=(ValueError, error, None)))
        _, properties = track_event.call_args[0]
        assert len(str(properties["$exception_message"])) <= 5000
        assert len(str(properties["$exception_list"][0]["value"])) <= 5000

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
        # Classification still keys off presence (not-None gate): pin it so
        # a future gate change can't silently re-label the entry.
        assert properties["$exception_list"][0]["type"] == "HttpException"

    def test_long_task_id_extra_truncated(self):
        # Whitelisted string extras are scrubbed but must also be
        # length-capped like every other free-text field.
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(_message(extra={"task_id": "t" * 6000}))
        _, properties = track_event.call_args[0]
        assert len(str(properties["task_id"])) <= 5000

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


def _log_storage_failure(task_id: str) -> None:
    logger.error(f"video_storage: upload failed for {task_id}")


def _log_scheduler_failure(task_id: str) -> None:
    logger.error(f"fill_schedule: stage generated failed for {task_id}")


def _raise_http_from_storage(task_id: str) -> None:
    raise HttpException(task_id=task_id, status_code=500, message="storage blew up")


def _raise_http_from_scheduler(task_id: str) -> None:
    raise HttpException(task_id=task_id, status_code=500, message="scheduler blew up")


def _raise_http_with_status(task_id: str, status_code: int) -> None:
    raise HttpException(task_id=task_id, status_code=status_code, message="boom")


def _swallow_http_exception(raise_fn, *args) -> None:
    try:
        raise_fn(*args)
    except HttpException:
        pass


def _log_fail_task_stage(task_id: str, stage: str) -> None:
    # Same shape as services.task._fail_task: task id, stage and error type
    # bound as extras on a flat ERROR record.
    logger.bind(task_id=task_id, stage=stage, error_type="TaskError").error(
        "video task failed at stage {stage}: boom", stage=stage
    )


def _captured_properties(*log_calls) -> list[dict]:
    """Run each log call through the real loguru pipeline into the sink."""
    handler_id = logger.add(asgi._loguru_posthog_sink, level="ERROR")
    try:
        with patch("app.asgi.track_event") as track_event:
            for log_call in log_calls:
                log_call()
    finally:
        logger.remove(handler_id)
    return [call.args[1] for call in track_event.call_args_list]


def _running_under_mutmut() -> bool:
    # mutmut 3.x rewrites the module under test so every function routes
    # through its trampoline: frame-counting (logger.opt(depth=1)) then
    # attributes the record to the trampoline, not the raise site. The
    # mock-based tests in test_exception.py pin the opt(depth=1) call
    # itself (and kill its mutants); the raise-site integration test below
    # is skipped under the transform instead of asserting a harness
    # artifact.
    return "mutmut.mutation.trampoline" in sys.modules


class FlatLogGroupingTests(unittest.TestCase):
    def test_flat_logs_from_two_sources_get_different_fingerprints(self):
        storage, scheduler = _captured_properties(
            lambda: _log_storage_failure("task-1"),
            lambda: _log_scheduler_failure("task-1"),
        )
        assert storage["$exception_fingerprint"] != scheduler["$exception_fingerprint"]

    def test_repeated_flat_logs_from_one_source_share_a_fingerprint(self):
        # The task id changes per request: it must not reach the key, or
        # every request would open its own issue.
        first, second = _captured_properties(
            lambda: _log_storage_failure("task-1"),
            lambda: _log_storage_failure("task-2"),
        )
        assert first["$exception_message"] != second["$exception_message"]
        assert first["$exception_fingerprint"] == second["$exception_fingerprint"]
        assert "task-1" not in first["$exception_fingerprint"]

    def test_fingerprint_names_module_and_function_not_path(self):
        (properties,) = _captured_properties(lambda: _log_storage_failure("task-1"))
        assert properties["$exception_fingerprint"] == (
            f"Error:{__name__}:_log_storage_failure"
        )

    def test_http_exception_type_is_part_of_the_fingerprint(self):
        plain, http = _captured_properties(
            lambda: logger.error("boom"),
            lambda: logger.bind(http_status_code=500).error("boom"),
        )
        assert plain["$exception_fingerprint"].startswith("Error:")
        assert http["$exception_fingerprint"].startswith("HttpException:")

    def test_record_with_exception_keeps_frame_grouping(self):
        # Records with a live exception carry real frames: PostHog groups
        # them by those frames, so the sink adds no fingerprint.
        def _log_with_exception() -> None:
            try:
                raise ValueError("boom")
            except ValueError:
                logger.exception("failed")

        (properties,) = _captured_properties(_log_with_exception)
        assert "$exception_fingerprint" not in properties

    def test_record_without_source_fields_sends_no_fingerprint(self):
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(_message())
        _, properties = track_event.call_args[0]
        assert "$exception_fingerprint" not in properties

    @unittest.skipIf(
        _running_under_mutmut(),
        "mutmut's trampoline sits one frame above __init__, so opt(depth=1) "
        "attributes there instead of the raise site",
    )
    def test_http_exception_fingerprint_uses_raise_site_not_init(self):
        # HttpException logs from its own __init__: without depth
        # attribution every 5xx raised anywhere would share one
        # "...:__init__" issue.
        storage, scheduler = _captured_properties(
            lambda: _swallow_http_exception(_raise_http_from_storage, "task-1"),
            lambda: _swallow_http_exception(_raise_http_from_scheduler, "task-1"),
        )
        assert storage["$exception_fingerprint"] != scheduler["$exception_fingerprint"]
        assert "_raise_http_from_storage" in storage["$exception_fingerprint"]
        assert "__init__" not in storage["$exception_fingerprint"]

    def test_http_exception_fingerprint_includes_status_code(self):
        # A 502 from a dead upstream and a 500 from our own bug are
        # different issues even when raised at the same site.
        err_500, err_502 = _captured_properties(
            lambda: _swallow_http_exception(_raise_http_with_status, "task-1", 500),
            lambda: _swallow_http_exception(_raise_http_with_status, "task-1", 502),
        )
        assert err_500["$exception_fingerprint"] != err_502["$exception_fingerprint"]
        assert ":500:" in err_500["$exception_fingerprint"]
        assert ":502:" in err_502["$exception_fingerprint"]

    def test_fail_task_stages_get_separate_fingerprints(self):
        # Upload failures (bad R2 creds) and script failures (dead LLM)
        # have different root causes: one issue per pipeline stage.
        upload, script = _captured_properties(
            lambda: _log_fail_task_stage("task-1", "upload"),
            lambda: _log_fail_task_stage("task-1", "script"),
        )
        assert upload["$exception_fingerprint"] != script["$exception_fingerprint"]
        assert "stage=upload" in upload["$exception_fingerprint"]

    def test_fail_task_same_stage_shares_fingerprint_across_tasks(self):
        first, second = _captured_properties(
            lambda: _log_fail_task_stage("task-1", "upload"),
            lambda: _log_fail_task_stage("task-2", "upload"),
        )
        assert first["$exception_fingerprint"] == second["$exception_fingerprint"]
        assert "task-1" not in first["$exception_fingerprint"]

    def test_bool_status_code_gets_no_status_qualifier(self):
        # A non-int status must not reach the key (same bool exclusion
        # as property forwarding); the type prefix alone still groups it.
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(
                _message(
                    extra={"http_status_code": True},
                    name="some.module",
                    function="some_function",
                )
            )
        _, properties = track_event.call_args[0]
        assert (
            properties["$exception_fingerprint"]
            == "HttpException:some.module:some_function"
        )


class StartupWarmClientTests(unittest.TestCase):
    def test_startup_event_warms_posthog_client(self):
        # The PostHog client must be warmed by the server startup hook —
        # not at controller import time (which also runs under pytest,
        # CLI/webui entry points, and anything else that imports the
        # controller module).
        with (
            patch("app.asgi.warm_client") as warm,
            patch("app.asgi.start_fill_schedule_scheduler"),
        ):
            asgi.startup_event()
        warm.assert_called_once_with()

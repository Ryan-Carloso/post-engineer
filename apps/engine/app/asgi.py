"""Application implementation - ASGI."""

import os
import traceback
from types import TracebackType

from dotenv import load_dotenv
from fastapi import FastAPI
from loguru import logger

from app.config import config
from app.router import root_api_router
from app.services.analytics import scrub_secret_values, track_event, warm_client
from app.services.fill_schedule import (
    FillScheduleScheduler,
    ScheduleStore,
    start_fill_schedule_thread,
)
from app.services import notify

load_dotenv()


def should_init_error_tracking() -> bool:
    """True when production error tracking should be initialized.

    Never under pytest: importing this module during test collection runs
    load_dotenv(), and the test process must not report to production
    error tracking.
    """
    return not notify.running_under_test() and bool(os.getenv("POSTHOG_API_KEY"))


_EXCEPTION_CONTEXT_EXTRAS = ("task_id", "http_status_code")

_MAX_STACKTRACE_FRAMES = 100

_MAX_TEXT_CHARS = 5000


def _scrub_and_truncate(text: str) -> str:
    return scrub_secret_values(text)[:_MAX_TEXT_CHARS]


def _stacktrace_frames(exc_tb: TracebackType | None) -> list[dict[str, object]]:
    """Serialize a traceback into PostHog's {"type": "raw", "frames": [...]} shape.

    Mirrors posthog-python's own exception capture (exception_utils.py):
    ingestion models $exception_list[].stacktrace Sentry-style, and a plain
    string risks failing its serde check — the exact failure this sink exists
    to fix.

    Frames are ordered oldest-first (Sentry convention: the innermost frame
    is last), and the cap keeps the LAST N summaries — the error site —
    never the outermost framework boilerplate.
    """
    try:
        summaries = traceback.extract_tb(exc_tb)[-_MAX_STACKTRACE_FRAMES:]
        return [
            {
                "filename": scrub_secret_values(summary.filename or ""),
                "lineno": summary.lineno,
                "function": scrub_secret_values(summary.name or ""),
            }
            for summary in summaries
        ]
    except Exception:
        return []


def _exception_list_entry(
    exc_type: str, value: str, stacktrace: dict[str, object]
) -> dict[str, object]:
    return {
        "type": exc_type,
        "value": value,
        "stacktrace": stacktrace,
        "mechanism": {"type": "generic", "handled": True},
    }


def _flat_log_fingerprint(record: dict[str, object], exc_type: str) -> str | None:
    """Stable grouping key for an ERROR record without an exception tuple.

    With an empty frame list, PostHog put every flat log of one type into
    a single issue, whatever its source. The key is the log call's
    module and function: bounded by the codebase, independent of the
    machine path, and free of message text (task ids would create one
    issue per request). The line number stays out so an edit to the file
    does not split an issue on every deploy.

    Two bounded qualifiers sharpen the key without risking one issue per
    request: the HTTP status code on HttpException keys (a 502 from a dead
    upstream is a different issue than a 500 from our own bug), and the
    pipeline stage bound by _fail_task (upload vs script failures have
    different root causes). Both stay out when absent or unusable.
    """
    module = record.get("name")
    function = record.get("function")
    if not (isinstance(module, str) and module and isinstance(function, str) and function):
        return None
    extra = record.get("extra")
    if not isinstance(extra, dict):
        extra = {}
    key = exc_type
    status_code = extra.get("http_status_code")
    if isinstance(status_code, int) and not isinstance(status_code, bool):
        key += f":{status_code}"
    key += f":{module}:{function}"
    stage = extra.get("stage")
    if isinstance(stage, str) and stage:
        key += f":stage={stage}"
    return scrub_secret_values(key)[:_MAX_TEXT_CHARS]


def _loguru_posthog_sink(message) -> None:
    """Forward ERROR+ loguru records to PostHog as $exception events.

    Telemetry must never break the app: every failure inside this sink
    is swallowed.
    """
    try:
        record = message.record
        exception = record.get("exception")
        properties: dict[str, object] = {
            "$exception_message": _scrub_and_truncate(str(record.get("message", ""))),
        }
        extra = record.get("extra") or {}
        for key in _EXCEPTION_CONTEXT_EXTRAS:
            if isinstance(extra, dict) and extra.get(key) is not None:
                value = extra[key]
                properties[key] = (
                    value
                    if isinstance(value, int) and not isinstance(value, bool)
                    else _scrub_and_truncate(str(value))
                )
        if exception is not None:
            exc_value = exception[1]
            exc_type_name = type(exc_value).__name__
            exc_message = _scrub_and_truncate(str(exc_value))
            try:
                stacktrace_text = _scrub_and_truncate(
                    "".join(
                        traceback.format_exception(
                            type(exc_value), exc_value, exc_value.__traceback__
                        )
                    )
                )
            except Exception:
                stacktrace_text = ""
            stacktrace: dict[str, object] = {
                "type": "raw",
                "frames": _stacktrace_frames(exception[2]),
            }
        else:
            exc_type_name = (
                "HttpException"
                if isinstance(extra, dict) and extra.get("http_status_code") is not None
                else "Error"
            )
            exc_message = str(properties["$exception_message"])
            stacktrace_text = ""
            stacktrace = {"type": "raw", "frames": []}
            fingerprint = _flat_log_fingerprint(record, exc_type_name)
            if fingerprint is not None:
                properties["$exception_fingerprint"] = fingerprint
        properties["$exception_type"] = exc_type_name
        properties["$exception_message"] = exc_message
        properties["$exception_stacktrace"] = stacktrace_text
        properties["$exception_types"] = [exc_type_name]
        properties["$exception_list"] = [
            _exception_list_entry(exc_type_name, exc_message, stacktrace)
        ]
        track_event("$exception", properties)
    except Exception:
        pass


if should_init_error_tracking():
    logger.add(_loguru_posthog_sink, level="ERROR")
    logger.info("PostHog error tracking enabled")
elif notify.running_under_test():
    if notify.test_skip_is_suspicious():
        logger.warning("PostHog error tracking skipped: no test runner detected — tracking disabled outside a test run")
    else:
        logger.debug("PostHog error tracking skipped: running under pytest")
else:
    logger.warning("POSTHOG_API_KEY is not set — PostHog error tracking disabled")


def start_fill_schedule_scheduler() -> None:
    """Automatic Fill Schedule — starts with the app (no env flag).

    Only depends on the Supabase envs: without them the ScheduleStore fails
    and the scheduler is skipped with a log, without breaking boot.
    """

    try:
        scheduler = FillScheduleScheduler(store=ScheduleStore())
    except RuntimeError as exc:
        logger.warning(f"fill schedule scheduler skipped: {exc}")
        return
    start_fill_schedule_thread(scheduler)
    notify.send_discord(notify.scheduler_started_msg())
    logger.info("fill schedule scheduler started")


def get_application() -> FastAPI:
    """Initialize FastAPI application.

    Returns:
       FastAPI: Application object instance.

    """
    instance = FastAPI(
        title=config.project_name,
        description=config.project_description,
        version=config.project_version,
        debug=False,
    )
    instance.include_router(root_api_router)
    return instance


app = get_application()

VERSION_FILE = "/app/VERSION"
BUILT_AT_FILE = "/app/BUILT_AT"


def _read_built_at_file() -> str | None:
    """ISO UTC stamp baked into the image, or None when unreadable."""
    try:
        with open(BUILT_AT_FILE, encoding="utf-8") as handle:
            stamp = handle.read().strip()
            return stamp or None
    except OSError:
        return None


def _read_version_file() -> str | None:
    """Version from the mounted VERSION file, or None when unreadable."""
    try:
        with open(VERSION_FILE, encoding="utf-8") as handle:
            version = handle.read().strip()
            return version or None
    except OSError:
        return None


def _int_or_none(raw: str) -> int | None:
    """Parse a non-negative int, or None when blank/malformed."""
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def get_build_info() -> dict[str, str | int | None]:
    """Build metadata identifying the exact running build.

    Precedence: injected VERSION/PR_NUMBER/BUILD/COMMIT env vars first
    (authoritative), then the mounted VERSION file for the version, then
    "dev". ``pr`` is the merged PR number that produced the deployed commit
    (the deployment version is MAJOR.MINOR.pr, e.g. 1.28.152) and ``build``
    carries the same identifier for consumers of the older payload shape.
    Malformed values degrade to None. Never raises: version reporting must
    not break the app.
    """
    version = os.environ.get("VERSION", "").strip() or _read_version_file() or "dev"
    pr = _int_or_none(os.environ.get("PR_NUMBER", "").strip())
    build = _int_or_none(os.environ.get("BUILD", "").strip())
    if build is None:
        build = pr
    commit = os.environ.get("COMMIT", "").strip() or None
    built_at = os.environ.get("BUILT_AT", "").strip() or _read_built_at_file()
    return {
        "version": version,
        "build": build,
        "pr": pr,
        "commit": commit,
        "builtAt": built_at,
    }


@app.get("/version")
def version() -> dict[str, str | int | None]:
    """Public build metadata (no auth): version + PR number + commit SHA."""
    return get_build_info()


@app.get("/health")
def health() -> dict[str, str | int | None]:
    """Public liveness + build probe (no auth): identifies the live build."""
    return {"status": "ok", **get_build_info()}



@app.on_event("startup")
def startup_event():
    build = get_build_info()
    logger.info(
        f"startup event (version {build['version']} "
        f"pr {build['pr']} build {build['build']} commit {build['commit']})"
    )
    warm_client()
    start_fill_schedule_scheduler()

"""Application implementation - ASGI."""

import os
import traceback
from types import TracebackType

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

from app.config import config
from app.models.exception import HttpException
from app.router import root_api_router
from app.services.analytics import scrub_secret_values, track_event, warm_client
from app.services.fill_schedule import (
    FillScheduleScheduler,
    ScheduleStore,
    start_fill_schedule_thread,
)
from app.services import notify
from app.services import state as sm
from app.utils import utils

load_dotenv()


def should_init_error_tracking() -> bool:
    """True when production error tracking should be initialized.

    Never under pytest: importing this module during test collection runs
    load_dotenv(), and the test process must not report to production
    error tracking.
    """
    return not notify.running_under_test() and bool(os.getenv("POSTHOG_API_KEY"))


#---------------
# PostHog error tracking. Without a key: warn and continue without error
# tracking (the engine also runs in dev/tests without a complete .env).
# Under pytest the init is always skipped (see should_init_error_tracking).
#---------------
# Loguru extras forwarded as PostHog properties on $exception events.
# Whitelisted: only filterable, non-sensitive context (ids, status codes).
# Anything else bound to a record stays out of telemetry.
_EXCEPTION_CONTEXT_EXTRAS = ("task_id", "http_status_code")

# Bound on serialized frames per $exception_list entry: deep tracebacks
# (e.g. RecursionError) must not blow up the event payload.
_MAX_STACKTRACE_FRAMES = 100

# Bound on free-text fields ($exception_message, entry value, stacktrace
# text): oversized values risk ingestion dropping the event — or silently
# truncating properties — exactly when the payload is biggest. Scrub the
# full text first, then cut (PR #38 rule: a cut landing mid-key would
# otherwise strip the regex anchor and leak the value).
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
    # PostHog error tracking requires $exception_list on every $exception
    # event; without it ingestion flags $cymbal_errors ("missing field
    # $exception_list") and the event never groups in Error Tracking.
    # handled: True matches posthog-python's own capture default — records
    # reaching this sink were caught and logged while the app keeps
    # serving, never process crashes.
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
    """
    module = record.get("name")
    function = record.get("function")
    if not (isinstance(module, str) and module and isinstance(function, str) and function):
        return None
    return scrub_secret_values(f"{exc_type}:{module}:{function}")[:_MAX_TEXT_CHARS]


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
                # Typed ints (e.g. http_status_code) are not free text:
                # forward them raw so PostHog numeric filters/breakdowns
                # work; everything else is scrubbed AND length-capped like
                # every other free-text field. Bools are excluded
                # explicitly — isinstance(True, int) is True, and a secret
                # is never an int (analytics.py rule).
                properties[key] = (
                    value
                    if isinstance(value, int) and not isinstance(value, bool)
                    else _scrub_and_truncate(str(value))
                )
        if exception is not None:
            # loguru stores the exception as a (type, value, traceback) tuple
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
            properties["$exception_type"] = exc_type_name
            properties["$exception_message"] = exc_message
            properties["$exception_stacktrace"] = stacktrace_text
        else:
            # No live exception tuple (e.g. HttpException logs its own flat
            # message): synthesize the entry so the event still ingests.
            # The http_status_code extra marks our HttpException path — same
            # not-None gate as the property forwarding above, so the
            # classification can never drift from the forwarded signal.
            exc_type_name = (
                "HttpException"
                if isinstance(extra, dict) and extra.get("http_status_code") is not None
                else "Error"
            )
            exc_message = str(properties["$exception_message"])
            stacktrace = {"type": "raw", "frames": []}
            fingerprint = _flat_log_fingerprint(record, exc_type_name)
            if fingerprint is not None:
                properties["$exception_fingerprint"] = fingerprint
        properties["$exception_list"] = [
            _exception_list_entry(exc_type_name, exc_message, stacktrace)
        ]
        track_event("$exception", properties)  # type: ignore[arg-type]
    except Exception:
        pass


if should_init_error_tracking():
    # Loguru records are forwarded to PostHog via the sink below.
    logger.add(_loguru_posthog_sink, level="ERROR")
    logger.info("PostHog error tracking enabled")
elif notify.running_under_test():
    if notify.test_skip_is_suspicious():
        # The guard fired with no test runner behind it (bare pytest import
        # or a leaked ENGINE_UNDER_TEST in a production environment): every
        # error report would silently stop. Loud, not debug.
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
        scheduler = FillScheduleScheduler(
            store=ScheduleStore(),
            task_state=sm.state,
        )
    except RuntimeError as exc:
        logger.warning(f"fill schedule scheduler skipped: {exc}")
        return
    start_fill_schedule_thread(scheduler)
    notify.send_discord(notify.scheduler_started_msg())
    logger.info("fill schedule scheduler started")


def exception_handler(request: Request, e: HttpException):
    return JSONResponse(
        status_code=e.status_code,
        content=utils.get_response(e.status_code, message=e.message),
    )


def validation_exception_handler(request: Request, e: RequestValidationError):
    return JSONResponse(
        status_code=400,
        content=utils.get_response(
            status=400, body=e.errors(), message="field required"
        ),
    )


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
    instance.add_exception_handler(HttpException, exception_handler)
    instance.add_exception_handler(RequestValidationError, validation_exception_handler)
    return instance


app = get_application()

# No CORS: the engine is internal — browsers never hit it directly; every
# call goes through Next.js (same origin as the app) with the Supabase JWT.

# Build metadata: VERSION/PR_NUMBER/BUILD/COMMIT are injected at build and
# deploy time. In production the VPS deploy generates them (see
# deploy-version.sh in the deployment repo): VERSION is MAJOR.MINOR.PR where
# PR is the merged pull request that introduced the deployed commit, BUILD is
# that same PR number (the build identifier) and COMMIT is the full SHA. CI
# injects its own values so the test suite exercises the same code path. The
# repo-root VERSION file is mounted read-only into the container as the
# fallback for the version when VERSION is unset (local runs). Nothing
# version-related is committed to git per build — parallel PRs never conflict
# on version files.
VERSION_FILE = "/app/VERSION"


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
    return {"version": version, "build": build, "pr": pr, "commit": commit}


@app.get("/version")
def version() -> dict[str, str | int | None]:
    """Public build metadata (no auth): version + PR number + commit SHA."""
    return get_build_info()


@app.get("/health")
def health() -> dict[str, str | int | None]:
    """Public liveness + build probe (no auth): identifies the live build."""
    return {"status": "ok", **get_build_info()}

public_dir = utils.public_dir()
app.mount("/", StaticFiles(directory=public_dir, html=True), name="")


@app.on_event("shutdown")
def shutdown_event():
    logger.info("shutdown event")


@app.on_event("startup")
def startup_event():
    build = get_build_info()
    logger.info(
        f"startup event (version {build['version']} "
        f"pr {build['pr']} build {build['build']} commit {build['commit']})"
    )
    # Warm the PostHog client on server startup — not at controller import
    # time: the on_accepted funnel callback runs under the task-manager
    # lock, and the first track_event in a process pays the posthog import
    # + client construction. Confining it here keeps the side effect in the
    # process that actually serves traffic. No-op when POSTHOG_API_KEY is
    # unset.
    warm_client()
    start_fill_schedule_scheduler()

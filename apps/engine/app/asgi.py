"""Application implementation - ASGI."""

import os
import traceback

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
def _loguru_posthog_sink(message) -> None:
    """Forward ERROR+ loguru records to PostHog as $exception events.

    Telemetry must never break the app: every failure inside this sink
    is swallowed.
    """
    try:
        record = message.record
        exception = record.get("exception")
        properties: dict[str, object] = {
            "$exception_message": scrub_secret_values(str(record.get("message", ""))),
        }
        if exception is not None:
            # loguru stores the exception as a (type, value, traceback) tuple
            exc_value = exception[1]
            properties["$exception_type"] = type(exc_value).__name__
            properties["$exception_message"] = scrub_secret_values(str(exc_value))
            try:
                properties["$exception_stacktrace"] = scrub_secret_values("".join(
                    traceback.format_exception(type(exc_value), exc_value, exc_value.__traceback__)
                )[:5000])
            except Exception:
                pass
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
        content=utils.get_response(e.status_code, e.data, e.message),
    )


def validation_exception_handler(request: Request, e: RequestValidationError):
    return JSONResponse(
        status_code=400,
        content=utils.get_response(
            status=400, data=e.errors(), message="field required"
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

# Platform version file: the repo-root VERSION (single source of truth,
# bumped on every PR) is mounted read-only into the container by
# docker-compose (see ../../docker-compose.yml volumes).
VERSION_FILE = "/app/VERSION"


def get_deployed_version() -> str:
    """Deployed platform version, for /health and the startup log.

    Reads the mounted VERSION file; falls back to the APP_VERSION env
    (manual override) and then "dev". Never raises: version reporting
    must not break the app.
    """
    try:
        with open(VERSION_FILE, encoding="utf-8") as handle:
            version = handle.read().strip()
            if version:
                return version
    except OSError:
        pass
    return os.environ.get("APP_VERSION") or "dev"


@app.get("/health")
def health() -> dict[str, str]:
    """Public liveness + version probe (no auth): identifies the live version."""
    return {"status": "ok", "version": get_deployed_version()}

public_dir = utils.public_dir()
app.mount("/", StaticFiles(directory=public_dir, html=True), name="")


@app.on_event("shutdown")
def shutdown_event():
    logger.info("shutdown event")


@app.on_event("startup")
def startup_event():
    logger.info(f"startup event (version {get_deployed_version()})")
    # Warm the PostHog client at server startup: the on_accepted funnel
    # callback runs under the task-manager lock, and the first track_event
    # in a process pays the posthog import + client construction. Doing it
    # here keeps the lock hold short and confines the side effect (a
    # background consumer thread + atexit hook) to the serving process —
    # not every process that merely imports the controller. No-op when
    # POSTHOG_API_KEY is unset.
    warm_client()
    start_fill_schedule_scheduler()

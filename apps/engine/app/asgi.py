"""Application implementation - ASGI."""

import os

import sentry_sdk
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

from app.config import config
from app.models.exception import HttpException
from app.router import root_api_router
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
    load_dotenv(), which loads the tracked .env with the real BUGSINK_DSN,
    and the test process must not report to production error tracking.
    """
    return not notify.running_under_test() and bool(os.getenv("BUGSINK_DSN"))


#---------------
# Bugsink Cloud (Sentry-compatible). Without a DSN: warn and continue
# without error tracking (the engine also runs in dev/tests without a
# complete .env). Under pytest the init is always skipped (see
# should_init_error_tracking): the tracked .env carries the real DSN.
#---------------
def _loguru_bugsink_sink(message) -> None:
    """Forward ERROR+ loguru records to Bugsink.

    sentry_sdk's stdlib logging integration never sees loguru records, so
    without this sink every handled engine error (fill-scheduler slot and
    stage failures, cross-post failures, ...) would only exist in the
    process logs. Telemetry must never break the app: every failure inside
    this sink is swallowed.
    """
    try:
        record = message.record
        exception = record.get("exception")
        if exception is not None:
            # loguru stores the exception as a (type, value, traceback) tuple
            sentry_sdk.capture_exception(exception[1])
        else:
            sentry_sdk.capture_message(str(record.get("message", "")), level="error")
    except Exception:
        pass


if should_init_error_tracking():
    sentry_sdk.init(
        dsn=os.environ["BUGSINK_DSN"],
        integrations=[StarletteIntegration(), FastApiIntegration()],
        traces_sample_rate=0.0,
        send_default_pii=False,
    )
    # Loguru records bypass the SDK's stdlib logging integration entirely;
    # without this sink, handled errors would never reach Bugsink.
    logger.add(_loguru_bugsink_sink, level="ERROR")
    logger.info("Bugsink error tracking enabled")
elif notify.running_under_test():
    if notify.test_skip_is_suspicious():
        # The guard fired with no test runner behind it (bare pytest import
        # or a leaked ENGINE_UNDER_TEST in a production environment): every
        # error report would silently stop. Loud, not debug.
        logger.warning("Bugsink error tracking skipped: no test runner detected — tracking disabled outside a test run")
    else:
        logger.debug("Bugsink error tracking skipped: running under pytest")
else:
    logger.warning("BUGSINK_DSN is not set — Bugsink error tracking disabled")


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


def get_deployed_version() -> str:
    """Deployed build identity, for /health and the startup log.

    Baked into the image at build time via the GIT_SHA build arg
    (Dockerfile maps it to APP_VERSION); dev/test default to "dev".
    """
    return os.environ.get("APP_VERSION") or "dev"


@app.get("/health")
def health() -> dict[str, str]:
    """Public liveness + version probe (no auth): identifies the deployed commit."""
    return {"status": "ok", "version": get_deployed_version()}

public_dir = utils.public_dir()
app.mount("/", StaticFiles(directory=public_dir, html=True), name="")


@app.on_event("shutdown")
def shutdown_event():
    logger.info("shutdown event")


@app.on_event("startup")
def startup_event():
    logger.info(f"startup event (version {get_deployed_version()})")
    start_fill_schedule_scheduler()

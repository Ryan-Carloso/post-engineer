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
from app.controllers.v1.video import (
    fill_schedule_queue,
    start_persona_batch_scheduler,
)
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
if should_init_error_tracking():
    sentry_sdk.init(
        dsn=os.environ["BUGSINK_DSN"],
        integrations=[StarletteIntegration(), FastApiIntegration()],
        traces_sample_rate=0.0,
        send_default_pii=False,
    )
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

    if fill_schedule_queue is None:
        logger.warning(
            "fill schedule scheduler skipped: persona batch queue is disabled "
            "(MPT_PERSONA_BATCH_ENABLED=false)"
        )
        return
    try:
        scheduler = FillScheduleScheduler(
            store=ScheduleStore(),
            queue=fill_schedule_queue,
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

public_dir = utils.public_dir()
app.mount("/", StaticFiles(directory=public_dir, html=True), name="")


@app.on_event("shutdown")
def shutdown_event():
    logger.info("shutdown event")


@app.on_event("startup")
def startup_event():
    logger.info("startup event")
    start_persona_batch_scheduler()
    start_fill_schedule_scheduler()

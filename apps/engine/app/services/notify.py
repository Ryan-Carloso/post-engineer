"""Discord notifier for the fill schedule — fire-and-forget.

Reads ``DISCORD_WEBHOOK_URL`` from the environment. Without the variable
set it's a no-op — a deployment without a webhook keeps working. NEVER
raises and never logs the URL: any network failure is swallowed with a
warning log so a failed post can't take down the scheduler tick (60s).

Also builds the video-task failure message (``task_failed_msg``) used by
``app.services.task._fail_task``: one alert per failed task with the task
id, subject and error so the user can find the failed job.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Callable

from loguru import logger

ENV_WEBHOOK_URL = "DISCORD_WEBHOOK_URL"

# Simple post: {url, json}. Injectable for tests.
PostFn = Callable[[str, dict[str, str]], Any]

_TIMEOUT_SECONDS = 5


#: Explicit marker the engine test suite sets on import (test/__init__.py).
#: The authoritative "we are running tests" signal — works under pytest and
#: `python -m unittest` alike, unlike pytest's runtime fingerprints.
ENGINE_UNDER_TEST_ENV_VAR = "ENGINE_UNDER_TEST"


def running_under_test() -> bool:
    """True when the code runs inside the engine test suite.

    The engine test suite imports app.asgi at collection time, whose
    load_dotenv() loads the tracked .env — including the REAL
    DISCORD_WEBHOOK_URL and BUGSINK_DSN. Production side effects (Discord
    alerts, error-tracking init) must stay off in that case.

    Detection, most to least authoritative:
    - ``ENGINE_UNDER_TEST=1``: set by the test-suite bootstrap
      (test/__init__.py); works under any runner.
    - ``PYTEST_CURRENT_TEST``: set by pytest itself during test execution.

    Deliberately NOT ``"pytest" in sys.modules``: a bare pytest import in
    a production process (debugger, profiler, plugin) must not disable
    alerts — and no task failure can occur at pytest collection time, so
    the heuristic bought nothing under genuine runs.
    """
    return (
        os.environ.get(ENGINE_UNDER_TEST_ENV_VAR) == "1"
        or "PYTEST_CURRENT_TEST" in os.environ
    )


def unittest_runner_active() -> bool:
    """True when the process entry point is a unittest driver.

    Covers `python -m unittest` precisely: runpy executes unittest.__main__
    as __main__ WITHOUT registering "unittest.__main__" in sys.modules, so
    the entry module's spec name is the fingerprint. Also best-effort
    detection of IDE unittest drivers (PyCharm's utrunner, VSCode's
    unittestadapter), which run test modules without the unittest CLI
    entry point — matched narrowly on the entry script path.
    A library merely importing unittest must NOT count as a test run —
    that is the silent-suppression window this guard exists to make loud.
    """
    main_module = sys.modules.get("__main__")
    spec = getattr(main_module, "__spec__", None)
    if bool(spec) and spec.name == "unittest.__main__":
        return True
    argv0 = (sys.argv[0] if sys.argv else "").replace("\\", "/").lower()
    return any(
        marker in argv0
        for marker in ("utrunner.py", "_jb_unittest_runner.py", "unittestadapter/")
    )


def test_skip_is_suspicious() -> bool:
    """True when the test guard fired on a leaked suite marker.

    ENGINE_UNDER_TEST=1 with no runner behind it (no PYTEST_CURRENT_TEST,
    no pytest import, no unittest driver entry point): the marker leaked
    into a production environment, or a stray `import test` picked up the
    engine's test package. Every alert and the error-tracking init would
    silently stop — hence warning, not debug.
    A genuine run always shows PYTEST_CURRENT_TEST (pytest executing
    tests), the pytest module (collection), or a unittest driver.
    Note: a plain `import unittest` by some library does NOT count — only
    an actual unittest driver entry point does.
    """
    marker = os.environ.get(ENGINE_UNDER_TEST_ENV_VAR) == "1"
    in_test = "PYTEST_CURRENT_TEST" in os.environ
    pytest_imported = "pytest" in sys.modules
    return bool(marker and not (in_test or pytest_imported or unittest_runner_active()))


def _default_post(url: str, payload: dict[str, str]) -> Any:
    import requests

    return requests.post(url, json=payload, timeout=_TIMEOUT_SECONDS)


def send_discord(message: str, post: PostFn | None = None) -> bool:
    """Sends ``{"content": message}`` to the webhook. Returns True if sent."""
    url = os.getenv(ENV_WEBHOOK_URL, "")
    if post is None and running_under_test():
        # Never ping the production Discord channel from the test suite:
        # importing app.asgi during pytest collection loads the tracked .env
        # with the real DISCORD_WEBHOOK_URL. Tests that inject a fake post
        # still exercise the send logic below.
        #
        # A genuine test run always sets a runner marker (ENGINE_UNDER_TEST via
        # the suite bootstrap, or PYTEST_CURRENT_TEST via pytest itself), so
        # reaching this warning means ENGINE_UNDER_TEST=1 leaked into a
        # process with no corroborating runner behind it — no
        # PYTEST_CURRENT_TEST, no pytest import, no unittest driver entry
        # point. Every alert would silently stop. Warn so the operator sees
        # it; stay quiet (debug) during real test runs.
        if url and test_skip_is_suspicious():
            logger.warning(
                "discord notify skipped: ENGINE_UNDER_TEST=1 with no test runner "
                "detected — leaked test marker? alerts disabled"
            )
        else:
            logger.debug("discord notify skipped: running under pytest")
        return False
    if not url:
        return False
    try:
        response = (post or _default_post)(url, {"content": message})
        response.raise_for_status()
        return True
    except Exception as exc:  # noqa: BLE001 — notifier never takes down the caller
        # Never include the URL (may contain a token) or the body in the log.
        logger.warning(f"discord notify failed: {type(exc).__name__}")
        return False


def safe_reason(exc: BaseException) -> str:
    """Exception summary safe for Discord.

    M5 — leak detection uses the REAL webhook URL (from env), not the
    "http" substring: production PublishError carries "HTTP 500" in its
    text and that detail is useful. If the message contains the webhook
    URL/token (or is empty), log only the type.
    """
    webhook_url = os.getenv(ENV_WEBHOOK_URL, "")
    message = str(exc)
    if not message:
        return type(exc).__name__
    if webhook_url and webhook_url in message:
        return type(exc).__name__
    return message[:200]


# ---------------------------------------------------------------------------
# Messages — pure builders, testable without network
# ---------------------------------------------------------------------------
DISCORD_MAX_CONTENT = 2000


def _clip(text: str, max_chars: int) -> str:
    return text if len(text) <= max_chars else text[: max_chars - 1] + "…"


def scheduler_started_msg() -> str:
    return "🗓️ Fill schedule scheduler started"


def generation_batch_msg(count: int, topics: list[str]) -> str:
    listing = "\n".join(f"  • {_clip(topic, 120)}" for topic in topics) if topics else "  (none)"
    return _clip(f"🎬 Generation batch: {count} video(s) enqueued\n{listing}", DISCORD_MAX_CONTENT)


def slot_published_msg(persona: str, topic: str, providers: list[str]) -> str:
    return _clip(
        f"✅ Post published — persona: {_clip(persona, 100)} | topic: {_clip(topic, 150)} | providers: {', '.join(providers)}",
        DISCORD_MAX_CONTENT,
    )


def slot_failed_msg(persona: str, topic: str, reason: str) -> str:
    topic_part = f"topic: {_clip(topic, 150)} | " if topic else ""
    return _clip(
        f"❌ Slot failed — persona: {_clip(persona, 100)} | {topic_part}reason: {_clip(reason, 300)}",
        DISCORD_MAX_CONTENT,
    )


def task_failed_msg(task_id: str, error: str, subject: str = "") -> str:
    """Build the Discord alert for a failed video task.

    Includes the task id and subject so the failed job can be found, plus
    the error (clipped). Callers pass ``safe_reason(...)`` for untrusted
    errors so the webhook URL can't leak into the message.
    """
    subject_part = f"subject: {_clip(subject, 150)} | " if subject else ""
    return _clip(
        f"❌ Video task failed — task: {task_id} | {subject_part}error: {_clip(error, 300)}",
        DISCORD_MAX_CONTENT,
    )

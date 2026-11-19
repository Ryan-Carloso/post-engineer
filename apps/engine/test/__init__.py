"""Engine test-suite bootstrap.

Sets ENGINE_UNDER_TEST=1 on import — but ONLY when a test runner is
actually driving the process (pytest is imported, or the entry point is
a unittest driver: the `python -m unittest` CLI or a known IDE runner).
This package shadows the stdlib `test` package on sys.path, so a stray
`import test` in a production process must NOT flip the marker: that
would silently disable Discord alerts and PostHog error tracking.
"""

import os
import sys

if "pytest" in sys.modules:
    os.environ.setdefault("ENGINE_UNDER_TEST", "1")
else:
    from app.services.notify import unittest_runner_active

    if unittest_runner_active():
        os.environ.setdefault("ENGINE_UNDER_TEST", "1")

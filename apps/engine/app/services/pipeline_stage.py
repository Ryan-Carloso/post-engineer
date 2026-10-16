"""Pipeline phase tracking for the video-generation task.

The tracker separates the *current* phase (the phase running when a
crash happens — used for failure attribution on ``video_generation_failed``)
from the last *completed* phase (used for the progress display).

Call ``begin()`` when a phase starts and ``complete()`` when it finishes.
``complete()`` keeps the historical ``_mark`` behavior from
``app/services/task.py`` (TIMING log + task-row stage persist), so the SSE
progress endpoint sees exactly what it saw before; ``begin()`` is
in-memory only and never touches task state.
"""

import time
from collections.abc import Callable

from loguru import logger


class PhaseTracker:
    """Tracks the current vs last-completed pipeline phase for one task."""

    def __init__(self, task_id: str, persist: Callable[[str], None]) -> None:
        """Create a tracker.

        Args:
            task_id: the task being tracked (TIMING log + warning context).
            persist: called with the phase name on ``complete()`` to update
                the task row's stage; exceptions are swallowed with a warning
                so stage tracking never breaks the pipeline.
        """
        self._task_id = task_id
        self._persist = persist
        self._phase_start = time.perf_counter()
        self._current = "start"
        self._completed = "start"

    @property
    def current(self) -> str:
        """The phase that started most recently (failure attribution)."""
        return self._current

    @property
    def last_completed(self) -> str:
        """The phase that finished most recently (progress display)."""
        return self._completed

    def begin(self, phase: str) -> None:
        """Mark a phase as started. From now on, a crash is attributed to
        ``phase``. Does not touch the progress display."""
        self._current = phase

    def complete(self, phase: str) -> None:
        """Mark a phase as finished: log the TIMING line, advance the
        progress display to ``phase``, and persist it to the task row."""
        now = time.perf_counter()
        logger.info(
            f"[TIMING] task={self._task_id} phase={self._completed}->{phase} "
            f"elapsed={now - self._phase_start:.1f}s"
        )
        self._phase_start = now
        self._completed = phase
        try:
            self._persist(phase)
        except Exception:  # noqa: BLE001 — stage tracking must not break the pipeline
            logger.warning(f"could not persist stage for task {self._task_id}")

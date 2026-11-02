"""Container identity and scaledown cost for the LongCat Modal app.

The GPU container is shared: with ``max_containers=1`` one container serves
every queued clip in turn, so the cold-start weight load and the idle hold
after a job belong to no single clip. This module gives the backend the
stable identity and the scaledown price it needs to report those shared
costs per job, so the engine can amortise them across the videos a
container served instead of billing every video for the whole container.

SCALEDOWN_WINDOW_S must match ``scaledown_window`` on the ``GenerateAvatar``
class in ``modal_longcat.py`` (60s). A sync test pins the two against each
other, because a silent drift here would silently misprice every video.
"""

from __future__ import annotations

import uuid
from typing import Final


# Idle hold after the last job before Modal scales the container to zero.
# Must match the @app.cls scaledown_window in modal_longcat.py.
SCALEDOWN_WINDOW_S: Final[int] = 60


class ContainerCostTracker:
    """Stable identity and job count for one container lifetime.

    Created once at module import, so the id is stable for every job the
    container serves and a fresh id appears after a scale-down / restart.
    ``note_job`` is called exactly once per completed job, in the status
    payload construction, so the count a job reports already includes
    itself.
    """

    def __init__(self) -> None:
        self.container_id = uuid.uuid4().hex
        self._jobs_served = 0

    def note_job(self) -> int:
        """Record one completed job; return the new jobs-served count."""
        self._jobs_served += 1
        return self._jobs_served

    @property
    def jobs_served(self) -> int:
        return self._jobs_served


# Module-level tracker: one per container process, created at import.
TRACKER = ContainerCostTracker()


def scaledown_cost_usd(rate_usd_s: float) -> float:
    """GPU-only price of one scaledown hold at the given per-second rate."""
    return round(SCALEDOWN_WINDOW_S * rate_usd_s, 4)

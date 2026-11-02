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

import math
import uuid
from typing import Final


# Idle hold after the last job before Modal scales the container to zero.
# Must match the @app.cls scaledown_window in modal_longcat.py.
SCALEDOWN_WINDOW_S: Final[int] = 60


class ContainerCostTracker:
    """Stable identity, job count, and handler-cost sum for one container.

    Created once at module import, so the id is stable for every job the
    container serves and a fresh id appears after a scale-down / restart.
    ``note_job`` is called exactly once per completed job, in the status
    payload construction, so the count a job reports already includes
    itself, and the handler-cost sum already includes this job when
    ``container_overhead_usd`` is read for the same job.

    The overhead (container spend minus handler costs) is the shared
    spend the engine amortises across videos: cold-start weight load
    plus idle hold between jobs. It must exclude handler costs, because
    container_cost_usd (uptime x rate) already includes every job's
    handler time — feeding the full container spend into a total that
    also adds this video's handler would count the handler twice.
    """

    def __init__(self) -> None:
        self.container_id = uuid.uuid4().hex
        self._jobs_served = 0
        self._handler_costs_total = 0.0

    def note_job(self, handler_cost_usd: float | None = None) -> int:
        """Record one completed job; return the new jobs-served count.

        When the job's handler cost is given and valid (a finite,
        non-negative number; bool excluded), it joins the handler-cost
        sum. Invalid values still count as a job — they only mean this
        job's handler cost is unknown, not that the job never ran.
        """
        self._jobs_served += 1
        if (
            handler_cost_usd is not None
            and not isinstance(handler_cost_usd, bool)
            and isinstance(handler_cost_usd, (int, float))
            and math.isfinite(handler_cost_usd)
            and handler_cost_usd >= 0
        ):
            self._handler_costs_total += float(handler_cost_usd)
        return self._jobs_served

    @property
    def jobs_served(self) -> int:
        return self._jobs_served

    @property
    def handler_costs_total_usd(self) -> float:
        return round(self._handler_costs_total, 4)

    def container_overhead_usd(self, container_cost_usd: float) -> float:
        """Shared container spend: container spend minus handler costs.

        Clamped at zero, never negative: rounding in the two reported
        figures can put the handler sum a fraction above the container
        spend on a warm container, and a negative shared spend would
        understate every video's total. An invalid container spend
        reports zero overhead rather than an invented figure.
        """
        if (
            isinstance(container_cost_usd, bool)
            or not isinstance(container_cost_usd, (int, float))
            or not math.isfinite(container_cost_usd)
        ):
            return 0.0
        return max(0.0, round(float(container_cost_usd) - self._handler_costs_total, 4))


# Module-level tracker: one per container process, created at import.
TRACKER = ContainerCostTracker()


def scaledown_cost_usd(rate_usd_s: float) -> float:
    """GPU-only price of one scaledown hold at the given per-second rate."""
    return round(SCALEDOWN_WINDOW_S * rate_usd_s, 4)

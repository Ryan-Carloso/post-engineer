"""Container cost snapshot parsing for the LongCat Modal client.

Extracted from app/services/longcat.py so that file stays under the
500-line cap. The parsing guards are the same as _modal_cost_usd: a
non-numeric value is "unknown", never zero, and bool is excluded
explicitly because it is an int subclass.
"""

from __future__ import annotations

import math
from typing import NamedTuple


def modal_cost_usd(status: dict[str, object]) -> float | None:
    """Extract the GPU cost (USD) the Modal app reports on a done job."""
    cost = status.get("cost_usd")
    if isinstance(cost, bool) or not isinstance(cost, (int, float)):
        return None
    if not math.isfinite(cost):
        return None
    return float(cost)


class ModalJobCost(NamedTuple):
    """Container snapshot reported by the backend at a job's completion.

    cost_usd is unchanged (marginal handler cost). container_cost_usd is
    the container-to-date spend (cold-start weight load included);
    scaledown_cost_usd is one scaledown hold; container_id is stable for
    one container lifetime; jobs_served_in_container counts clips, not
    videos — the engine amortises by videos, never by this count. Every
    field is None when the backend did not report it (older deployment).
    """

    cost_usd: float | None
    container_cost_usd: float | None
    container_uptime_s: float | None
    container_id: str | None
    jobs_served_in_container: int | None
    scaledown_cost_usd: float | None


def _modal_number(status: dict[str, object], key: str) -> float | None:
    value = status.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value):
        return None
    return float(value)


def _modal_container_uptime_s(status: dict[str, object]) -> float | None:
    """Container uptime: top-level field first, timings dict as fallback."""
    uptime = _modal_number(status, "container_uptime_s")
    if uptime is not None:
        return uptime
    timings = status.get("timings")
    if isinstance(timings, dict):
        return _modal_number(timings, "container_uptime_s")
    return None


def parse_modal_job_cost(status: dict[str, object]) -> ModalJobCost:
    """Parse every cost field from a done-job status payload, guarded."""
    jobs = status.get("jobs_served_in_container")
    jobs_value = jobs if isinstance(jobs, int) and not isinstance(jobs, bool) else None
    container_id = status.get("container_id")
    return ModalJobCost(
        cost_usd=modal_cost_usd(status),
        container_cost_usd=_modal_number(status, "container_cost_usd"),
        container_uptime_s=_modal_container_uptime_s(status),
        container_id=container_id if isinstance(container_id, str) and container_id else None,
        jobs_served_in_container=jobs_value,
        scaledown_cost_usd=_modal_number(status, "scaledown_cost_usd"),
    )



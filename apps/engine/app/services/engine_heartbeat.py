"""Engine liveness heartbeat + boot death-diagnosis.

A dead process cannot report its own death, so this module records telemetry
*before* death and performs an *autopsy at boot*:

- ``write_beat`` rewrites a single Supabase row (``engine_heartbeat``,
  migration 020) every ``HEARTBEAT_INTERVAL_S`` with pid, uptime and RSS.
  Cheap on purpose — this deliberately does NOT go through PostHog, where a
  45s heartbeat would be noise.
- ``mark_clean_shutdown`` stamps ``clean_shutdown_at``; the ASGI shutdown
  hook calls it. A boot that finds no fresh stamp is an unclean death
  (SIGKILL / OOM-killer) — the hook never runs for those.
- ``report_boot_event`` reads the row at startup and emits the PostHog
  ``engine_boot`` event: orphan counts from the boot reconcile, time since
  the last heartbeat, whether the shutdown was clean, and the last RSS
  reading. The dashboard then answers "OOM or restart?" with no VPS logs.

All entry points are defensive: diagnostics must never break boot, shutdown,
or the heartbeat loop itself.
"""

from __future__ import annotations

import os
import subprocess
import threading
import time
from datetime import datetime, timezone
from typing import Any

from loguru import logger

from app.services.analytics import track_event

HEARTBEAT_INTERVAL_S = 45
_TABLE = "engine_heartbeat"
_REQUEST_TIMEOUT_S = 10

_process_start = time.monotonic()

_vram_cache: dict[str, Any] = {"at": 0.0, "value": None}


def current_rss_mb() -> float | None:
    """Current process RSS in MiB (Linux /proc; ru_maxrss fallback)."""
    try:
        with open("/proc/self/status", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("VmRSS:"):
                    return float(line.split()[1]) / 1024
    except OSError:
        pass
    try:
        import resource

        # Linux reports ru_maxrss in kilobytes (peak, not current).
        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    except Exception:  # noqa: BLE001 - diagnostics only
        return None


def current_vram_mb() -> float | None:
    """Used GPU memory in MiB via nvidia-smi; None when unavailable.

    Best-effort and cached for 60s: spawning nvidia-smi on every sample
    would cost more than the signal is worth on CPU-only hosts.
    """
    now = time.monotonic()
    if now - float(_vram_cache["at"]) < 60:
        return _vram_cache["value"]  # type: ignore[no-any-return]
    value: float | None = None
    try:
        completed = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=memory.used",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if completed.returncode == 0 and completed.stdout.strip():
            value = float(completed.stdout.strip().split()[0])
    except Exception:  # noqa: BLE001 - GPU simply absent/unreachable
        value = None
    _vram_cache["at"] = now
    _vram_cache["value"] = value
    return value


def _supabase_request(
    method: str,
    query: str,
    requests_module: Any = None,
    prefer: str | None = None,
    **kwargs: Any,
) -> Any:
    """One PostgREST call against the heartbeat table. Raises on failure."""
    import requests

    client = requests_module if requests_module is not None else requests
    base_url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not base_url:
        raise RuntimeError("SUPABASE_URL is required for the engine heartbeat")
    if not key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required for the engine heartbeat")
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if prefer is not None:
        headers["Prefer"] = prefer
    response = client.request(
        method,
        f"{base_url.rstrip('/')}/rest/v1/{_TABLE}?{query}",
        headers=headers,
        timeout=_REQUEST_TIMEOUT_S,
        **kwargs,
    )
    response.raise_for_status()
    return response


def write_beat(requests_module: Any = None) -> bool:
    """Upsert the single heartbeat row. Returns True on success."""
    payload = {
        "id": 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "pid": os.getpid(),
        "uptime_s": round(time.monotonic() - _process_start, 1),
        "rss_mb": current_rss_mb(),
        "vram_mb": current_vram_mb(),
    }
    _supabase_request(
        "POST",
        "",
        requests_module,
        prefer="resolution=merge-duplicates",
        json=payload,
    )
    return True


def read_beat(requests_module: Any = None) -> dict[str, Any] | None:
    """Read the heartbeat row, or None when the engine never beat."""
    response = _supabase_request("GET", "id=eq.1&limit=1", requests_module)
    rows = response.json()
    if not rows:
        return None
    row = rows[0]
    return row if isinstance(row, dict) else None


def mark_clean_shutdown(requests_module: Any = None) -> bool:
    """Stamp a clean shutdown. Called by the ASGI shutdown hook.

    SIGKILL and the OOM-killer never run this hook, so a boot that finds
    no fresh stamp is by construction an unclean death.
    """
    _supabase_request(
        "PATCH",
        "id=eq.1",
        requests_module,
        json={
            "clean_shutdown_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return True


def start_heartbeat_thread(interval_s: float = HEARTBEAT_INTERVAL_S) -> threading.Thread:
    """Start the daemon heartbeat loop. A write failure never kills it."""

    def _loop() -> None:
        while True:
            try:
                write_beat()
            except Exception as exc:  # noqa: BLE001 - keep beating
                logger.warning(f"engine heartbeat write failed: {exc}")
            time.sleep(interval_s)

    thread = threading.Thread(target=_loop, name="engine-heartbeat", daemon=True)
    thread.start()
    return thread


def _parse_ts(raw: Any) -> datetime | None:
    if not isinstance(raw, str) or not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def is_clean_shutdown(beat: dict[str, Any]) -> bool:
    """True when the previous run stamped a clean shutdown at its last beat.

    The shutdown hook writes clean_shutdown_at and updated_at together; a
    stamp older than the last beat means the process died after beating
    without ever shutting down cleanly.
    """
    updated_at = _parse_ts(beat.get("updated_at"))
    clean_at = _parse_ts(beat.get("clean_shutdown_at"))
    if updated_at is None or clean_at is None:
        return False
    return abs((clean_at - updated_at).total_seconds()) < 5


def report_boot_event(task_state: Any) -> None:
    """Emit the PostHog ``engine_boot`` autopsy event. Never raises."""
    try:
        stats = getattr(task_state, "last_reconcile_stats", None) or {}
        props: dict[str, object] = {
            "orphan_count": int(stats.get("orphans") or 0),
            "orphans_by_stage": dict(stats.get("by_stage") or {}),
            "orphans_requeued": int(stats.get("requeued") or 0),
            "orphans_completed": int(stats.get("completed") or 0),
            "orphans_failed": int(stats.get("failed") or 0),
        }
        try:
            beat = read_beat()
        except Exception as exc:  # noqa: BLE001 - boot continues regardless
            logger.warning(f"engine_boot: could not read heartbeat: {exc}")
            beat = None
        if beat is not None:
            updated_at = _parse_ts(beat.get("updated_at"))
            if updated_at is not None:
                gap = (datetime.now(timezone.utc) - updated_at).total_seconds()
                props["gap_since_last_heartbeat_s"] = max(0.0, round(gap, 1))
                props["clean_shutdown"] = is_clean_shutdown(beat)
            props["prev_uptime_s"] = beat.get("uptime_s")
            props["rss_last_heartbeat_mb"] = beat.get("rss_mb")
            props["vram_last_heartbeat_mb"] = beat.get("vram_mb")
        track_event("engine_boot", props)
    except Exception as exc:  # noqa: BLE001 - diagnostics never break boot
        logger.warning(f"engine_boot event failed: {exc}")

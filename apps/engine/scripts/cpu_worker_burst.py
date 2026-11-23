"""Eligibility check for a 30-wide faceless burst. Does not deploy or render.

    cd apps/engine
    python scripts/cpu_worker_burst.py --check

To run 30 real jobs after ``modal deploy modal_cpu_worker.py``, point the
engine at that app and POST faceless house-voice tasks yourself. This
script will not do that unless both ``--spawn`` and
``MPT_CPU_WORKER_BURST=1`` are set, and it still only calls Modal spawn
for synthetic payloads (no tokens, no publish):

    MPT_CPU_WORKER=true MPT_CPU_WORKER_APP_NAME=moneyprint-cpu-worker \\
    MPT_CPU_WORKER_BURST=1 python scripts/cpu_worker_burst.py --spawn
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.cpu_worker_dispatch import (  # noqa: E402
    CLONE_PREFIX,
    DEFAULT_MAX_CONTAINERS,
    should_dispatch,
)


def house_payload(index: int) -> dict[str, object]:
    return {
        "video_title": f"burst-{index}",
        "video_description": "Image-only burst check.",
        "video_type": "faceless",
        "voice_name": "chatterbox:kokoro_af_heart",
        "video_script": "One short line.",
    }


def clone_payload() -> dict[str, object]:
    return {
        "video_title": "clone",
        "video_description": "Must stay on the VPS.",
        "video_type": "faceless",
        "voice_name": f"{CLONE_PREFIX}example",
        "video_script": "One short line.",
    }


def check(count: int) -> None:
    previous = os.environ.get("MPT_CPU_WORKER")
    os.environ["MPT_CPU_WORKER"] = "true"
    try:
        for index in range(count):
            if not should_dispatch(house_payload(index), "video"):
                raise SystemExit(f"house payload {index} was not eligible")
        if should_dispatch(clone_payload(), "video"):
            raise SystemExit("clone payload must stay on the VPS")
        if should_dispatch({**house_payload(0), "video_type": "hook_lipsync"}, "video"):
            raise SystemExit("lip-sync payload must stay on the VPS")
    finally:
        if previous is None:
            os.environ.pop("MPT_CPU_WORKER", None)
        else:
            os.environ["MPT_CPU_WORKER"] = previous
    print(
        f"ok: {count} faceless house-voice jobs are eligible; "
        f"ceiling default is {DEFAULT_MAX_CONTAINERS}; clones and lip-sync stay local"
    )


def spawn_many(count: int) -> None:
    if os.environ.get("MPT_CPU_WORKER_BURST") != "1":
        raise SystemExit("refusing to spawn without MPT_CPU_WORKER_BURST=1")
    if os.environ.get("MPT_CPU_WORKER") != "true":
        raise SystemExit("refusing to spawn without MPT_CPU_WORKER=true")
    from app.services.cpu_worker_dispatch import _modal_spawn

    for index in range(count):
        payload = house_payload(index)
        call_id = _modal_spawn(f"burst-{index}", payload, "video")
        print(f"{index} {call_id}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--spawn", action="store_true")
    parser.add_argument("--count", type=int, default=DEFAULT_MAX_CONTAINERS)
    args = parser.parse_args()
    if args.count < 1:
        raise SystemExit("--count must be >= 1")
    if args.spawn:
        spawn_many(args.count)
        return
    check(args.count)


if __name__ == "__main__":
    sys.exit(main())

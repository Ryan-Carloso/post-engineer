#!/usr/bin/env python3
"""Count the pending relayed workflow runs on one head sha.

The OpenBot notify relay (openbot-notify.yml) sends only when this number
is zero: the last finisher wakes the Babysit. Run names come from the
RELAYED_WORKFLOWS env (comma-separated, the same list the trigger block
declares); the runs-API JSON document is read from stdin.

Prints a non-negative integer and exits 0. A malformed JSON document is
counted as 0 pending BY THE CALLER'S fail-open only when the upstream gh
api call itself failed — here an invalid JSON body is treated as empty
(no pending), matching the historical inline parser's ValueError branch;
the workflow shell wraps this script and warns loudly (the failure mode
the closed inline variant could not distinguish from an API failure).

Kept as a real file (not a YAML-embedded string): indented inline python
inside a `run: |` block raised IndentationError on every replay, which
the `|| pending=0` absorbed and turned the last-finisher guard into
send-always (runs 40181857792/40181800861/40181794814/40181794813).
"""

from __future__ import annotations

import json
import os
import sys


def main() -> int:
    names = [
        n.strip()
        for n in (os.environ.get("RELAYED_WORKFLOWS", "") or "").split(",")
        if n.strip()
    ]
    try:
        data = json.loads(sys.stdin.read())
    except ValueError:
        data = {"workflow_runs": []}
    pending = sum(
        1
        for run in data.get("workflow_runs", [])
        if run.get("name") in names
        and run.get("status") in ("queued", "in_progress")
    )
    print(pending)
    return 0


if __name__ == "__main__":
    sys.exit(main())

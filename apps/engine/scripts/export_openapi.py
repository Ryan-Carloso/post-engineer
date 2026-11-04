#!/usr/bin/env python3
"""Export the engine's OpenAPI contract to a committed JSON snapshot.

The snapshot (apps/engine/openapi.json) is the single source the web app
generates its engine request/response types from
(apps/web/lib/engine/schema.gen.ts via openapi-typescript), so web code
stops hand-copying engine contracts.

Usage (from apps/engine):
  uv run python -m scripts.export_openapi --out openapi.json    # write
  uv run python -m scripts.export_openapi --check openapi.json  # CI drift gate

The snapshot holds the contract only: the `info` block comes from the
operator's config.toml (project name/description/version), so it is
replaced with a fixed one — otherwise a dev machine with a custom
config.toml would produce a different file than CI. Keys are sorted so the
output is byte-stable across runs.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# Fixed `info` block: the snapshot describes the HTTP contract, never the
# deployment's branding or version (both come from config.toml).
CONTRACT_INFO: dict[str, str] = {"title": "Post Engineer engine", "version": "contract"}


def build_spec(raw_spec: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of the FastAPI-generated spec with the fixed `info` block."""
    spec = dict(raw_spec)
    spec["info"] = dict(CONTRACT_INFO)
    return spec


def render(spec: dict[str, Any]) -> str:
    """Serialize deterministically: sorted keys, 2-space indent, trailing newline."""
    return json.dumps(spec, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def current_spec_text() -> str:
    """Build the snapshot text from the live FastAPI app (no server started)."""
    # Imported lazily so the pure helpers above stay importable without
    # loading the whole engine (config, routers, analytics sink).
    from app.asgi import app

    return render(build_spec(app.openapi()))


def check(path: Path, expected: str) -> int:
    """Compare the committed snapshot to the live contract; 1 on drift."""
    try:
        committed = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        print(f"{path} does not exist. Run: uv run python -m scripts.export_openapi --out {path}", file=sys.stderr)
        return 1
    if committed != expected:
        print(
            f"{path} is stale: the engine's API contract changed. "
            f"Run: uv run python -m scripts.export_openapi --out {path} "
            "and commit the result (then regenerate the web types).",
            file=sys.stderr,
        )
        return 1
    print(f"{path} is up to date")
    return 0


def main(argv: list[str] | None = None, spec_text: str | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export the engine OpenAPI contract snapshot.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--out", type=Path, help="write the snapshot to this path")
    mode.add_argument("--check", type=Path, help="fail (exit 1) if this snapshot is stale")
    args = parser.parse_args(argv)

    text = spec_text if spec_text is not None else current_spec_text()
    if args.check is not None:
        return check(args.check, text)
    args.out.write_text(text, encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

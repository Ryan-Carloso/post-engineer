#!/usr/bin/env python3
"""Build the verification evidence payload for one diff.

Reads git objects only. Prints finding counts, never file bodies.
Exit 0 when nothing failed, 1 when a fail finding exists, 2 on usage
or git errors.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

_HERE = str(Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from honesty import FileChange, Finding, analyze
from scope import delegated_suites, local_suites

_SKIP_NAMES = {"pnpm-lock.yaml", "uv.lock", "package-lock.json", "schema.snapshot.json"}
_SKIP_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".lock", ".woff", ".woff2", ".mp4")
_MAX_BYTES = 400_000


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Collect verification evidence for a diff.")
    parser.add_argument("--repo", required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument("--source", required=True, choices=("base", "head"))
    parser.add_argument("--json", required=True, dest="json_path")
    args = parser.parse_args(argv)

    repo = str(Path(args.repo).resolve())
    changes, oversized = load_changes(repo, args.base, args.head)
    payload = build_payload(
        changes,
        exists=lambda path: (Path(repo) / path).is_file(),
        grader_source=args.source,
        base=args.base,
        head=args.head,
        oversized=oversized,
    )
    destination = Path(args.json_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    fails = sum(1 for finding in payload["findings"] if finding["severity"] == "fail")
    warns = sum(1 for finding in payload["findings"] if finding["severity"] == "warn")
    print(f"findings fail={fails} warn={warns} suites={','.join(payload['local_suites']) or '-'}")
    return 1 if not payload["ok"] else 0


def build_payload(
    changes: list[FileChange],
    exists,
    grader_source: str,
    base: str,
    head: str,
    oversized: list[str] | None = None,
) -> dict:
    findings = list(analyze(changes, exists))
    for path in oversized or []:
        findings.append(Finding(
            "warn",
            "file-too-large",
            path,
            "file exceeds the grader size limit and was not analyzed",
            1,
        ))
    paths = [change.path for change in changes]
    for path in oversized or []:
        if path not in paths:
            paths.append(path)
    return {
        "ok": not any(finding.severity == "fail" for finding in findings),
        "grader_source": grader_source,
        "base": base,
        "head": head,
        "findings": [finding.as_dict() for finding in findings],
        "local_suites": local_suites(paths),
        "delegated": [item.as_dict() for item in delegated_suites(paths, exists)],
        "changed_count": len(paths),
        "changed_paths": paths[:50],
    }


def load_changes(repo: str, base: str, head: str) -> tuple[list[FileChange], list[str]]:
    raw = _git(repo, ["diff", "--name-status", "--find-renames", base, head], allow_fail=False)
    changes: list[FileChange] = []
    oversized: list[str] = []
    for status, path, old_path in _parse_name_status(raw):
        if _skip(path):
            continue
        base_path = old_path or path
        base_text = "" if status == "A" else _show(repo, base, base_path)
        head_text = "" if status == "D" else _show(repo, head, path)
        if len(base_text) > _MAX_BYTES or len(head_text) > _MAX_BYTES:
            oversized.append(path)
            continue
        changes.append(FileChange(
            path=path,
            status=status,
            base_text=base_text,
            head_text=head_text,
            old_path=old_path,
        ))
    return changes, oversized


def _parse_name_status(text: str) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        code = parts[0]
        if code.startswith(("R", "C")) and len(parts) >= 3:
            rows.append(("R", _unquote(parts[2]), _unquote(parts[1])))
        elif len(parts) >= 2:
            rows.append((code[:1], _unquote(parts[1]), ""))
    return rows


def _show(repo: str, rev: str, path: str) -> str:
    raw = _git(repo, ["show", f"{rev}:{path}"], allow_fail=True)
    if raw is None or b"\0" in raw[:8000]:
        return ""
    return raw.decode("utf-8", errors="replace")


def _git(repo: str, args: list[str], allow_fail: bool) -> str | bytes | None:
    proc = subprocess.run(
        ["git", "-C", repo, "--no-pager", *args],
        check=False,
        capture_output=True,
        env={**_git_env(), "GIT_TERMINAL_PROMPT": "0"},
    )
    if proc.returncode != 0:
        if allow_fail:
            return None
        sys.stderr.write(proc.stderr.decode("utf-8", errors="replace")[:500] + "\n")
        raise SystemExit(2)
    if args[:2] == ["diff", "--name-status"]:
        return proc.stdout.decode("utf-8", errors="replace")
    return proc.stdout


def _git_env() -> dict[str, str]:
    import os
    return dict(os.environ)


def _skip(path: str) -> bool:
    name = path.split("/")[-1]
    return name in _SKIP_NAMES or name.endswith(_SKIP_SUFFIXES)


def _unquote(path: str) -> str:
    if len(path) >= 2 and path.startswith('"') and path.endswith('"'):
        return path[1:-1].replace('\\"', '"')
    return path


if __name__ == "__main__":
    sys.exit(main())

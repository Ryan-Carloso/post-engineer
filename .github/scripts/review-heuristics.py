#!/usr/bin/env python3
"""Deterministic, repo-specific review heuristics (run outside the LLM).

These encode lessons an LLM can miss. Each produces a WARN line the model
is told to confirm or refute, and that is also posted in the comment's
"Mechanical checks" section. None FAIL the job — they are heuristics, not
proofs. ``main`` always exits 0.

1. unscrubbed-telemetry: an added ``track_event(...)`` / ``capture(...)``
   call whose properties include a free-text-looking key (body, error,
   message, detail, response, reason, text, output, preview, stderr,
   traceback) and the call block has no ``scrub_error_text(`` /
   ``scrub_secret_values(``. ``track_event`` redacts by key name only.
   (Flags PR #224's ``response_body``.)
2. empty-aggregate: an added line ``not any(... for x in NAME)`` or
   ``all(... for x in NAME)`` with no same-line guard (``if NAME and``,
   ``len(NAME)``, ``if not NAME``, ``NAME and not``). The guard is checked
   on that line only, not on nearby lines. (Flags PR #224's all-failed
   check, which is true when ``results`` is empty.)
3. overridden-mock: a nested ``with patch.object`` / ``with patch`` of the
   same target while the outer patch is still active. When the caller
   passes the diff's added line numbers, only an inner ``with`` that the
   diff added is reported, so an untouched helper is not flagged. Omitting
   the set checks the whole file.

Usage: python3 review-heuristics.py --diff pr.diff [--root .] > heuristics.md
"""
from __future__ import annotations

import argparse
import ast
import re
import sys
from collections import defaultdict
from pathlib import Path

FREE_TEXT_KEY = re.compile(
    r"[\"'](\w*(?:body|error|message|detail|response|reason|text|output|preview|stderr|traceback)\w*)[\"']\s*:",
    re.IGNORECASE,
)
SCRUB = re.compile(r"scrub_(?:error_text|secret_values)\(")
TELEMETRY_CALL = re.compile(r"\b(track_event|track_ai_request|capture)\s*\(")
TEST_FILE = re.compile(r"(^|/)test_[^/]+\.py$|_test\.py$")


def added_hunks(diff: str) -> dict[str, list[tuple[int, str]]]:
    """file -> [(new_line_no, text)] for added lines only."""
    files: dict[str, list[tuple[int, str]]] = defaultdict(list)
    current: str | None = None
    line_no = 0
    for raw in diff.splitlines():
        if raw.startswith("+++ "):
            path = raw[4:].strip()
            current = path[2:] if path.startswith("b/") else None
            if current == "/dev/null":
                current = None
            continue
        match = re.match(r"^@@ -\d+(?:,\d+)? \+(\d+)", raw)
        if match:
            line_no = int(match.group(1)) - 1
            continue
        if current is None:
            continue
        if raw.startswith("+"):
            line_no += 1
            files[current].append((line_no, raw[1:]))
        elif raw.startswith(" "):
            line_no += 1
    return files


def _call_block(src_lines: list[str], start_idx: int) -> str:
    """Text of the call starting at src_lines[start_idx], parens balanced."""
    depth, block = 0, []
    for text in src_lines[start_idx : start_idx + 60]:
        block.append(text)
        depth += text.count("(") - text.count(")")
        if depth <= 0 and block:
            break
    return "\n".join(block)


def check_telemetry(path: str, lines: list[tuple[int, str]], root: Path) -> list[str]:
    out: list[str] = []
    head = root / path
    src = head.read_text(encoding="utf-8", errors="replace").splitlines() if head.is_file() else None
    for index, (number, text) in enumerate(lines):
        if not TELEMETRY_CALL.search(text):
            continue
        if src is not None and 0 < number <= len(src):
            joined = _call_block(src, number - 1)
        else:
            # File not in the checkout: fall back to the added lines only.
            joined = _call_block([line for _, line in lines], index)
        keys = sorted(set(FREE_TEXT_KEY.findall(joined)))
        if keys and not SCRUB.search(joined):
            label = "property" if len(keys) == 1 else "properties"
            rendered = ", ".join(f"`{key}`" for key in keys)
            out.append(
                f"- WARN unscrubbed-telemetry — `{path}:{number}`: free-text {label} "
                f"{rendered} sent without `scrub_error_text()` "
                "(track_event only redacts by key name)."
            )
    return out


def check_empty_aggregate(path: str, lines: list[tuple[int, str]]) -> list[str]:
    """Flag an added ``not any`` / ``all`` with no guard on the same line."""
    out: list[str] = []
    pattern = re.compile(
        r"\bnot\s+any\(.+\bfor\s+\w+\s+in\s+(\w+)\)|\ball\(.+\bfor\s+\w+\s+in\s+(\w+)\)"
    )
    for number, text in lines:
        match = pattern.search(text)
        if not match:
            continue
        name = match.group(1) or match.group(2)
        guard = re.compile(
            rf"\bif\s+{name}\s+and\b|\blen\({name}\)|\bif\s+not\s+{name}\b|\b{name}\s+and\s+not\b"
        )
        if guard.search(text):
            continue
        snippet = text.strip()[:90]
        out.append(
            f"- WARN empty-aggregate — `{path}:{number}`: `{snippet}` is true when "
            f"`{name}` is empty; is the empty case reachable and intended?"
        )
    return out


def _patch_target(call: ast.Call) -> str | None:
    func = call.func
    name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
    owner = ast.unparse(func.value) if isinstance(func, ast.Attribute) else ""
    if name == "object" and owner.endswith("patch") and len(call.args) >= 2:
        attr = call.args[1]
        if isinstance(attr, ast.Constant) and isinstance(attr.value, str):
            return f"{ast.unparse(call.args[0])}.{attr.value}"
    if name == "patch" and call.args and isinstance(call.args[0], ast.Constant):
        return str(call.args[0].value)
    return None


def check_overridden_mocks(
    path: str, root: Path, added_lines: set[int] | None = None
) -> list[str]:
    """AST check: a nested ``with patch(X)`` while an outer ``with patch(X)``
    is still active makes the outer mock dead inside the inner block.

    ``added_lines`` is the set of added line numbers in the diff. When it is
    provided, only an inner ``with`` whose line is in that set is reported.
    ``None`` checks the whole file (used by unit tests of the detector).
    """
    if not TEST_FILE.search(path):
        return []
    head = root / path
    if not head.is_file():
        return []
    try:
        tree = ast.parse(head.read_text(encoding="utf-8"))
    except SyntaxError:
        return []
    out: list[str] = []

    def walk(node: ast.AST, active: dict[str, int]) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.With, ast.AsyncWith)):
                mine: dict[str, int] = {}
                for item in child.items:
                    if not isinstance(item.context_expr, ast.Call):
                        continue
                    target = _patch_target(item.context_expr)
                    if target is None:
                        continue
                    if target in active and (added_lines is None or child.lineno in added_lines):
                        out.append(
                            f"- WARN overridden-mock — `{path}:{child.lineno}`: `{target}` is "
                            f"re-patched while the patch from line {active[target]} is still "
                            "active; the outer mock is dead inside this block."
                        )
                    mine[target] = item.context_expr.lineno
                walk(child, {**active, **mine})
            else:
                walk(child, active)

    walk(tree, {})
    return out


def collect(diff: str, root: Path) -> list[str]:
    files = added_hunks(diff)
    findings: list[str] = []
    for path, lines in files.items():
        added = {number for number, _ in lines}
        if path.endswith(".py"):
            findings += check_telemetry(path, lines, root)
            findings += check_empty_aggregate(path, lines)
            findings += check_overridden_mocks(path, root, added)
        elif re.search(r"\.(ts|tsx|mjs|js)$", path):
            findings += check_telemetry(path, lines, root)
    return findings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--diff", required=True)
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="checkout at PR head")
    namespace = parser.parse_args(argv)
    diff = Path(namespace.diff).read_text(encoding="utf-8", errors="replace")
    findings = collect(diff, namespace.root)
    if findings:
        print("Heuristic warnings (the reviewer must confirm or refute each):\n")
        print("\n".join(findings))
    else:
        print("- ✅ OK — no heuristic warnings")
    return 0


if __name__ == "__main__":
    sys.exit(main())

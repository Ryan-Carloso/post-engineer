#!/usr/bin/env python3
"""Verify that opencode-review findings are mechanically grounded.

The review prompt requires, per finding:

    ### SEVERITY: short title
    **Location:** path/to/file.ext:12-34
    ```<language>
    <the exact cited lines, quoted verbatim>
    ```

On PR #224 the only finding was a real CRITICAL, and this script dropped it.
The model wrote ``**Location:** `apps/engine/app/services/task_publish.py:61-66` ``
with backticks. The old regex treated the whole backticked token as the
path, the path "did not exist", and the posted comment said no findings
survived — which reads as a clean review. The cited lines (61-66) were
also diff-hunk offsets, not HEAD lines; the old check only required the
range to fall inside the file.

This revision:

1. Accepts backticks, quotes, angle brackets, a trailing period,
   ``path#L12-L34``, ``path:12``, markdown links, and ``PR`` (no code
   location; the quote is checked against ``--context``).
2. Re-anchors line numbers from the verbatim quote and notes the
   correction on the following line (not on the Location line, so a
   later pass can parse it).
3. Confines paths to the checkout (no ``..``, no absolute paths).
4. Lists dropped findings in a collapsed block. When every finding is
   dropped, or the model ignored the ``### SEVERITY:`` format, the
   output starts with ``<!-- review-grounding: not-reviewed -->`` and
   the process exits 1. A fully dropped review must not look like a
   clean pass. A review that states there is nothing to report, with
   no finding-like markup, is published unchanged and exits 0.

Usage:
    python3 verify-review-grounding.py <review.md> <output.md> [--context pr-context.md]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

FINDING_RE = re.compile(r"^###\s+(.+)$")
LOCATION_LINE_RE = re.compile(r"^\*\*Location:\*\*\s*(.+?)\s*$")
FENCE_OPEN_RE = re.compile(r"^```[a-zA-Z0-9+#.\-]*\s*$")
SEVERITY_RE = re.compile(r"^(CRITICAL|MAJOR|MINOR)\b", re.IGNORECASE)
TAIL_RE = re.compile(r"^(Verdict:|Refuted:|No material findings)", re.IGNORECASE)
# A model (or a later pass) may copy an older same-line correction note.
# Strip it before parsing so the path is not the whole sentence.
CORRECTION_SUFFIX_RE = re.compile(
    r"\s+(?:_\(line numbers corrected from \d+\)_|_Line numbers corrected from \d+\._)\s*$",
    re.IGNORECASE,
)

UNPARSEABLE_HINT_RE = re.compile(
    r"^(?:#{1,6}\s+.*\b(?:CRITICAL|MAJOR|MINOR)\b"
    r"|\*\*(?:CRITICAL|MAJOR|MINOR)\b"
    r"|\*\*Location:\*\*)",
    re.IGNORECASE | re.MULTILINE,
)

# First line of every "this PR was not actually reviewed" stub. The
# workflow fails the job when the posted comment starts with this, after
# the comment is up, so the check is red and the findings stay visible.
NOT_REVIEWED_MARKER = "<!-- review-grounding: not-reviewed -->"

# Indent-only matches of a tiny quote (a brace, `pass`) are too weak to
# re-anchor a finding onto. Exact whitespace matches are still accepted.
MIN_SUBSTANTIVE_CHARS = 12


def normalize(text: str) -> str:
    return "\n".join(line.rstrip() for line in text.splitlines())


def parse_location(raw: str) -> tuple[str, int | None, int | None]:
    """Parse a Location value leniently. Returns (path, start, end)."""
    value = raw.strip().strip("`'\"<>").rstrip(".").strip("`'\"<>").strip()
    value = CORRECTION_SUFFIX_RE.sub("", value).strip()
    link = re.match(r"^\[[^\]]*\]\(([^)]+)\)$", value)
    if link:
        value = link.group(1).strip()
    anchored = re.match(r"^(.+?)#L(\d+)(?:-L?(\d+))?$", value)
    if not anchored:
        anchored = re.match(r"^(.+?):(\d+)(?:\s*[-–]\s*(\d+))?$", value)
    if anchored:
        start = int(anchored.group(2))
        end = int(anchored.group(3)) if anchored.group(3) else start
        return anchored.group(1).strip("`'\" "), start, end
    return value, None, None


def split_findings(text: str) -> tuple[str, list[tuple[str, str]], str]:
    """Return (preamble, [(heading, body)], tail). Fence-aware.

    Heading detection skips fenced code: a verbatim quote of markdown may
    itself contain a ``### `` line, and that must not split the finding.
    A trailing ``Verdict:`` / ``Refuted:`` / ``No material findings`` line
    is preserved as the tail so process text can be dropped without
    losing the verdict.
    """
    preamble: list[str] = []
    tail: list[str] = []
    findings: list[tuple[str, str]] = []
    heading: str | None = None
    body: list[str] = []
    in_fence = False
    in_tail = False
    for line in text.splitlines():
        if in_tail:
            tail.append(line)
            continue
        if not in_fence and FENCE_OPEN_RE.match(line):
            in_fence = True
        elif in_fence and line.strip() == "```":
            in_fence = False
        elif not in_fence:
            match = FINDING_RE.match(line)
            if match:
                if heading is not None:
                    findings.append((heading, "\n".join(body)))
                heading, body = match.group(1).strip(), []
                continue
            if TAIL_RE.match(line.strip()):
                in_tail = True
                tail.append(line)
                continue
        (preamble if heading is None else body).append(line)
    if heading is not None:
        findings.append((heading, "\n".join(body)))
    return "\n".join(preamble), findings, "\n".join(tail)


def first_fence(body: str) -> str | None:
    in_fence = False
    collected: list[str] = []
    for line in body.splitlines():
        if not in_fence:
            if FENCE_OPEN_RE.match(line):
                in_fence = True
        elif line.strip() == "```":
            return "\n".join(collected)
        else:
            collected.append(line)
    return None


def _substantive(lines: list[str]) -> bool:
    return any(len(line.strip()) >= MIN_SUBSTANTIVE_CHARS for line in lines)


def find_snippet(
    file_lines: list[str], snippet: str, hint: int | None
) -> tuple[int, int] | None:
    """1-based (start, end) of the snippet in the file, nearest to hint."""
    snip = [line.rstrip() for line in snippet.strip("\n").splitlines()]
    while snip and not snip[0].strip():
        snip.pop(0)
    while snip and not snip[-1].strip():
        snip.pop()
    if not snip:
        return None
    lines = [line.rstrip() for line in file_lines]
    width = len(snip)
    hits = [
        index
        for index in range(len(lines) - width + 1)
        if lines[index : index + width] == snip
    ]
    if not hits and _substantive(snip):
        stripped = [line.strip() for line in snip]
        hits = [
            index
            for index in range(len(lines) - width + 1)
            if [line.strip() for line in lines[index : index + width]] == stripped
        ]
    if not hits:
        return None
    best = min(hits, key=lambda index: abs((index + 1) - hint)) if hint else hits[0]
    return best + 1, best + width


def _rewrite_location(
    body: str,
    loc_line: str,
    path: str,
    start: int | None,
    end: int | None,
    real_start: int,
    real_end: int,
) -> str:
    """Point Location at the quote's real span.

    The correction note is the next line, not a suffix of the Location
    line. A suffix made the line unparseable on the verify pass (the
    note was captured as part of the path).
    """
    replacement = f"**Location:** {path}:{real_start}-{real_end}"
    cited_end = end if end is not None else start
    if start is not None and (start != real_start or cited_end != real_end):
        replacement += f"\n_Line numbers corrected from {start}._"
    return body.replace(loc_line, replacement, 1)


def verify_finding(
    heading: str, body: str, root: Path, context: Path | None
) -> tuple[bool, str, str]:
    """Returns (ok, reason, possibly-rewritten body)."""
    if not SEVERITY_RE.match(heading):
        return False, "heading lacks CRITICAL/MAJOR/MINOR", body
    loc_line = next((line for line in body.splitlines() if LOCATION_LINE_RE.match(line)), None)
    if loc_line is None:
        return False, "no **Location:** line", body
    parsed = LOCATION_LINE_RE.match(loc_line)
    assert parsed is not None
    path, start, end = parse_location(parsed.group(1))
    snippet = first_fence(body)
    if snippet is None or not snippet.strip():
        return False, "no verbatim code fence", body

    if path.upper() == "PR":
        if context is None or not context.is_file():
            return False, "Location PR but no pr-context.md", body
        context_text = normalize(context.read_text(encoding="utf-8", errors="replace"))
        if normalize(snippet).strip() not in context_text:
            return False, "PR-level quote not found in pr-context.md", body
        return True, "", body

    if path.startswith("/") or path.startswith("~") or ".." in Path(path).parts:
        return False, f"path escapes checkout: {path}", body
    root_resolved = root.resolve()
    target = (root / path).resolve()
    if target != root_resolved and root_resolved not in target.parents:
        return False, f"path escapes checkout: {path}", body
    if not target.is_file():
        return False, f"file does not exist: {path}", body
    file_lines = target.read_text(encoding="utf-8", errors="replace").splitlines()
    span = find_snippet(file_lines, snippet, start)
    if span is None:
        return False, "quoted code not found verbatim in file", body
    real_start, real_end = span
    rewritten = _rewrite_location(body, loc_line, path, start, end, real_start, real_end)
    return True, "", rewritten


def _write_not_reviewed(dst: Path, body: str) -> None:
    text = NOT_REVIEWED_MARKER + "\n" + body.strip() + "\n"
    dst.write_text(text, encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv
    parser = argparse.ArgumentParser()
    parser.add_argument("review")
    parser.add_argument("output")
    parser.add_argument("--context", type=Path, default=None)
    namespace = parser.parse_args(argv[1:])
    src = Path(namespace.review)
    dst = Path(namespace.output)
    context = namespace.context
    # Raw model output can contain invalid bytes; degrade instead of crashing.
    text = src.read_text(encoding="utf-8", errors="replace")
    _preamble, findings, tail = split_findings(text)
    root = Path.cwd()

    if not findings:
        if UNPARSEABLE_HINT_RE.search(text):
            _write_not_reviewed(
                dst,
                "**Review format error:** the model produced finding-like content "
                "that was not in the required `### SEVERITY:` format. Raw output is "
                "in the workflow artifact `review-raw`. Treat this PR as NOT reviewed.",
            )
            print("unparseable findings format — treat as NOT reviewed")
            return 1
        dst.write_text(text, encoding="utf-8")
        print("no findings — published unchanged")
        return 0

    kept: list[str] = []
    dropped: list[tuple[str, str, str]] = []
    for heading, body in findings:
        ok, reason, new_body = verify_finding(heading, body, root, context)
        if ok:
            kept.append(f"### {heading}\n{new_body.strip()}")
        else:
            loc = next((line for line in body.splitlines() if LOCATION_LINE_RE.match(line)), "")
            dropped.append((heading, reason, loc))
            print(f"dropped finding ({reason}): {heading}")

    parts: list[str] = []
    # Process narration in the preamble is noise and, on PR #224, sat above
    # the "no findings" stub so the comment looked like a finished review.
    # Keep the verdict tail; drop the preamble.
    if kept:
        parts.append("\n\n".join(kept))
    else:
        parts.append(
            f"**No finding could be grounded** ({len(findings)} produced, all failed "
            "verification — see below). Treat this PR as NOT reviewed rather than clean."
        )
    if dropped:
        rows = "\n".join(
            f"- **{heading}** — {reason}"
            + (
                f" (`{loc.split('**Location:**', 1)[-1].strip()}`)"
                if loc
                else ""
            )
            for heading, reason, loc in dropped
        )
        parts.append(
            f"<details><summary>{len(dropped)} unverified finding(s) dropped by the grounding check</summary>\n\n"
            "These could not be matched to code on HEAD. They may be hallucinations — or real issues "
            "with a formatting slip. Check the CRITICAL/MAJOR ones by hand.\n\n"
            + rows
            + "\n\n</details>"
        )
    if tail.strip():
        parts.append(tail.strip())
    body = "\n\n".join(parts) + "\n"
    if not kept:
        _write_not_reviewed(dst, body)
        print(f"0 of {len(findings)} findings survived — treat as NOT reviewed")
        return 1
    dst.write_text(body, encoding="utf-8")
    print(f"{len(kept)} of {len(findings)} findings survived")
    return 0


if __name__ == "__main__":
    sys.exit(main())

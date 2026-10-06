#!/usr/bin/env python3
"""Verify that opencode-review findings are mechanically grounded.

The review prompt forces a machine-checkable format per finding:
  ### SEVERITY: short title
  **Location:** path/to/file.ext:12-34
  ```<language>
  <the exact cited lines, quoted verbatim>
  ```

For each finding this script verifies, against the checkout:
  (a) the file exists,
  (b) the cited lines are inside the real file length,
  (c) the quoted code appears verbatim in the file (only trailing
      whitespace is normalized).

Findings failing any check are removed before the review is posted. If
findings existed but none survive, the output is a stub saying so. A
review with no findings ("nothing material") is published unchanged —
unless it contains finding-like content that ignored the mandated format,
in which case nothing is published (fail closed).

Usage: python3 verify-review-grounding.py <review.md> <output.md>
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

FINDING_RE = re.compile(r"^###\s+(.+)$")
LOCATION_RE = re.compile(r"^\*\*Location:\*\*\s*(\S+?)(?::(\d+)(?:-(\d+))?)?\s*$")
FENCE_OPEN_RE = re.compile(r"^```[a-zA-Z0-9+#.\-]*\s*$")

# Finding-like content that is NOT in the mandated `### SEVERITY:` format:
# a markdown heading carrying a severity word, a bold severity heading, or
# a **Location:** line. Used to tell "nothing material" apart from a model
# that ignored the format — the latter must not be published as-is.
UNPARSEABLE_HINT_RE = re.compile(
    r"^(?:#{1,6}\s+.*\b(?:CRITICAL|MAJOR|MINOR)\b"
    r"|\*\*(?:CRITICAL|MAJOR|MINOR)\b"
    r"|\*\*Location:\*\*)",
    re.IGNORECASE | re.MULTILINE,
)


def normalize(text: str) -> str:
    # Only trailing whitespace is normalized; indentation and content stay.
    return "\n".join(line.rstrip() for line in text.splitlines())


def split_findings(text: str) -> tuple[str, list[tuple[str, str]]]:
    """Return (preamble, [(heading, body), ...]) split on `### ` headings.

    Heading detection skips lines inside fenced code blocks: a verbatim
    quote may itself contain a line starting with `### ` (common when a
    finding quotes markdown), and that must not split the finding.
    """
    preamble_lines: list[str] = []
    findings: list[tuple[str, str]] = []
    current_heading: str | None = None
    current_body: list[str] = []
    in_fence = False

    def emit(line: str) -> None:
        if current_heading is None:
            preamble_lines.append(line)
        else:
            current_body.append(line)

    for line in text.splitlines():
        if not in_fence and FENCE_OPEN_RE.match(line):
            in_fence = True
            emit(line)
        elif in_fence and line.strip() == "```":
            in_fence = False
            emit(line)
        elif in_fence:
            emit(line)
        else:
            match = FINDING_RE.match(line)
            if match:
                if current_heading is not None:
                    findings.append((current_heading, "\n".join(current_body)))
                current_heading = match.group(1).strip()
                current_body = []
            else:
                emit(line)
    if current_heading is not None:
        findings.append((current_heading, "\n".join(current_body)))
    return "\n".join(preamble_lines), findings


def extract_location(body: str) -> tuple[str, int | None, int | None] | None:
    for line in body.splitlines():
        match = LOCATION_RE.match(line)
        if match:
            path = match.group(1)
            start = int(match.group(2)) if match.group(2) else None
            end = int(match.group(3)) if match.group(3) else start
            return path, start, end
    return None


def extract_first_fence(body: str) -> str | None:
    """Return the first fenced code block (the verbatim quote), or None."""
    lines = body.splitlines()
    in_fence = False
    collected: list[str] = []
    for line in lines:
        if not in_fence:
            if FENCE_OPEN_RE.match(line):
                in_fence = True
        elif line.strip() == "```":
            return "\n".join(collected)
        else:
            collected.append(line)
    return None


def verify_finding(heading: str, body: str, root: Path) -> tuple[bool, str]:
    location = extract_location(body)
    if location is None:
        return False, "no **Location:** line"
    path, start, end = location
    target = root / path
    if not target.is_file():
        return False, f"file does not exist: {path}"
    snippet = extract_first_fence(body)
    if snippet is None or not snippet.strip():
        return False, "no verbatim code fence"
    file_lines = target.read_text(encoding="utf-8", errors="replace").splitlines()
    total = len(file_lines)
    if start is not None:
        if not 1 <= start <= total:
            return False, f"start line {start} outside file ({total} lines)"
        if end is not None and not start <= end <= total:
            return False, f"line range {start}-{end} outside file ({total} lines)"
    if normalize(snippet) not in normalize("\n".join(file_lines)):
        return False, "quoted code not found verbatim in file"
    return True, ""


def main() -> int:
    if len(sys.argv) != 3:
        print(
            "usage: verify-review-grounding.py <review.md> <output.md>",
            file=sys.stderr,
        )
        return 2
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    # Raw model output can contain invalid bytes; degrade instead of failing.
    text = src.read_text(encoding="utf-8", errors="replace")
    preamble, findings = split_findings(text)
    root = Path.cwd()
    if not findings:
        if UNPARSEABLE_HINT_RE.search(text):
            # Finding-like content that ignored the mandated format: fail
            # closed instead of publishing it as "nothing material".
            stub = (
                "**Review not published:** the model produced finding-like "
                "content but no findings in the required `### SEVERITY:` "
                "format, so nothing was posted."
            )
            dst.write_text(stub + "\n", encoding="utf-8")
            print("unparseable findings format — wrote not-published stub")
            return 0
        # "Nothing material" review — publish as-is.
        dst.write_text(text, encoding="utf-8")
        print("no findings — published review unchanged")
        return 0
    kept: list[str] = []
    for heading, body in findings:
        ok, reason = verify_finding(heading, body, root)
        if ok:
            kept.append(f"### {heading}\n{body}")
        else:
            print(f"dropped finding ({reason}): {heading}")
    if not kept:
        stub = (
            (preamble + "\n\n" if preamble.strip() else "")
            + "**No findings survived mechanical verification.** "
            + f"All {len(findings)} finding(s) cited files that do not exist, "
            + "line numbers outside the file, or code that does not appear "
            + "verbatim — dropped as ungrounded."
        )
        dst.write_text(stub.strip() + "\n", encoding="utf-8")
        print(f"0 of {len(findings)} findings survived — wrote stub")
    else:
        out = (preamble + "\n\n" if preamble.strip() else "") + "\n\n".join(kept) + "\n"
        dst.write_text(out, encoding="utf-8")
        print(f"{len(kept)} of {len(findings)} findings survived")
    return 0


if __name__ == "__main__":
    sys.exit(main())

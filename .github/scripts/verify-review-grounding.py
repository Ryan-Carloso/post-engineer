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
4. Never hides a finding. A finding whose quote is found stays in the
   main list. A finding whose file or lines cannot be matched is posted
   in full under ``## Unverified findings — location could not be matched``,
   with the location exactly as the model cited it and a best-guess file
   when one can be resolved. The guess cleans the cited path (backticks,
   quotes, commas, trailing punctuation, ``:line`` suffixes, ``./``
   prefixes) and, failing that, matches a unique basename against
   ``--files``. When every finding is unverified, or the model ignored
   the ``### SEVERITY:`` format, the output starts with
   ``<!-- review-grounding: not-reviewed -->`` and the process exits 1.
   A fully unverified review must not look like a clean pass. A review
   that states there is nothing to report, with no finding-like markup,
   is published unchanged and exits 0.

Usage:
    python3 verify-review-grounding.py <review.md> <output.md> \\
        [--context pr-context.md] [--files pr-files.txt]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import NamedTuple

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

# Visible section for findings whose cited file or lines could not be
# matched. The heading is English, like every other script-generated line
# that lands in the posted comment.
UNVERIFIED_SECTION_HEADING = "## Unverified findings — location could not be matched"

# Appended on its own line when a messy citation was resolved to a
# different repo path. Not a suffix of the Location line.
PATH_RESOLVED_NOTE = "_Path resolved from the cited location._"

# `:12`, `:12-34`, and `#L12` / `#L12-L34` are line suffixes, not part of
# the path. Trailing punctuation is stripped before this runs so
# `file.ts:12.` still yields `file.ts`.
_LINE_SUFFIX_RE = re.compile(
    r"(?:#L\d+(?:-L?\d+)?|:\d+(?:\s*[-–]\s*\d+)?)\s*$"
)
_TRAILING_PUNCT_RE = re.compile(r"[.,;:)\]}]+$")
_WRAP_CHARS = "`'\"<>, \t"


class Check(NamedTuple):
    """Outcome of verifying one finding.

    ``guess`` is a repo-relative file the citation resolved to when the
    quote itself could not be verified. ``guess_how`` says how, so the
    posted note can name the rule. Matched findings leave both empty.
    """

    ok: bool
    reason: str
    body: str
    guess: str | None = None
    guess_how: str = "none"


def normalize(text: str) -> str:
    return "\n".join(line.rstrip() for line in text.splitlines())


def _is_escape(path: str) -> bool:
    """True when ``path`` must not be opened (absolute, home, or ``..``)."""
    return (
        path.startswith("/")
        or path.startswith("~")
        or ".." in Path(path).parts
    )


def _normalize_rel(path: str) -> str:
    value = path.strip()
    while value.startswith("./"):
        value = value[2:]
    return value


def clean_location_token(raw: str) -> str:
    """Strip wrapping noise but keep a ``:line`` suffix for ``parse_location``.

    Strips a markdown-link target, a copied correction note, wrapping
    backticks, quotes, angle brackets, and commas, trailing punctuation,
    and ``./`` prefixes.
    """
    value = raw.strip()
    value = CORRECTION_SUFFIX_RE.sub("", value).strip()
    link = re.match(r"^\[[^\]]*\]\(([^)]+)\)$", value)
    if link:
        value = link.group(1).strip()
    previous = None
    while previous != value:
        previous = value
        value = value.strip(_WRAP_CHARS)
        value = _TRAILING_PUNCT_RE.sub("", value)
    return _normalize_rel(value)


def clean_cited_path(raw: str) -> str:
    """``clean_location_token`` plus the ``:line`` / ``#L`` suffix removed."""
    value = clean_location_token(raw)
    value = _LINE_SUFFIX_RE.sub("", value)
    value = _TRAILING_PUNCT_RE.sub("", value)
    return _normalize_rel(value)


def _contained_file(root: Path, rel: str) -> Path | None:
    """The file at ``rel`` when it stays inside ``root``. Never follows ``..``."""
    if not rel or _is_escape(rel):
        return None
    root_resolved = root.resolve()
    target = (root / rel).resolve()
    if target != root_resolved and root_resolved not in target.parents:
        return None
    if not target.is_file():
        return None
    return target


def load_changed_files(path: Path | None) -> list[str]:
    """Repo-relative paths from ``--files``, one per line. Missing file → []."""
    if path is None or not path.is_file():
        return []
    items: list[str] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        rel = _normalize_rel(line.strip())
        if not rel or _is_escape(rel):
            continue
        items.append(rel)
    return items


def _basename_matches(cleaned: str, changed: list[str]) -> list[str]:
    base = Path(cleaned).name
    if not base or base in {".", ".."}:
        return []
    return [rel for rel in changed if Path(rel).name == base]


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
    note_path: bool,
) -> str:
    """Point Location at the quote's real span.

    Notes are the following lines, not a suffix of the Location line. A
    suffix made the line unparseable on the verify pass (the note was
    captured as part of the path).
    """
    replacement = f"**Location:** {path}:{real_start}-{real_end}"
    notes: list[str] = []
    if note_path:
        notes.append(PATH_RESOLVED_NOTE)
    cited_end = end if end is not None else start
    if start is not None and (start != real_start or cited_end != real_end):
        notes.append(f"_Line numbers corrected from {start}._")
    if notes:
        replacement += "\n" + "\n".join(notes)
    return body.replace(loc_line, replacement, 1)


def _match_quote(
    rel: str,
    start: int | None,
    end: int | None,
    snippet: str,
    body: str,
    loc_line: str,
    root: Path,
    cited_path: str,
) -> str | None:
    """Rewritten body when ``snippet`` is in ``rel``, else None."""
    target = _contained_file(root, rel)
    if target is None:
        return None
    file_lines = target.read_text(encoding="utf-8", errors="replace").splitlines()
    span = find_snippet(file_lines, snippet, start)
    if span is None:
        return None
    real_start, real_end = span
    publish = _normalize_rel(rel)
    return _rewrite_location(
        body,
        loc_line,
        publish,
        start,
        end,
        real_start,
        real_end,
        note_path=publish != _normalize_rel(cited_path),
    )


def _fail(reason: str, body: str, guess: str | None = None, how: str = "none") -> Check:
    return Check(False, reason, body, guess, how)


def verify_finding(
    heading: str,
    body: str,
    root: Path,
    context: Path | None,
    changed: list[str] | None = None,
) -> Check:
    """Verify one finding. The returned body is rewritten only when it matches."""
    changed_files = changed if changed is not None else []
    if not SEVERITY_RE.match(heading):
        return _fail("heading lacks CRITICAL/MAJOR/MINOR", body)
    loc_line = next((line for line in body.splitlines() if LOCATION_LINE_RE.match(line)), None)
    if loc_line is None:
        return _fail("no **Location:** line", body)
    parsed = LOCATION_LINE_RE.match(loc_line)
    assert parsed is not None
    raw_location = parsed.group(1)
    path, start, end = parse_location(raw_location)
    snippet = first_fence(body)
    if snippet is None or not snippet.strip():
        return _fail("no verbatim code fence", body)

    if path.upper() == "PR":
        if context is None or not context.is_file():
            return _fail("Location PR but no pr-context.md", body)
        context_text = normalize(context.read_text(encoding="utf-8", errors="replace"))
        if normalize(snippet).strip() not in context_text:
            return _fail("PR-level quote not found in pr-context.md", body)
        return Check(True, "", body)

    if _is_escape(path):
        # Do not open the escaped path. A unique basename among changed
        # files can still ground the quote, or serve as a best guess.
        return _resolve_fuzzy(
            raw_location,
            path,
            start,
            end,
            snippet,
            body,
            loc_line,
            root,
            changed_files,
            f"path escapes checkout: {path}",
            allow_cleaned_file=False,
        )

    publish = _normalize_rel(path)
    if _contained_file(root, publish) is not None:
        rewritten = _match_quote(
            publish, start, end, snippet, body, loc_line, root, path
        )
        if rewritten is not None:
            return Check(True, "", rewritten)
        # The cited file is real. Do not substitute a different basename.
        return _fail(
            "quoted code not found verbatim in file",
            body,
            publish,
            "file",
        )

    return _resolve_fuzzy(
        raw_location,
        path,
        start,
        end,
        snippet,
        body,
        loc_line,
        root,
        changed_files,
        f"file does not exist: {path}",
        allow_cleaned_file=True,
    )


def _resolve_fuzzy(
    raw_location: str,
    cited_path: str,
    start: int | None,
    end: int | None,
    snippet: str,
    body: str,
    loc_line: str,
    root: Path,
    changed: list[str],
    failure_reason: str,
    allow_cleaned_file: bool,
) -> Check:
    """Try a cleaned path, then a unique basename. Never invent a match."""
    token = clean_location_token(raw_location)
    cleaned_path, cleaned_start, cleaned_end = (
        parse_location(token) if token else ("", None, None)
    )
    cleaned_path = _normalize_rel(_LINE_SUFFIX_RE.sub("", cleaned_path))
    line_start = cleaned_start if cleaned_start is not None else start
    line_end = cleaned_end if cleaned_end is not None else end

    if (
        allow_cleaned_file
        and cleaned_path
        and cleaned_path != _normalize_rel(cited_path)
        and not _is_escape(cleaned_path)
        and _contained_file(root, cleaned_path) is not None
    ):
        rewritten = _match_quote(
            cleaned_path,
            line_start,
            line_end,
            snippet,
            body,
            loc_line,
            root,
            cited_path,
        )
        if rewritten is not None:
            return Check(True, "", rewritten)
        return _fail(
            "quoted code not found verbatim in file",
            body,
            cleaned_path,
            "file",
        )

    base_source = cleaned_path or _normalize_rel(cited_path)
    if _is_escape(base_source):
        base_source = Path(base_source).name
    matches = _basename_matches(base_source, changed)
    if len(matches) == 1:
        guess = matches[0]
        rewritten = _match_quote(
            guess,
            line_start,
            line_end,
            snippet,
            body,
            loc_line,
            root,
            cited_path,
        )
        if rewritten is not None:
            return Check(True, "", rewritten)
        return _fail(failure_reason, body, guess, "basename")
    if len(matches) > 1:
        return _fail(failure_reason, body, None, "ambiguous")
    return _fail(failure_reason, body, None, "none")


def _write_not_reviewed(dst: Path, body: str) -> None:
    text = NOT_REVIEWED_MARKER + "\n" + body.strip() + "\n"
    dst.write_text(text, encoding="utf-8")


def _guess_note(check: Check) -> str:
    """English note naming the best-guess file, or that there is none."""
    if check.guess_how == "ambiguous":
        return (
            "_Best guess: none. More than one changed file shares that basename._"
        )
    if check.guess and check.guess_how == "basename":
        return (
            f"_Best guess: `{check.guess}` (unique basename match among changed files). "
            "The quoted lines were not found there, so this finding stays unverified._"
        )
    if check.guess and check.guess_how == "file":
        return (
            f"_Best guess: `{check.guess}` (cited path cleaned to a file in the checkout). "
            "The quoted lines were not found there, so this finding stays unverified._"
        )
    return (
        "_Best guess: none. The cited path is not a file in the checkout, and no "
        "unique basename matched a changed file._"
    )


def render_unverified(items: list[tuple[str, Check]]) -> str:
    """Full text of every unverified finding, location unchanged."""
    blocks: list[str] = []
    for heading, check in items:
        blocks.append(
            f"### {heading}\n{check.body.strip()}\n\n"
            f"_Not verified: {check.reason}._\n"
            f"{_guess_note(check)}"
        )
    intro = (
        f"{UNVERIFIED_SECTION_HEADING}\n\n"
        "These findings could not be matched to the cited file and lines. "
        "Each block is the model's full text, including its severity heading. "
        "The location line is exactly what the model cited. "
        "They are not in the verified list."
    )
    return intro + "\n\n" + "\n\n".join(blocks)


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv
    parser = argparse.ArgumentParser()
    parser.add_argument("review")
    parser.add_argument("output")
    parser.add_argument("--context", type=Path, default=None)
    parser.add_argument(
        "--files",
        type=Path,
        default=None,
        help="changed files, one repo-relative path per line, for basename guesses",
    )
    namespace = parser.parse_args(argv[1:])
    src = Path(namespace.review)
    dst = Path(namespace.output)
    context = namespace.context
    if namespace.files is not None and not namespace.files.is_file():
        print(f"changed-file list not found: {namespace.files}", file=sys.stderr)
    changed = load_changed_files(namespace.files)
    # Raw model output can contain invalid bytes; degrade instead of crashing.
    text = src.read_text(encoding="utf-8", errors="replace")
    _preamble, findings, tail = split_findings(text)
    root = Path.cwd()

    if not findings:
        if UNPARSEABLE_HINT_RE.search(text):
            _write_not_reviewed(
                dst,
                "**Review format error:** the model produced finding-like content "
                "that was not in the required `### SEVERITY:` format. "
                "Treat this PR as NOT reviewed.\n\n"
                f"{UNVERIFIED_SECTION_HEADING}\n\n"
                "The model did not use `### SEVERITY:`, so the location could not "
                "be matched. The text below is the model output, unchanged.\n\n"
                + text.strip(),
            )
            print("unparseable findings format — treat as NOT reviewed")
            return 1
        dst.write_text(text, encoding="utf-8")
        print("no findings — published unchanged")
        return 0

    kept: list[str] = []
    unverified: list[tuple[str, Check]] = []
    for heading, body in findings:
        check = verify_finding(heading, body, root, context, changed)
        if check.ok:
            kept.append(f"### {heading}\n{check.body.strip()}")
        else:
            unverified.append((heading, check))
            print(f"unverified finding ({check.reason}): {heading}")

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
    if unverified:
        parts.append(render_unverified(unverified))
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

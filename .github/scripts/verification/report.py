"""Render the verification evidence table.

The comment is the evidence. Cells are shortened and never include a file
body, so a skipped test line cannot leak a secret into the pull request.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_HERE = str(Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from scope import SUITE_COMMANDS

MARKER = "<!-- verification-evidence -->"
_COLLECT = "python3 .github/scripts/verification/collect.py"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render verification evidence markdown.")
    parser.add_argument("--honesty", required=True)
    parser.add_argument("--suites", default="")
    parser.add_argument("--markdown", required=True)
    args = parser.parse_args(argv)

    honesty = json.loads(Path(args.honesty).read_text(encoding="utf-8"))
    suites: dict = {}
    if args.suites:
        suites_path = Path(args.suites)
        if suites_path.is_file():
            suites = json.loads(suites_path.read_text(encoding="utf-8") or "{}")
    markdown, ok = render(honesty, suites)
    destination = Path(args.markdown)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(markdown, encoding="utf-8")
    for finding in honesty.get("findings") or []:
        level = "error" if finding["severity"] == "fail" else "warning"
        path = finding.get("path") or ".github/REVIEW_RUBRIC.md"
        message = str(finding["message"]).replace("\n", " ")
        print(f"::{level} file={path},line={finding.get('line', 1)}::{message}")
    print(markdown)
    return 0 if ok else 1


def render(honesty: dict, suites: dict) -> tuple[str, bool]:
    ok = bool(honesty.get("ok"))
    lines = [
        MARKER,
        "## Verification evidence",
        "",
        _source_sentence(str(honesty.get("grader_source") or "head")),
        f"Base: `{honesty.get('base', '')}`",
        f"Head: `{honesty.get('head', '')}`",
        f"Changed files: {honesty.get('changed_count', 0)}",
        "",
        "| Check | Command | Result | Evidence |",
        "| --- | --- | --- | --- |",
    ]
    findings = list(honesty.get("findings") or [])
    fail_count = sum(1 for finding in findings if finding["severity"] == "fail")
    warn_count = sum(1 for finding in findings if finding["severity"] == "warn")
    lines.append(_row(
        "test honesty",
        _COLLECT,
        "fail" if fail_count else "pass",
        f"{fail_count} failure(s), {warn_count} warning(s)",
    ))

    for name in honesty.get("local_suites") or []:
        command = SUITE_COMMANDS.get(name, name)
        result = suites.get(name)
        if not isinstance(result, dict) or "exit_code" not in result:
            ok = False
            lines.append(_row(
                f"diff-scoped tests ({name})",
                command,
                "fail",
                "selected suite did not run",
            ))
            continue
        code = int(result["exit_code"])
        if code != 0:
            ok = False
        lines.append(_row(
            f"diff-scoped tests ({name})",
            command,
            "pass" if code == 0 else "fail",
            f"exit {code}; {_summary_line(str(result.get('excerpt') or ''))}",
        ))

    delegated = list(honesty.get("delegated") or [])
    for item in delegated:
        lines.append(_row(
            f"diff-scoped tests ({item['area']})",
            str(item["command"]),
            "delegated",
            f"not re-run here; existing CI job {item['ci_job']} covers this area",
        ))
    if not honesty.get("local_suites") and not delegated:
        lines.append(_row(
            "diff-scoped tests",
            "(none)",
            "not-applicable",
            "no mapped runtime suite for this diff",
        ))

    lines.extend(["", "### Findings", ""])
    if not findings:
        lines.append("None.")
    else:
        for finding in findings[:40]:
            where = finding.get("path") or "diff"
            lines.append(
                f"- **{finding['severity']}** `{finding['code']}` "
                f"`{where}:{finding.get('line', 1)}` — {_cell(str(finding['message']), 400)}"
            )
    paths = list(honesty.get("changed_paths") or [])
    if paths:
        lines.extend(["", "<details>", "<summary>Changed paths</summary>", ""])
        for path in paths:
            lines.append(f"- `{_cell(str(path), 200)}`")
        lines.extend(["", "</details>"])
    lines.extend([
        "",
        "Numeric patch coverage is Codecov's 80% patch target and 2% project threshold "
        "in the existing web, engine, and mcp jobs. This table does not invent a coverage percentage.",
        "",
    ])
    return "\n".join(lines), ok


def _source_sentence(source: str) -> str:
    if source == "base":
        return (
            "Grader source: `base`. This pull request was graded by the script on the "
            "base commit, which the pull request cannot edit."
        )
    return (
        "Grader source: `head`. The base commit has no grader script yet, so this "
        "pull request is graded by the copy it adds. After merge, later pull requests "
        "are graded by that base copy."
    )


def _summary_line(excerpt: str) -> str:
    cleaned = excerpt.replace("```", "'''")
    for line in reversed(cleaned.splitlines()):
        stripped = line.strip()
        if stripped and ("passed" in stripped or "failed" in stripped or "error" in stripped):
            return _cell(stripped, 180)
    for line in reversed(cleaned.splitlines()):
        if line.strip():
            return _cell(line.strip(), 180)
    return "no output"


def _row(check: str, command: str, result: str, evidence: str) -> str:
    return f"| {_cell(check, 80)} | `{_cell(command, 240)}` | {result} | {_cell(evidence, 240)} |"


def _cell(text: str, limit: int) -> str:
    cleaned = text.replace("|", "/").replace("\n", " ").replace("`", "'")
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 3] + "..."


if __name__ == "__main__":
    sys.exit(main())

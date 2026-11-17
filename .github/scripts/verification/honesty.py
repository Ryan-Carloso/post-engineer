"""Diff checks that flag tests deleted, skipped, or weakened to go green.

The grader reads file text from both sides of the diff. It never copies
file bodies into findings: a skip line can carry a secret, and the evidence
comment would republish it.
"""

from __future__ import annotations

import difflib
import re
import sys
from dataclasses import dataclass
from pathlib import Path

_HERE = str(Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from scope import is_product_code, is_test_path, production_candidates, test_candidates

PROTECTED = (
    ".github/REVIEW_RUBRIC.md",
    ".github/workflows/verification.yml",
    ".github/scripts/verification/collect.py",
    ".github/scripts/verification/honesty.py",
    ".github/scripts/verification/scope.py",
    ".github/scripts/verification/report.py",
    ".cursor/skills/review/SKILL.md",
)

# Strong assertions name an expected value. Weak ones only check truthiness,
# so a rewrite that swaps the first for the second can stay green while the
# test stops pinning the behavior.
_STRONG = re.compile(
    r"\.toEqual\s*\(|\.toStrictEqual\s*\(|\.toBe\s*\(|\.toThrow\s*\(|"
    r"\.toHaveBeenCalled|\.toContain\s*\(|\.toMatch(?:Object|Snapshot)?\s*\(|"
    r"\bassert(?:Equal|Equals|DictEqual|ListEqual|SetEqual|In|Raises|AlmostEqual)\b|"
    r"pytest\.raises\s*\("
)
_WEAK = re.compile(
    r"\.toBeTruthy\s*\(|\.toBeFalsy\s*\(|\.toBeDefined\s*\(|"
    r"\bassert(?:True|False|IsNotNone)\b|"
    r"\bassert\s+(?:True|False)\b"
)
_ASSERTION = re.compile(
    r"\bexpect\s*\(|"
    r"\bassert(?:Equal|Equals|True|False|Raises|In|Is|Dict|List|Set|Almost|Greater|Less|Regex)?\b|"
    r"\.to(?:Be|Equal|StrictEqual|Throw|Have|Contain|Match)[A-Za-z]*\s*\(|"
    r"pytest\.raises\s*\("
)
_PY_TEST = re.compile(r"(?m)^[ \t]*def (test_[A-Za-z0-9_]+)[ \t]*\(")
_TS_TEST = re.compile(
    r"(?m)^[ \t]*(?:it|test|describe)(?:\.(?:only|skip|todo|each|concurrent))?"
    r"[ \t]*\([ \t]*['\"]([^'\"]+)['\"]"
)
_FAIL_UNDER = re.compile(r"(?m)^fail_under\s*=\s*(\d+)\s*$")
_THRESHOLD = re.compile(r"threshold:\s*(\d+(?:\.\d+)?)%")
_TARGET = re.compile(r"target:\s*(\d+(?:\.\d+)?)%")
_VITEST_FLOOR = re.compile(
    r"\b(?:lines|statements|branches|functions|perFile)\s*:\s*(\d+(?:\.\d+)?)"
)
_INFO_TRUE = re.compile(r"informational:\s*true")

# Unconditional skips and exclusive focus hide every other case. Conditional
# skips (missing ffmpeg, an opt-in integration flag) are warnings: they are
# visible, and they do not fail a job that still runs the rest of the suite.
_UNCONDITIONAL: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("test-skipped", re.compile(r"\b(?:it|test|describe)\.(?:skip|todo)\s*\(")),
    ("test-skipped", re.compile(r"\bx(?:it|test|describe)\s*\(")),
    ("test-skipped", re.compile(r"@pytest\.mark\.skip\b(?!\s*if)")),
    ("test-skipped", re.compile(r"@unittest\.skip\s*\(")),
    ("test-skipped", re.compile(r"(?<![\w.])pytest\.skip\s*\(")),
    ("test-focused", re.compile(r"\b(?:it|test|describe)\.only\s*\(")),
    ("test-focused", re.compile(r"\bf(?:it|describe)\s*\(")),
)
_CONDITIONAL: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("test-skip-conditional", re.compile(r"@pytest\.mark\.skipif\b")),
    ("test-skip-conditional", re.compile(r"pytest\.mark\.skipif\s*\(")),
    ("test-skip-conditional", re.compile(r"@unittest\.skip(?:If|Unless)\b")),
)
_PRAGMA = re.compile(r"pragma:\s*no cover|istanbul ignore|c8 ignore|v8 ignore")

_COVERAGE_PATHS = {"codecov.yml", "apps/engine/pyproject.toml"}
_MAX_FINDINGS = 40


@dataclass(frozen=True)
class FileChange:
    path: str
    status: str
    base_text: str = ""
    head_text: str = ""
    old_path: str = ""


@dataclass(frozen=True)
class Finding:
    severity: str
    code: str
    path: str
    message: str
    line: int = 1

    def as_dict(self) -> dict[str, str | int]:
        return {
            "severity": self.severity,
            "code": self.code,
            "path": self.path,
            "message": self.message,
            "line": self.line,
        }


def analyze(changes: list[FileChange], exists) -> list[Finding]:
    """Return fail and warn findings. `exists(path)` reads the head tree."""
    findings: list[Finding] = []
    untested = 0
    for change in changes:
        findings.extend(_protected(change))
        findings.extend(_workflow_safety(change))
        findings.extend(_coverage_config(change))
        if change.status in {"M", "R"} and is_test_path(change.path):
            findings.extend(_test_edits(change))
        if change.status == "A" and is_test_path(change.path):
            findings.extend(_added_patterns(change.path, "", change.head_text))
        if change.status == "D" and is_test_path(change.path):
            findings.extend(_deleted_test_file(change, exists))
        if (
            change.status in {"A", "M"}
            and is_product_code(change.path)
            and untested < 15
            and not any(exists(candidate) for candidate in test_candidates(change.path))
        ):
            untested += 1
            findings.append(Finding(
                "warn",
                "coverage-untested",
                change.path,
                "no mapped test file on disk for this changed product file",
                1,
            ))
    if len(findings) > _MAX_FINDINGS:
        extra = len(findings) - _MAX_FINDINGS
        findings = findings[:_MAX_FINDINGS]
        findings.append(Finding(
            "warn",
            "findings-truncated",
            "",
            f"{extra} additional findings omitted from the comment",
            1,
        ))
    return findings


def _protected(change: FileChange) -> list[Finding]:
    if change.path not in PROTECTED:
        return []
    if change.status == "D":
        return [Finding(
            "fail",
            "verifier-deleted",
            change.path,
            "deleting the grader, the rubric, or the review skill removes the check that judges this change",
            1,
        )]
    if change.status in {"M", "R"}:
        return [Finding(
            "warn",
            "verifier-changed",
            change.path,
            "this pull request edits a verifier file; the grade uses the base copy when that copy exists",
            1,
        )]
    return []


def _workflow_safety(change: FileChange) -> list[Finding]:
    if change.path != ".github/workflows/verification.yml" or change.status not in {"A", "M", "R"}:
        return []
    findings: list[Finding] = []
    for line_no, line in _added_lines(change.base_text, change.head_text):
        if _is_comment(line):
            continue
        if "pull_request_target" in line:
            findings.append(Finding(
                "fail",
                "verifier-unsafe",
                change.path,
                "verification workflow must use pull_request, so fork code does not run with this repository's secrets",
                line_no,
            ))
        if "secrets." in line:
            findings.append(Finding(
                "fail",
                "verifier-unsafe",
                change.path,
                "verification workflow must not read repository secrets",
                line_no,
            ))
    return findings


def _test_edits(change: FileChange) -> list[Finding]:
    findings = _added_patterns(change.path, change.base_text, change.head_text)
    base_names = _test_names(change.path, change.base_text)
    head_names = _test_names(change.path, change.head_text)
    if len(head_names) < len(base_names):
        missing = _missing(base_names, head_names)
        shown = ", ".join(missing[:5])
        findings.append(Finding(
            "fail",
            "tests-deleted",
            change.path,
            f"test count fell from {len(base_names)} to {len(head_names)} ({shown})",
            1,
        ))
    elif _assertion_count(change.head_text) < _assertion_count(change.base_text):
        findings.append(Finding(
            "fail",
            "assertions-removed",
            change.path,
            (
                f"assertion count fell from {_assertion_count(change.base_text)} "
                f"to {_assertion_count(change.head_text)} without removing a test"
            ),
            1,
        ))
    for line_no in _weakened_line_numbers(change.base_text, change.head_text):
        findings.append(Finding(
            "fail",
            "assertion-weakened",
            change.path,
            "a strong assertion was replaced with a truthiness check",
            line_no,
        ))
    return findings


def _deleted_test_file(change: FileChange, exists) -> list[Finding]:
    candidates = production_candidates(change.path)
    if not candidates:
        return [Finding(
            "warn",
            "tests-deleted-unmapped",
            change.path,
            "test file deleted and no product file was mapped; confirm the whole path was removed",
            1,
        )]
    if any(exists(candidate) for candidate in candidates):
        return [Finding(
            "fail",
            "tests-deleted-file",
            change.path,
            "test file deleted while a mapped product file is still in the tree",
            1,
        )]
    return []


def _added_patterns(path: str, base_text: str, head_text: str) -> list[Finding]:
    findings: list[Finding] = []
    for line_no, line in _added_lines(base_text, head_text):
        if _is_comment(line):
            continue
        for code, pattern in _UNCONDITIONAL:
            if pattern.search(line):
                findings.append(Finding(
                    "fail",
                    code,
                    path,
                    "unconditional skip or exclusive focus added; it hides cases instead of fixing them",
                    line_no,
                ))
                break
        else:
            for code, pattern in _CONDITIONAL:
                if pattern.search(line):
                    findings.append(Finding(
                        "warn",
                        code,
                        path,
                        "conditional skip added; say why the case cannot run in CI",
                        line_no,
                    ))
                    break
        if _PRAGMA.search(line):
            findings.append(Finding(
                "fail",
                "coverage-ignored",
                path,
                "coverage ignore added on a changed test line",
                line_no,
            ))
    return findings


def _coverage_config(change: FileChange) -> list[Finding]:
    if change.status not in {"A", "M", "R"} or not _is_coverage_config(change.path):
        return []
    findings: list[Finding] = []
    if change.path.endswith("pyproject.toml"):
        findings.extend(_series(
            change, "fail_under", _ints(_FAIL_UNDER, change.base_text), _ints(_FAIL_UNDER, change.head_text),
            weaker=lambda old, new: new < old,
        ))
    if change.path == "codecov.yml":
        findings.extend(_series(
            change, "threshold", _floats(_THRESHOLD, change.base_text), _floats(_THRESHOLD, change.head_text),
            weaker=lambda old, new: new > old,
        ))
        findings.extend(_series(
            change, "target", _floats(_TARGET, change.base_text), _floats(_TARGET, change.head_text),
            weaker=lambda old, new: new < old,
        ))
        base_info = len(_INFO_TRUE.findall(change.base_text))
        head_info = len(_INFO_TRUE.findall(change.head_text))
        if head_info > base_info:
            findings.append(Finding(
                "fail",
                "coverage-threshold",
                change.path,
                "coverage status flipped to informational, so a drop no longer fails CI",
                1,
            ))
    if "vitest.config" in change.path:
        findings.extend(_series(
            change, "vitest floor", _floats(_VITEST_FLOOR, change.base_text),
            _floats(_VITEST_FLOOR, change.head_text),
            weaker=lambda old, new: new < old,
        ))
    return findings


def _series(change: FileChange, label: str, base_nums: list[float], head_nums: list[float], weaker) -> list[Finding]:
    if not base_nums and not head_nums:
        return []
    if base_nums and not head_nums:
        return [Finding(
            "fail",
            "coverage-threshold",
            change.path,
            f"{label} coverage floor removed",
            1,
        )]
    if not base_nums or len(base_nums) != len(head_nums):
        if base_nums:
            return [Finding(
                "warn",
                "coverage-config-shape",
                change.path,
                f"{label} coverage settings changed shape; compare them by hand",
                1,
            )]
        return []
    findings: list[Finding] = []
    for old, new in zip(base_nums, head_nums):
        if weaker(old, new):
            findings.append(Finding(
                "fail",
                "coverage-threshold",
                change.path,
                f"{label} loosened from {old:g} to {new:g}",
                1,
            ))
    return findings


def _is_coverage_config(path: str) -> bool:
    return path in _COVERAGE_PATHS or path.endswith("vitest.config.ts") or path.endswith("vitest.config.mjs")


def _test_names(path: str, text: str) -> list[str]:
    if not is_test_path(path):
        return []
    cleaned = _without_comments(text)
    if path.endswith(".py"):
        return _PY_TEST.findall(cleaned)
    if path.endswith((".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")):
        return _TS_TEST.findall(cleaned)
    return []


def _assertion_count(text: str) -> int:
    return sum(1 for line in _without_comments(text).splitlines() if _ASSERTION.search(line))


def _weakened_line_numbers(base: str, head: str) -> list[int]:
    base_lines = base.splitlines()
    head_lines = head.splitlines()
    matcher = difflib.SequenceMatcher(a=base_lines, b=head_lines)
    hits: list[int] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag != "replace":
            continue
        removed = base_lines[i1:i2]
        added = head_lines[j1:j2]
        removed_strong = any(_STRONG.search(line) for line in removed)
        added_strong = any(_STRONG.search(line) for line in added)
        added_weak = any(_WEAK.search(line) for line in added)
        if removed_strong and added_weak and not added_strong:
            hits.append(j1 + 1)
    return hits


def _added_lines(base: str, head: str) -> list[tuple[int, str]]:
    base_lines = base.splitlines()
    head_lines = head.splitlines()
    matcher = difflib.SequenceMatcher(a=base_lines, b=head_lines)
    added: list[tuple[int, str]] = []
    for tag, _i1, _i2, j1, j2 in matcher.get_opcodes():
        if tag in {"insert", "replace"}:
            for offset, line in enumerate(head_lines[j1:j2]):
                added.append((j1 + offset + 1, line))
    return added


def _missing(base: list[str], head: list[str]) -> list[str]:
    counts: dict[str, int] = {}
    for name in head:
        counts[name] = counts.get(name, 0) + 1
    missing: list[str] = []
    for name in base:
        if counts.get(name, 0) > 0:
            counts[name] -= 1
        else:
            missing.append(name)
    return missing


def _without_comments(text: str) -> str:
    kept = [line for line in text.splitlines() if not _is_comment(line)]
    return "\n".join(kept)


def _is_comment(line: str) -> bool:
    stripped = line.strip()
    return (
        stripped.startswith("#")
        or stripped.startswith("//")
        or stripped.startswith("*")
        or stripped.startswith("/*")
    )


def _ints(pattern: re.Pattern[str], text: str) -> list[float]:
    return [float(value) for value in pattern.findall(text)]


def _floats(pattern: re.Pattern[str], text: str) -> list[float]:
    return [float(value) for value in pattern.findall(text)]

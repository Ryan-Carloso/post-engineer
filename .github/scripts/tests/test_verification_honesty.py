"""Pins for the verification grader's rename, truncation, and suite fixes.

Kept apart from test_verification_collect.py so that file stays under the
500-line ratchet. Skip samples are built by joining string parts so this
file's own diff does not contain the patterns it teaches the grader to
catch.
"""

from __future__ import annotations

import sys
from pathlib import Path

VERIFICATION = Path(__file__).resolve().parents[1] / "verification"
if str(VERIFICATION) not in sys.path:
    sys.path.append(str(VERIFICATION))

import honesty  # noqa: E402
import scope  # noqa: E402


def glue(*parts: str) -> str:
    return "".join(parts)


def fails(findings):
    return [finding for finding in findings if finding.severity == "fail"]


def analyze(path, status, base="", head="", exists=None):
    change = honesty.FileChange(path, status, base, head)
    return honesty.analyze([change], exists or (lambda _path: True))


def test_truncated_findings_keep_their_fails():
    base = "def test_ok():\n    assert 1 == 1\n"
    skip = glue("    pytest.", "skip('hidden')\n")
    findings = analyze("apps/engine/test/test_sample.py", "M", base, base + skip * 41)
    truncated = [finding for finding in findings if finding.code == "findings-truncated"]
    assert len(truncated) == 1
    assert truncated[0].severity == "fail"
    assert truncated[0].message == "1 additional findings omitted (1 fail)"
    conditional = glue("    @pytest.mark.", "skipif(True, reason='x')\n")
    warned = analyze("apps/engine/test/test_sample.py", "M", base, base + conditional * 41)
    truncated_warn = [finding for finding in warned if finding.code == "findings-truncated"]
    assert len(truncated_warn) == 1
    assert truncated_warn[0].severity == "warn"
    assert truncated_warn[0].message == "1 additional findings omitted (0 fail)"


def test_rename_out_of_test_collection_is_a_deletion():
    base = "def test_a():\n    assert 1 == 1\n"
    renamed = honesty.FileChange(
        "apps/engine/test/voice_service.py", "R", base, base, "apps/engine/test/test_voice.py"
    )
    with_product = honesty.analyze([renamed], lambda path: path == "apps/engine/app/voice.py")
    assert any(finding.code == "tests-deleted-file" for finding in fails(with_product))
    gone = honesty.analyze([renamed], lambda _path: False)
    assert fails(gone) == []
    assert any(finding.code == "tests-deleted-unmapped" for finding in gone)
    js = honesty.FileChange(
        "apps/web/lib/sample.ts",
        "R",
        "it('works', () => {})\n",
        "it('works', () => {})\n",
        "apps/web/lib/__tests__/sample.test.ts",
    )
    js_findings = honesty.analyze([js], lambda path: path == "apps/web/lib/sample.ts")
    assert any(finding.code == "tests-deleted-file" for finding in fails(js_findings))
    kept = honesty.FileChange(
        "apps/engine/test/test_renamed.py", "R", base, base, "apps/engine/test/test_sample.py"
    )
    assert fails(honesty.analyze([kept], lambda _path: True)) == []


def test_renaming_a_protected_file_fails_like_deleting_it():
    for old in (
        ".github/REVIEW_RUBRIC.md",
        ".cursor/skills/review/SKILL.md",
        ".github/workflows/verification.yml",
    ):
        moved = honesty.FileChange("docs/moved.md", "R", "old\n", "old\n", old)
        findings = honesty.analyze([moved], lambda _path: True)
        assert any(finding.code == "verifier-deleted" for finding in fails(findings)), old
    moved_workflow = honesty.FileChange(
        ".github/workflows/verify-old.yml",
        "R",
        "on:\n  pull_request:\n",
        "on:\n  pull_request_target:\n",
        ".github/workflows/verification.yml",
    )
    findings = honesty.analyze([moved_workflow], lambda _path: True)
    assert any(finding.code == "verifier-deleted" for finding in fails(findings))
    assert any(finding.code == "verifier-unsafe" for finding in fails(findings))
    other = honesty.FileChange("docs/moved.md", "R", "old\n", "old\n", "docs/original.md")
    assert fails(honesty.analyze([other], lambda _path: True)) == []


def test_unpinned_verification_test_file_runs_the_whole_scripts_suite():
    assert scope.local_suites([".github/scripts/tests/test_verification_collect.py"]) == [
        "verification"
    ]
    assert scope.local_suites([".github/scripts/tests/test_verification_workflow.py"]) == [
        "verification"
    ]
    # A future test_verification_*.py file is not in the suite command, so
    # it must fall through to review-scripts instead of claiming the
    # verification suite ran it.
    assert scope.local_suites([".github/scripts/tests/test_verification_report.py"]) == [
        "review-scripts"
    ]
    command = scope.SUITE_COMMANDS["verification"]
    assert "test_verification_collect.py" in command
    assert "test_verification_workflow.py" in command

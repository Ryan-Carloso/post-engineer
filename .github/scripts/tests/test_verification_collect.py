"""Pins for the verification grader.

The grader flags tests that were deleted, skipped, or weakened, and it maps
a diff onto the suite that should run. These tests build skip and pragma
samples by joining string parts so this file's own diff does not contain
the patterns it is teaching the grader to catch.
"""

from __future__ import annotations

import json
import random
import subprocess
import sys
from pathlib import Path

VERIFICATION = Path(__file__).resolve().parents[1] / "verification"
if str(VERIFICATION) not in sys.path:
    sys.path.append(str(VERIFICATION))

import collect
import honesty
import report
import scope

ROOT = Path(__file__).resolve().parents[3]


def glue(*parts: str) -> str:
    return "".join(parts)


def fails(findings):
    return [finding for finding in findings if finding.severity == "fail"]


def analyze(path, status, base="", head="", exists=None):
    change = honesty.FileChange(path, status, base, head)
    return honesty.analyze([change], exists or (lambda _path: True))


def test_grader_sources_do_not_trip_their_own_rules():
    paths = [
        ROOT / ".github/scripts/tests/test_verification_collect.py",
        ROOT / ".github/scripts/tests/test_verification_honesty.py",
        ROOT / ".github/scripts/tests/test_verification_workflow.py",
        ROOT / ".github/workflows/verification.yml",
    ]
    for path in paths:
        rel = path.relative_to(ROOT).as_posix()
        findings = analyze(rel, "A", head=path.read_text(encoding="utf-8"))
        assert fails(findings) == [], (rel, fails(findings))


def test_unconditional_skip_and_focus_fail():
    forms = [
        glue("    pytest.", "skip('hidden')\n"),
        glue("@pytest.mark.", "skip\n"),
        glue("    @unittest.", "skip('hidden')\n"),
        glue("it.", "skip('hidden')\n"),
        glue("test.", "todo('later')\n"),
        glue("x", "it('hidden', () => {})\n"),
        glue("it.", "only('hidden')\n"),
        glue("f", "describe('hidden', () => {})\n"),
    ]
    for form in forms:
        head = "def test_ok():\n    assert 1 == 1\n" + form
        findings = analyze("apps/engine/test/test_sample.py", "M", "def test_ok():\n    assert 1 == 1\n", head)
        assert fails(findings), form


def test_conditional_skip_warns_and_does_not_fail():
    head = "def test_ok():\n    assert 1 == 1\n" + glue("@pytest.mark.", "skipif(True, reason='missing tool')\n")
    findings = analyze(
        "apps/engine/test/test_sample.py",
        "M",
        "def test_ok():\n    assert 1 == 1\n",
        head,
    )
    assert fails(findings) == []
    assert any(finding.code == "test-skip-conditional" for finding in findings)


def test_importorskip_is_not_an_unconditional_skip():
    head = "def test_ok():\n    pytest." + "importorskip('moviepy')\n    assert 1 == 1\n"
    findings = analyze(
        "apps/engine/test/test_sample.py",
        "M",
        "def test_ok():\n    assert 1 == 1\n",
        head,
    )
    assert fails(findings) == []


def test_property_added_tests_do_not_fail():
    rng = random.Random(20261116)
    base = "def test_old():\n    assert 1 == 1\n"
    for index in range(30):
        value = rng.randrange(5)
        name = f"test_added_{index}_{rng.randrange(10000)}"
        head = base + f"def {name}():\n    assert {value} == {value}\n"
        findings = analyze("apps/engine/test/test_sample.py", "M", base, head)
        assert fails(findings) == [], index


def test_property_injected_skip_always_fails():
    base = "def test_old():\n    assert 1 == 1\n"
    skip_line = glue("    pytest.", "skip('hidden')\n")
    for index in range(10):
        head = base + f"def test_extra_{index}():\n" + skip_line
        findings = analyze("apps/engine/test/test_sample.py", "M", base, head)
        assert any(finding.code == "test-skipped" for finding in fails(findings))


def test_deleted_test_names_fail_and_a_rename_does_not():
    base = "def test_a():\n    assert 1 == 1\n\ndef test_b():\n    assert 2 == 2\n"
    deleted = analyze(
        "apps/engine/test/test_sample.py",
        "M",
        base,
        "def test_a():\n    assert 1 == 1\n",
    )
    assert any(finding.code == "tests-deleted" for finding in fails(deleted))
    renamed = analyze(
        "apps/engine/test/test_sample.py",
        "M",
        base,
        "def test_a():\n    assert 1 == 1\n\ndef test_c():\n    assert 2 == 2\n",
    )
    assert fails(renamed) == []


def test_removed_assertion_fails_when_the_test_remains():
    findings = analyze(
        "apps/engine/test/test_sample.py",
        "M",
        "def test_a():\n    assert 1 == 1\n    assert 2 == 2\n",
        "def test_a():\n    assert 1 == 1\n",
    )
    assert any(finding.code == "assertions-removed" for finding in fails(findings))


def test_precise_null_check_is_not_treated_as_weakened():
    findings = analyze(
        "apps/web/lib/__tests__/sample.test.ts",
        "M",
        "it('works', () => {\n  expect(value).toEqual(null)\n})\n",
        "it('works', () => {\n  expect(value).toBeNull()\n})\n",
    )
    assert fails(findings) == []


def test_plain_pytest_comparison_weakened_to_truthiness_fails():
    status = analyze(
        "apps/engine/test/test_sample.py",
        "M",
        "def test_a():\n    assert response['status'] == 200\n",
        "def test_a():\n    assert response\n",
    )
    assert any(finding.code == "assertion-weakened" for finding in fails(status))
    urls = analyze(
        "apps/engine/test/test_sample.py",
        "M",
        "def test_a():\n    assert session.urls == []\n",
        "def test_a():\n    assert session.urls\n",
    )
    assert any(finding.code == "assertion-weakened" for finding in fails(urls))
    compared = analyze(
        "apps/engine/test/test_sample.py",
        "M",
        "def test_a():\n    assert n > 0\n",
        "def test_a():\n    assert n == 1\n",
    )
    assert fails(compared) == []


def test_method_named_fit_is_not_a_focused_test():
    base = "def test_ok():\n    assert 1 == 1\n"
    method = analyze(
        "apps/engine/test/test_sample.py",
        "M",
        base,
        base + "    image = ImageOps.fit(image, size)\n",
    )
    assert fails(method) == []
    focused = analyze(
        "apps/web/lib/__tests__/sample.test.ts",
        "M",
        "it('works', () => {\n  expect(value).toEqual(1)\n})\n",
        "it('works', () => {\n  expect(value).toEqual(1)\n})\n" + glue("  ", "f", "it('only this')\n"),
    )
    assert any(finding.code == "test-focused" for finding in fails(focused))


def test_truthiness_swap_fails_and_toBe_does_not():
    base = "it('works', () => {\n  expect(value).toEqual(1)\n})\n"
    weakened = analyze(
        "apps/web/lib/__tests__/sample.test.ts",
        "M",
        base,
        "it('works', () => {\n  expect(value).toBeTruthy()\n})\n",
    )
    assert any(finding.code == "assertion-weakened" for finding in fails(weakened))
    tightened = analyze(
        "apps/web/lib/__tests__/sample.test.ts",
        "M",
        base,
        "it('works', () => {\n  expect(value).toBe(1)\n})\n",
    )
    assert fails(tightened) == []


def test_coverage_ignore_on_an_added_line_fails():
    head = "def test_ok():\n    assert 1 == 1\n" + glue("x = 1  ", "pragma: ", "no cover\n")
    findings = analyze(
        "apps/engine/test/test_sample.py",
        "M",
        "def test_ok():\n    assert 1 == 1\n",
        head,
    )
    assert any(finding.code == "coverage-ignored" for finding in fails(findings))


def test_deleted_test_file_fails_while_product_code_remains_and_warns_when_it_is_gone():
    path = "apps/engine/test/services/test_voice.py"
    base = "def test_a():\n    assert 1 == 1\n"
    present = analyze(path, "D", base, exists=lambda item: item == "apps/engine/app/services/voice.py")
    assert any(finding.code == "tests-deleted-file" for finding in fails(present))
    gone = analyze(path, "D", base, exists=lambda _item: False)
    assert fails(gone) == []
    assert any(finding.code == "tests-deleted-unmapped" for finding in gone)
    asgi = analyze("apps/engine/test/test_asgi_health.py", "D", base, exists=lambda _item: False)
    assert any(finding.code == "tests-deleted-unmapped" for finding in asgi)


def test_deleting_the_grader_fails_and_editing_it_warns():
    deleted = analyze(".github/REVIEW_RUBRIC.md", "D", "rubric\n")
    assert any(finding.code == "verifier-deleted" for finding in fails(deleted))
    edited = analyze(".github/scripts/verification/honesty.py", "M", "old\n", "new\n")
    assert fails(edited) == []
    assert any(finding.code == "verifier-changed" for finding in edited)


def test_loosened_coverage_floors_fail():
    under = analyze(
        "apps/engine/pyproject.toml",
        "M",
        "fail_under = 60\n",
        "fail_under = 50\n",
    )
    assert any(finding.code == "coverage-threshold" for finding in fails(under))
    stricter = analyze(
        "apps/engine/pyproject.toml",
        "M",
        "fail_under = 60\n",
        "fail_under = 70\n",
    )
    assert fails(stricter) == []
    threshold = analyze(
        "codecov.yml",
        "M",
        "threshold: 2%\ntarget: 80%\ninformational: false\n",
        "threshold: 5%\ntarget: 80%\ninformational: false\n",
    )
    assert any("threshold loosened" in finding.message for finding in fails(threshold))
    target = analyze(
        "codecov.yml",
        "M",
        "threshold: 2%\ntarget: 80%\ninformational: false\n",
        "threshold: 2%\ntarget: 70%\ninformational: false\n",
    )
    assert any("target loosened" in finding.message for finding in fails(target))
    informational = analyze(
        "codecov.yml",
        "M",
        "informational: false\n",
        "informational: true\n",
    )
    assert any(finding.code == "coverage-threshold" for finding in fails(informational))


def test_unsafe_workflow_lines_fail_and_comments_do_not():
    added = "on:\n  pull_request_target:\n"
    findings = analyze(".github/workflows/verification.yml", "M", "on:\n  pull_request:\n", added)
    assert any(finding.code == "verifier-unsafe" for finding in fails(findings))
    commented = analyze(
        ".github/workflows/verification.yml",
        "M",
        "on:\n  pull_request:\n",
        "on:\n  pull_request:\n# do not switch this file to a target event\n",
    )
    assert fails(commented) == []


def test_mappings_match_files_in_the_tree():
    notify = "apps/engine/app/services/notify.py"
    assert "apps/engine/test/services/test_notify.py" in scope.test_candidates(notify)
    assert (ROOT / "apps/engine/test/services/test_notify.py").is_file()
    whatsapp = "apps/web/lib/whatsapp.ts"
    mapped = "apps/web/lib/__tests__/whatsapp.test.ts"
    assert mapped in scope.test_candidates(whatsapp)
    assert (ROOT / mapped).is_file()
    assert "apps/engine/app/services/notify.py" in scope.production_candidates(
        "apps/engine/test/services/test_notify.py"
    )


def test_product_file_without_a_mapped_test_warns():
    findings = analyze(
        "apps/web/lib/brand_new.py".replace(".py", ".ts"),
        "A",
        head="export const value = 1\n",
        exists=lambda _item: False,
    )
    assert fails(findings) == []
    assert any(finding.code == "coverage-untested" for finding in findings)


def test_local_and_delegated_suites():
    assert scope.local_suites([".github/scripts/verification/honesty.py"]) == ["verification"]
    assert scope.local_suites([".github/scripts/review-mechanical-checks.py"]) == ["review-scripts"]
    assert scope.local_suites(["apps/web/lib/billing/batch-discount.ts"]) == []
    delegated = scope.delegated_suites(
        ["apps/web/lib/billing/batch-discount.ts"],
        lambda path: path == "apps/web/lib/billing/__tests__/batch-discount.test.ts",
    )
    areas = {item.area: item for item in delegated}
    assert "web" in areas
    assert "lib/billing/__tests__/batch-discount.test.ts" in areas["web"].command
    assert areas["web"].ci_job == "CI / web"
    assert "coverage" in areas
    assert "engine" not in areas


def test_parse_rename_and_payload_hides_file_bodies():
    rows = collect._parse_name_status('R100\told/test_a.py\tnew/test_a.py\nM\tapp.py\n')
    assert rows[0] == ("R", "new/test_a.py", "old/test_a.py")
    secret = "sk-" + ("a" * 24)
    change = honesty.FileChange(
        "apps/engine/test/test_sample.py",
        "M",
        "def test_ok():\n    assert 1 == 1\n",
        "def test_ok():\n    assert 1 == 1\n" + glue("    pytest.", "skip('") + secret + "')\n",
    )
    payload = collect.build_payload([change], lambda _path: True, "head", "base-sha", "head-sha")
    encoded = json.dumps(payload)
    assert secret not in encoded
    assert payload["ok"] is False
    markdown, ok = report.render(payload, {})
    assert ok is False
    assert secret not in markdown
    assert report.MARKER in markdown
    assert "Grader source: `head`" in markdown


def test_oversized_file_fails_and_is_still_listed(tmp_path, monkeypatch):
    monkeypatch.setattr(collect, "_MAX_BYTES", 40)
    repo = tmp_path / "repo"
    _git(repo, ["init", "-b", "main"])
    _git(repo, ["config", "user.email", "test@example.com"])
    _git(repo, ["config", "user.name", "test"])
    _git(repo, ["config", "commit.gpgsign", "false"])
    test_file = repo / "apps" / "engine" / "test" / "test_sample.py"
    test_file.parent.mkdir(parents=True)
    test_file.write_text("def test_ok():\n    assert 1 == 1\n", encoding="utf-8")
    _git(repo, ["add", "."])
    _git(repo, ["commit", "-m", "base"])
    base = _git(repo, ["rev-parse", "HEAD"]).strip()
    test_file.write_text("def test_ok():\n    assert 1 == 1\n" + ("# " + ("x" * 80) + "\n"), encoding="utf-8")
    _git(repo, ["add", "."])
    _git(repo, ["commit", "-m", "grow"])
    head = _git(repo, ["rev-parse", "HEAD"]).strip()
    out = tmp_path / "honesty.json"
    code = collect.main([
        "--repo", str(repo),
        "--base", base,
        "--head", head,
        "--source", "head",
        "--json", str(out),
    ])
    payload = json.loads(out.read_text(encoding="utf-8"))
    assert code == 1
    assert payload["ok"] is False
    assert any(
        finding["code"] == "file-too-large" and finding["severity"] == "fail"
        for finding in payload["findings"]
    )
    assert "apps/engine/test/test_sample.py" in payload["changed_paths"]


def test_cli_flags_a_skip_and_a_rename_passes(tmp_path):
    repo = tmp_path / "repo"
    _git(repo, ["init", "-b", "main"])
    _git(repo, ["config", "user.email", "test@example.com"])
    _git(repo, ["config", "user.name", "test"])
    _git(repo, ["config", "commit.gpgsign", "false"])
    test_file = repo / "apps" / "engine" / "test" / "test_sample.py"
    test_file.parent.mkdir(parents=True)
    test_file.write_text("def test_ok():\n    assert 1 == 1\n", encoding="utf-8")
    _git(repo, ["add", "."])
    _git(repo, ["commit", "-m", "base"])
    base = _git(repo, ["rev-parse", "HEAD"]).strip()
    test_file.write_text(
        "def test_ok():\n    assert 1 == 1\n" + glue("    pytest.", "skip('hidden')\n"),
        encoding="utf-8",
    )
    _git(repo, ["add", "."])
    _git(repo, ["commit", "-m", "skip"])
    head = _git(repo, ["rev-parse", "HEAD"]).strip()
    out = tmp_path / "honesty.json"
    code = collect.main([
        "--repo", str(repo),
        "--base", base,
        "--head", head,
        "--source", "head",
        "--json", str(out),
    ])
    assert code == 1
    payload = json.loads(out.read_text(encoding="utf-8"))
    assert any(finding["code"] == "test-skipped" for finding in payload["findings"])
    markdown = tmp_path / "evidence.md"
    assert report.main(["--honesty", str(out), "--suites", str(tmp_path / "missing.json"), "--markdown", str(markdown)]) == 1
    assert "test-skipped" in markdown.read_text(encoding="utf-8")

    moved = repo / "apps" / "engine" / "test" / "test_renamed.py"
    _git(repo, ["mv", "apps/engine/test/test_sample.py", "apps/engine/test/test_renamed.py"])
    _git(repo, ["commit", "-m", "rename"])
    renamed_head = _git(repo, ["rev-parse", "HEAD"]).strip()
    renamed_out = tmp_path / "rename.json"
    parent = _git(repo, ["rev-parse", "HEAD~1"]).strip()
    code = collect.main([
        "--repo", str(repo),
        "--base", parent,
        "--head", renamed_head,
        "--source", "base",
        "--json", str(renamed_out),
    ])
    assert code == 0, renamed_out.read_text(encoding="utf-8")
    assert moved.is_file()


def _git(repo: Path, args: list[str]) -> str:
    repo.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=False,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise AssertionError(proc.stderr)
    return proc.stdout.strip()

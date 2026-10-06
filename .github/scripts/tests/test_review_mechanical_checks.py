"""Unit tests for .github/scripts/review-mechanical-checks.py.

The mechanical checks run outside the LLM in the opencode-review workflow:
duplicate migration numbers and obvious secrets FAIL the review, prod changes
without test changes WARN. These tests pin that behavior — and that secret
VALUES are never printed, only the file and pattern name.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent


def load_checks():
    """Load review-mechanical-checks.py as a module (its name has dashes)."""
    path = SCRIPTS_DIR / "review-mechanical-checks.py"
    spec = importlib.util.spec_from_file_location("review_mechanical_checks", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def checks():
    return load_checks()


def run_main(checks, monkeypatch, capsys, tmp_path, diff="", files="", migrations=None):
    diff_path = tmp_path / "pr.diff"
    files_path = tmp_path / "pr-files.txt"
    diff_path.write_text(diff, encoding="utf-8")
    files_path.write_text(files, encoding="utf-8")
    mig_dir = tmp_path / "migrations"
    if migrations is not None:
        mig_dir.mkdir(parents=True, exist_ok=True)
        for name in migrations:
            (mig_dir / name).write_text("-- sql\n", encoding="utf-8")
    argv = [
        "review-mechanical-checks.py",
        "--diff",
        str(diff_path),
        "--files",
        str(files_path),
        "--migrations",
        str(mig_dir),
    ]
    monkeypatch.setattr(sys, "argv", argv)
    rc = checks.main()
    out = capsys.readouterr().out
    return rc, out


def test_duplicate_migration_numbers_fail(checks, tmp_path, monkeypatch, capsys):
    rc, out = run_main(
        checks,
        monkeypatch,
        capsys,
        tmp_path,
        migrations=["009_batch_charge.sql", "009_progress_history.sql"],
    )
    assert rc == 1
    assert "FAIL" in out
    assert "009" in out


def test_unique_migration_numbers_pass(checks, tmp_path, monkeypatch, capsys):
    rc, out = run_main(
        checks,
        monkeypatch,
        capsys,
        tmp_path,
        migrations=["009_batch_charge.sql", "010_progress_history.sql"],
    )
    assert rc == 0
    assert "migration numbers unique" in out


def test_secret_values_are_never_printed(checks, tmp_path, monkeypatch, capsys):
    secret = "sk-abcdefghij1234567890XYZ"
    diff = (
        "diff --git a/apps/web/lib/x.ts b/apps/web/lib/x.ts\n"
        "+++ b/apps/web/lib/x.ts\n"
        "@@ -1 +1 @@\n"
        f'+const key = "{secret}";\n'
    )
    rc, out = run_main(
        checks, monkeypatch, capsys, tmp_path, diff=diff, files="apps/web/lib/x.ts\n"
    )
    assert rc == 1
    assert "FAIL" in out
    assert "OpenAI-style sk- key" in out
    assert "apps/web/lib/x.ts" in out
    # The value itself must never appear in the report.
    assert secret not in out


def test_prod_changes_without_tests_warn_but_pass(checks, tmp_path, monkeypatch, capsys):
    rc, out = run_main(
        checks, monkeypatch, capsys, tmp_path, files="apps/web/lib/x.ts\n"
    )
    assert rc == 0
    assert "WARN" in out


def test_prod_changes_with_tests_pass(checks, tmp_path, monkeypatch, capsys):
    rc, out = run_main(
        checks,
        monkeypatch,
        capsys,
        tmp_path,
        files="apps/web/lib/x.ts\napps/web/lib/__tests__/x.test.ts\n",
    )
    assert rc == 0
    assert "OK" in out

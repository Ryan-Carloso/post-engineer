"""Unit tests for review-heuristics.py.

The three warnings are the deterministic half of the review: unscrubbed
telemetry, an empty-true aggregate, and a mock re-patched while the outer
patch is still active. PR #224 hit all three.
"""

from __future__ import annotations

import importlib.util
import subprocess
import textwrap
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = Path(__file__).resolve().parents[3]
PR224 = "f470bb9f7626dd923ad219c110793d318b6ee279"


def load_heuristics():
    path = SCRIPTS_DIR / "review-heuristics.py"
    spec = importlib.util.spec_from_file_location("review_heuristics", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def heuristics():
    return load_heuristics()


def test_overridden_mock_detected(heuristics, tmp_path: Path) -> None:
    test_file = tmp_path / "test_x.py"
    test_file.write_text(
        textwrap.dedent(
            """\
            from unittest.mock import patch
            def test_a():
                with patch.object(mod, "f", side_effect=ValueError):
                    with patch.object(mod, "f", return_value=1):
                        mod.f()
            def test_b():
                with patch.object(mod, "f"):
                    pass
                with patch.object(mod, "f"):
                    pass
            """
        ),
        encoding="utf-8",
    )
    warns = heuristics.check_overridden_mocks("test_x.py", tmp_path)
    assert len(warns) == 1
    assert ":4`" in warns[0]


def test_overridden_mock_ignores_lines_outside_the_diff(heuristics, tmp_path: Path) -> None:
    test_file = tmp_path / "test_x.py"
    test_file.write_text(
        textwrap.dedent(
            """\
            from unittest.mock import patch
            def test_a():
                with patch.object(mod, "f", side_effect=ValueError):
                    with patch.object(mod, "f", return_value=1):
                        mod.f()
            """
        ),
        encoding="utf-8",
    )
    assert heuristics.check_overridden_mocks("test_x.py", tmp_path, added_lines={99}) == []
    flagged = heuristics.check_overridden_mocks("test_x.py", tmp_path, added_lines={4})
    assert len(flagged) == 1


def test_unscrubbed_telemetry_detected_and_scrubbed_passes(heuristics, tmp_path: Path) -> None:
    bad = ['track_event("e", {', '    "response_body": body,', "})"]
    good = ['track_event("e", {', '    "response_body": scrub_error_text(body),', "})"]
    (tmp_path / "bad.py").write_text("\n".join(bad), encoding="utf-8")
    (tmp_path / "good.py").write_text("\n".join(good), encoding="utf-8")
    assert heuristics.check_telemetry("bad.py", list(enumerate(bad, start=1)), tmp_path)
    assert not heuristics.check_telemetry("good.py", list(enumerate(good, start=1)), tmp_path)


def test_empty_aggregate_guard_is_same_line(heuristics) -> None:
    assert heuristics.check_empty_aggregate(
        "a.py", [(1, "if not any(r.ok for r in results):")]
    )
    assert not heuristics.check_empty_aggregate(
        "a.py", [(1, "if results and not any(r.ok for r in results):")]
    )


def test_main_exits_zero_when_warnings_exist(heuristics, tmp_path: Path, capsys) -> None:
    diff = tmp_path / "pr.diff"
    diff.write_text(
        "diff --git a/svc.py b/svc.py\n"
        "--- a/svc.py\n"
        "+++ b/svc.py\n"
        "@@ -0,0 +1,3 @@\n"
        '+track_event("e", {\n'
        '+    "response_body": body,\n'
        "+})\n",
        encoding="utf-8",
    )
    (tmp_path / "svc.py").write_text(
        'track_event("e", {\n    "response_body": body,\n})\n',
        encoding="utf-8",
    )
    rc = heuristics.main(["--diff", str(diff), "--root", str(tmp_path)])
    assert rc == 0
    assert "unscrubbed-telemetry" in capsys.readouterr().out


def _have_commit(sha: str) -> bool:
    probe = subprocess.run(
        ["git", "cat-file", "-e", f"{sha}^{{commit}}"],
        cwd=REPO_ROOT,
        capture_output=True,
    )
    return probe.returncode == 0


@pytest.mark.skipif(not _have_commit(PR224), reason="PR #224 commit is not in this clone")
def test_pr224_diff_flags_telemetry_empty_aggregate_and_dead_mocks(heuristics, tmp_path: Path) -> None:
    # Triple-dot against main: f470bb9 itself is a diagram commit. The
    # telemetry and the dead mocks landed in earlier commits on the PR.
    base = subprocess.run(
        ["git", "rev-parse", "--verify", "origin/main"],
        cwd=REPO_ROOT,
        capture_output=True,
    )
    if base.returncode != 0:
        pytest.skip("origin/main is not in this clone")
    diff = subprocess.check_output(
        ["git", "diff", f"origin/main...{PR224}"],
        cwd=REPO_ROOT,
    )
    changed = subprocess.check_output(
        ["git", "diff", "--name-only", f"origin/main...{PR224}"],
        cwd=REPO_ROOT,
        text=True,
    )
    for name in changed.splitlines():
        shown = subprocess.run(
            ["git", "show", f"{PR224}:{name}"],
            cwd=REPO_ROOT,
            capture_output=True,
        )
        if shown.returncode != 0:
            continue
        dest = tmp_path / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(shown.stdout)
    warnings = heuristics.collect(diff.decode(), tmp_path)
    joined = "\n".join(warnings)
    assert "unscrubbed-telemetry" in joined
    assert "apps/engine/app/services/task_publish.py:199" in joined
    assert "empty-aggregate" in joined
    assert "apps/engine/app/services/task_publish.py:225" in joined
    assert "test_publish_failure_posthog.py:124" in joined
    assert "test_publish_continue_on_failure.py:122" in joined

from __future__ import annotations

import io
import subprocess
from pathlib import Path

from scripts import ast_changed
from scripts.ast_changed import code_changed, same_ast


def test_comment_only_change_keeps_the_same_ast():
    before = "def f(x):\n    # explain\n    return x + 1  # trailing\n"
    after = "def f(x):\n    return x + 1\n"
    assert same_ast(before, after) is True


def test_code_change_differs():
    assert same_ast("def f(x):\n    return x + 1\n", "def f(x):\n    return x - 1\n") is False


def test_docstring_change_counts_as_code():
    assert same_ast('def f():\n    """a"""\n', 'def f():\n    """b"""\n') is False


def test_unparseable_source_counts_as_changed():
    assert same_ast("def f(:\n", "def f(:\n") is False


def _show(files: dict[tuple[str, str], str]):
    return lambda ref, path: files.get((ref, path))


def test_code_changed_drops_comment_only_files_and_keeps_the_rest():
    files = {
        ("mb", "app/a.py"): "x = 1  # note\n",
        ("HEAD", "app/a.py"): "x = 1\n",
        ("mb", "app/b.py"): "x = 1\n",
        ("HEAD", "app/b.py"): "x = 2\n",
        ("HEAD", "app/new.py"): "x = 3\n",
    }
    kept = code_changed(
        ["app/a.py", "app/b.py", "app/new.py"],
        "origin/main",
        "HEAD",
        show=_show(files),
        find_merge_base=lambda base, head: "mb",
    )
    assert kept == ["app/b.py", "app/new.py"]


def test_code_changed_keeps_every_file_without_a_merge_base():
    kept = code_changed(
        ["app/a.py"], "origin/main", "HEAD", show=_show({}), find_merge_base=lambda b, h: None
    )
    assert kept == ["app/a.py"]


def test_main_filters_stdin_paths_relative_to_the_prefix(monkeypatch, capsys):
    calls = []

    def fake_code_changed(paths, base, head):
        calls.append((list(paths), base, head))
        return ["apps/engine/app/b.py"]

    monkeypatch.setattr(ast_changed, "code_changed", fake_code_changed)
    monkeypatch.setattr("sys.stdin", io.StringIO("app/a.py\n\napp/b.py\n"))

    assert ast_changed.main(["--base", "origin/main", "--head", "HEAD", "--prefix", "apps/engine/"]) == 0
    assert calls == [(["apps/engine/app/a.py", "apps/engine/app/b.py"], "origin/main", "HEAD")]
    assert capsys.readouterr().out == "app/b.py\n"


def test_git_helpers_read_a_real_repository(tmp_path: Path):
    def git(*args):
        subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True)

    git("init", "-q", "-b", "main")
    git("config", "user.email", "t@example.com")
    git("config", "user.name", "t")
    (tmp_path / "a.py").write_text("x = 1  # note\n")
    git("add", "a.py")
    git("commit", "-q", "-m", "base")
    git("checkout", "-q", "-b", "feature")
    (tmp_path / "a.py").write_text("x = 1\n")
    git("commit", "-q", "-am", "strip")

    import os

    cwd = os.getcwd()
    os.chdir(tmp_path)
    try:
        assert ast_changed.merge_base("main", "feature") is not None
        assert ast_changed.git_show("feature", "a.py") == "x = 1\n"
        assert ast_changed.git_show("feature", "missing.py") is None
        assert ast_changed.merge_base("main", "nope") is None
        assert code_changed(["a.py"], "main", "feature") == []
    finally:
        os.chdir(cwd)

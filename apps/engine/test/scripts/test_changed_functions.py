# ---------------
# changed_functions tests — the diff→function mapper that scopes the
# engine mutation shards to the CHANGED functions (scripts/
# changed_functions.py, used by the mutation (engine shard) CI job).
#
# The git wrapper (changed_functions_for_file) is covered against a real
# scratch git repo; the pure core (parse_diff_changed_lines,
# map_changed_lines) is covered directly.
# ---------------

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from scripts.changed_functions import (
    changed_functions_for_file,
    has_mutable_function,
    main,
    map_changed_lines,
    mangled_function_name,
    mutant_key,
    parse_diff_changed_lines,
)

# ---------------
# Pure core — parse_diff_changed_lines
# ---------------
DIFF_SAMPLE = """\
diff --git a/app/services/video.py b/app/services/video.py
index 1111111..2222222 100644
--- a/app/services/video.py
+++ b/app/services/video.py
@@ -10,7 +10,9 @@ def generate_video():
     keep_me()
-    old_line()
+    new_line()
+    another_new_line()
     also_kept()
@@ -40,4 +42,6 @@ def combine_videos():
-    removed_only()
     kept()
+    added_in_combine()
"""


def test_parse_diff_changed_lines_adds_plus_lines():
    # keep(10) / -removed / +new(11) / +another(12) / kept(13) — the
    # removed line advances only the OLD side; the second hunk's removed
    # line does not appear on the new side either (kept(42), +added(43)).
    assert parse_diff_changed_lines(DIFF_SAMPLE) == [11, 12, 43]


def test_parse_diff_changed_lines_empty_diff():
    assert parse_diff_changed_lines("") == []


# ---------------
# Pure core — map_changed_lines
# ---------------
TWO_FUNCTIONS = """\
def generate_video(subject):
    x = 1
    return x


def combine_videos(parts):
    y = 2
    return y


MODULE_LEVEL = "value"


def helper():
    return MODULE_LEVEL
"""


def test_map_changed_lines_inside_two_functions():
    result = map_changed_lines(
        changed_lines=[2, 7], source=TWO_FUNCTIONS, path="app/services/video.py"
    )
    assert result["mode"] == "functions"
    assert result["functions"] == ["combine_videos", "generate_video"]
    assert result["globs"] == [
        "app.services.video.x_combine_videos__mutmut_*",
        "app.services.video.x_generate_video__mutmut_*",
    ]


def line_of(source: str, needle: str) -> int:
    """1-based line number of the first line containing needle — keeps
    fallback tests pinned to the right line even if the fixture shifts."""
    for i, line in enumerate(source.splitlines(), start=1):
        if needle in line:
            return i
    raise AssertionError(f"{needle!r} not found in fixture source")


def test_map_changed_lines_module_level_change_falls_back_to_file():
    # Pin the line number against the fixture: MODULE_LEVEL is a
    # module-level assignment (outside every function).
    module_line = line_of(TWO_FUNCTIONS, 'MODULE_LEVEL = "value"')
    assert TWO_FUNCTIONS.splitlines()[module_line - 1].startswith("MODULE_LEVEL")
    result = map_changed_lines(
        changed_lines=[module_line], source=TWO_FUNCTIONS, path="app/services/video.py"
    )
    assert result["mode"] == "file"
    assert "module-level" in result["reason"]


def test_map_changed_lines_decorated_function_falls_back_to_file():
    source = "def wrapper(f):\n    return f\n\n\n@wrapper\ndef endpoint():\n    return 1\n"
    result = map_changed_lines(changed_lines=[7], source=source, path="app/x.py")
    assert result["mode"] == "file"
    assert "decorated" in result["reason"]


def test_map_changed_lines_nested_function_maps_to_mutable_parent():
    source = "def parent():\n    def inner():\n        return 1\n    return inner()\n"
    result = map_changed_lines(changed_lines=[3], source=source, path="app/services/a.py")
    assert result["mode"] == "functions"
    assert result["functions"] == ["parent"]
    assert result["globs"] == ["app.services.a.x_parent__mutmut_*"]


def test_map_changed_lines_nested_inside_decorated_falls_back():
    source = (
        "def wrapper(f):\n"
        "    return f\n"
        "\n"
        "\n"
        "@wrapper\n"
        "def outer():\n"
        "    def inner():\n"
        "        return 1\n"
        "    return inner()\n"
    )
    result = map_changed_lines(changed_lines=[8], source=source, path="app/services/a.py")
    assert result["mode"] == "file"


def test_map_changed_lines_async_function():
    source = "async def fetch_all():\n    return []\n"
    result = map_changed_lines(changed_lines=[2], source=source, path="app/services/b.py")
    assert result["mode"] == "functions"
    assert result["globs"] == ["app.services.b.x_fetch_all__mutmut_*"]


def test_map_changed_lines_class_method_uses_the_ii_separated_mangled_name():
    source = (
        "class Task:\n"
        "    def run(self):\n"
        "        return 1\n"
        "\n"
        "    @staticmethod\n"
        "    def static_helper():\n"
        "        return 2\n"
    )
    result = map_changed_lines(changed_lines=[3], source=source, path="app/services/task.py")
    assert result["mode"] == "functions"
    assert result["functions"] == ["Task.run"]
    assert result["globs"] == ["app.services.task.xǁTaskǁrun__mutmut_*"]

    # A lone @staticmethod is mutable (mirrors mutmut).
    result_static = map_changed_lines(changed_lines=[7], source=source, path="app/services/task.py")
    assert result_static["mode"] == "functions"
    assert result_static["globs"] == ["app.services.task.xǁTaskǁstatic_helper__mutmut_*"]


def test_map_changed_lines_staticmethod_with_extra_decorator_is_not_mutable():
    source = (
        "def deco(f):\n"
        "    return f\n"
        "\n"
        "\n"
        "class C:\n"
        "    @staticmethod\n"
        "    @deco\n"
        "    def combo():\n"
        "        return 1\n"
    )
    result = map_changed_lines(changed_lines=[9], source=source, path="app/services/c.py")
    assert result["mode"] == "file"


def test_map_changed_lines_unparsable_source_falls_back():
    result = map_changed_lines(changed_lines=[1], source="def broken(:\n", path="app/x.py")
    assert result["mode"] == "file"
    assert "ast parse failed" in result["reason"]


def test_map_changed_lines_nested_class_method_falls_back_to_file():
    # mutmut mutates only methods of MODULE-level classes (a nested
    # ClassDef's body passes through untouched — file_mutation.py walks
    # module statements only), so a change inside a nested class's
    # method cannot be pinned to a mutatable mutant name.
    source = "class Outer:\n    class Inner:\n        def method(self):\n            return 1\n"
    result = map_changed_lines(changed_lines=[4], source=source, path="app/services/d.py")
    assert result["mode"] == "file"


def test_has_mutable_function():
    assert has_mutable_function("def f():\n    return 1\n")
    assert has_mutable_function("class C:\n    @staticmethod\n    def s():\n        return 1\n")
    # Decorated-only file: every module-level function is decorated, so
    # mutmut mutates nothing. (lru_cache is non-bare → not mutable by the
    # lone-staticmethod/classmethod rule.)
    assert not has_mutable_function(
        "import functools\n\n\n@functools.lru_cache\ndef g():\n    return 1\n"
    )
    # Controller-style file: only @router endpoint methods.
    assert not has_mutable_function(
        "class R:\n    @router.get('/x')\n    def x(self):\n        return 1\n"
    )


def test_map_changed_lines_package_init_module_key_rewrites_the_dots():
    source = "def register():\n    return 1\n"
    result = map_changed_lines(changed_lines=[2], source=source, path="app/models/__init__.py")
    assert result["mode"] == "functions"
    # get_mutant_name rewrites ".__init__." -> "." on the full key.
    assert result["globs"] == ["app.models.x_register__mutmut_*"]


# ---------------
# Mangled-name helpers
# ---------------
def test_mangled_function_name_top_level_and_class():
    assert mangled_function_name("generate_video", None) == "x_generate_video"
    assert mangled_function_name("run", "Task") == "xǁTaskǁrun"


def test_mutant_key_module_dots():
    assert (
        mutant_key("app/services/video.py", "x_generate_video")
        == "app.services.video.x_generate_video"
    )


# ---------------
# CLI core — changed_functions_for_file against a scratch git repo
# ---------------
@pytest.fixture()
def git_repo(tmp_path: Path) -> Path:
    def git(*args: str) -> str:
        result = subprocess.run(
            ["git", "-C", str(tmp_path), *args],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout

    git("init", "-q")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "test")
    (tmp_path / "app" / "services").mkdir(parents=True)
    (tmp_path / "app" / "__init__.py").write_text("")
    (tmp_path / "app" / "services" / "__init__.py").write_text("")
    (tmp_path / "app" / "services" / "video.py").write_text(
        "def generate_video(subject):\n    return subject\n"
    )
    (tmp_path / "app" / "services" / "steady.py").write_text("def steady():\n    return 0\n")
    (tmp_path / "app" / "services" / "new_module.py").write_text("def fresh():\n    return 1\n")
    git("add", "-A")
    git("commit", "-q", "-m", "base")
    (tmp_path / "app" / "services" / "video.py").write_text(
        "def generate_video(subject):\n    doubled = subject * 2\n    return doubled\n"
    )
    (tmp_path / "app" / "services" / "untouched.py").write_text("def untouched():\n    return 0\n")
    (tmp_path / "app" / "services" / "brand_new.py").write_text("def brand_new():\n    return 1\n")
    git("add", "-A")
    git("commit", "-q", "-m", "head")
    return tmp_path


def test_changed_functions_for_file_maps_changed_function(git_repo: Path):
    result = changed_functions_for_file(
        base="HEAD~1", head="HEAD", path="app/services/video.py", cwd=str(git_repo)
    )
    assert result["mode"] == "functions"
    assert result["functions"] == ["generate_video"]
    assert result["globs"] == ["app.services.video.x_generate_video__mutmut_*"]


def test_changed_functions_for_file_new_file_falls_back(git_repo: Path):
    result = changed_functions_for_file(
        base="HEAD~1", head="HEAD", path="app/services/brand_new.py", cwd=str(git_repo)
    )
    assert result["mode"] == "file"
    assert "new file" in result["reason"]


def test_changed_functions_for_file_unchanged_file_falls_back(git_repo: Path):
    # steady.py exists in the base ref and is untouched in the diff.
    result = changed_functions_for_file(
        base="HEAD~1", head="HEAD", path="app/services/steady.py", cwd=str(git_repo)
    )
    assert result["mode"] == "file"
    assert "no diff hunks" in result["reason"]


def test_changed_functions_for_file_git_failure_falls_back(tmp_path: Path):
    result = changed_functions_for_file(
        base="HEAD~1", head="HEAD", path="app/services/video.py", cwd=str(tmp_path)
    )
    assert result["mode"] == "file"
    assert "git diff failed" in result["reason"]


# ---------------
# CLI contract — the workflow step reads "mode" and "globs"
# unconditionally, so the JSON shape is pinned for BOTH modes (a
# fallback output must carry "globs": [], never a missing key).
# ---------------
def test_cli_function_mode_output_shape(
    git_repo: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.chdir(git_repo)
    rc = main(["--file", "app/services/video.py", "--base", "HEAD~1", "--head", "HEAD"])
    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["mode"] == "functions"
    assert payload["globs"] == ["app.services.video.x_generate_video__mutmut_*"]
    assert payload["functions"] == ["generate_video"]


def test_cli_file_mode_output_shape(
    git_repo: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
):
    # Simulated fallback output (new file in this branch): the JSON must
    # still carry "mode" and "globs": [] — the exact crash the review
    # flagged (KeyError on ['globs']) cannot happen.
    monkeypatch.chdir(git_repo)
    rc = main(["--file", "app/services/brand_new.py", "--base", "HEAD~1", "--head", "HEAD"])
    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["mode"] == "file"
    assert payload["globs"] == []
    assert "reason" in payload


def test_cli_check_mutable_true_and_false(
    git_repo: Path,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.chdir(git_repo)
    assert main(["--file", "app/services/video.py", "--base", "HEAD~1", "--check-mutable"]) == 0
    assert json.dumps(capsys.readouterr().out.strip()) == json.dumps("true")

    decorated = tmp_path / "decorated.py"
    decorated.write_text("import functools\n\n\n@functools.lru_cache\ndef g():\n    return 1\n")
    assert main(["--file", str(decorated), "--base", "HEAD~1", "--check-mutable"]) == 0
    assert json.dumps(capsys.readouterr().out.strip()) == json.dumps("false")

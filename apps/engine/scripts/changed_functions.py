#!/usr/bin/env python3
"""Map the git diff of one changed engine file to mutmut mutant-name globs.

Used by the `mutation (engine shard)` CI job (.github/workflows/mutation.yml)
to scope mutation testing to the CHANGED functions instead of the whole
file: `mutmut run <glob>...` filters mutants by name (mutmut supports
fnmatch globs on mutant keys like `app.services.video.x_generate_video_1`
or class methods like `app.services.task.xǁTaskǁrun_2`).

Fallback rules (conservative — a change the mapper cannot pin to a
mutable function can affect anything, so the WHOLE file mutates):
- the file is new in HEAD (not in the base ref);
- any changed line lies outside a mutable function (module-level code),
  inside a non-mutable function (decorated — mutmut never mutates those
  anyway, but the surrounding behavior may differ), or in a function
  chain with no mutable ancestor;
- git cannot produce a diff, or the file does not parse with `ast`.

The mutable-function rule mirrors mutmut exactly (see the shard job's
"Check shard file has mutable code" step): an undecorated function, or
one with a single bare @staticmethod/@classmethod decorator.

Output (stdout): one JSON object
  {"file": ..., "mode": "functions" | "file", "globs": [...],
   "functions": [...], "reason": ...}
`mode: "file"` means: keep the shard's whole-file scope.

The pure core (parse_diff_changed_lines + map_changed_lines) is covered
by test/scripts/test_changed_functions.py; the CLI is a thin git wrapper.
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import re
import subprocess
import sys
from pathlib import Path

# ---------------
# Mutable-function rule — mirrors mutmut (mutation/file_mutation.py): a
# function is mutable when it has no decorators, or exactly one bare
# @staticmethod / @classmethod.
# ---------------
MUTABLE_BARE_DECORATORS = {"staticmethod", "classmethod"}


def is_mutable_function(node: ast.AST) -> bool:
    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        return False
    if not node.decorator_list:
        return True
    if len(node.decorator_list) == 1:
        decorator = node.decorator_list[0]
        if isinstance(decorator, ast.Name) and decorator.id in MUTABLE_BARE_DECORATORS:
            return True
    return False


def mangled_function_name(name: str, class_name: str | None) -> str:
    """The trampoline mangled name mutmut generates for a function.

    Mirrors mutmut.mutation.trampoline_templates.mangle_function_name:
    top-level functions get an ``x_`` prefix, class methods are
    ``xǁ<ClassName>ǁ<name>`` (the separator is mutmut's
    CLASS_NAME_SEPARATOR).
    """
    if class_name:
        return f"xǁ{class_name}ǁ{name}"
    return f"x_{name}"


def mutant_key(path: str, mangled_name: str) -> str:
    """The mutant key mutmut records (get_mutant_name), incl. its
    ``.__init__.`` → ``.`` rewrite for package __init__ modules."""
    module = Path(path).with_suffix("").as_posix().replace("/", ".")
    key = f"{module}.{mangled_name}"
    return key.replace(".__init__.", ".")


def collect_mutable_functions(source: str) -> list[dict]:
    """(start, end, name, class_name) of every function mutmut actually
    mutates: module-level functions and methods of module-level classes.

    Mirrors mutmut.mutation.file_mutation (it walks MODULE-level
    statements only; a nested ClassDef's body passes through untouched,
    and functions nested inside functions are mutated as part of their
    parent's span, never as their own mangled trampoline). A changed
    line inside a nested function/class maps UP to the enclosing
    top-level function (conservative), or falls back to the whole file
    when there is none."""
    functions: list[dict] = []
    tree = ast.parse(source)
    for child in ast.iter_child_nodes(tree):
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
            functions.append(
                {
                    "start": child.lineno,
                    "end": child.end_lineno,
                    "name": child.name,
                    "class_name": None,
                    "mutable": is_mutable_function(child),
                }
            )
        elif isinstance(child, ast.ClassDef):
            for method in ast.iter_child_nodes(child):
                if isinstance(method, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    functions.append(
                        {
                            "start": method.lineno,
                            "end": method.end_lineno,
                            "name": method.name,
                            "class_name": child.name,
                            "mutable": is_mutable_function(method),
                        }
                    )
    return functions


def has_mutable_function(source: str) -> bool:
    """True when the file holds at least one function mutmut can mutate
    (the shard's "skip gracefully" check — one source for the rule, used
    by the workflow's --check-mutable)."""
    return any(f["mutable"] for f in collect_mutable_functions(source))


def map_changed_lines(
    *,
    changed_lines: list[int],
    source: str,
    path: str,
) -> dict:
    """Core mapping: changed line numbers + file source → scoping decision.

    Returns {"mode": "functions", "globs": [...], "functions": [...]} or
    {"mode": "file", "reason": ...}.
    """
    try:
        functions = collect_mutable_functions(source)
    except SyntaxError as error:
        return {"mode": "file", "reason": f"ast parse failed: {error}"}

    changed_functions: set[tuple[str, str | None]] = set()
    for line in changed_lines:
        candidates = [f for f in functions if f["start"] <= line <= f["end"]]
        if not candidates:
            return {
                "mode": "file",
                "reason": f"changed line {line} is outside any function (module-level change)",
            }
        # Climb the enclosing chain to the nearest MUTABLE function (the
        # innermost may be a non-mutable nested helper or decorated
        # method inside a mutable parent). mutmut never mutates decorated
        # functions, so a change pinned to non-mutable code only falls
        # back to the whole file.
        mutable_candidates = [f for f in candidates if f["mutable"]]
        target = mutable_candidates[0] if mutable_candidates else None
        if target is None:
            return {
                "mode": "file",
                "reason": (
                    f"changed line {line} is inside non-mutable "
                    f"function {candidates[-1]['name']} (mutmut never mutates decorated functions)"
                ),
            }
        changed_functions.add((target["name"], target["class_name"]))

    globs = sorted(
        {
            # The trampoline name is mangled + "__mutmut" and each mutant
            # appends "_<n>" (e.g. x_generate_video__mutmut_1) — a
            # __mutmut_* glob matches every variant of the function.
            mutant_key(path, mangled_function_name(name, class_name)) + "__mutmut_*"
            for name, class_name in changed_functions
        }
    )
    return {
        "mode": "functions",
        "globs": globs,
        "functions": sorted((f"{cls}.{name}" if cls else name) for name, cls in changed_functions),
    }


def parse_diff_changed_lines(diff_text: str) -> list[int]:
    """New-file line numbers touched by a unified diff (+ lines in @@ hunks)."""
    changed: list[int] = []
    new_line = 0
    hunk_header = re.compile(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")
    for line in diff_text.splitlines():
        if line.startswith("@@"):
            match = hunk_header.match(line)
            assert match is not None, line  # only malformed if git is broken
            new_line = int(match.group(1))
        elif line.startswith("+") and not line.startswith("+++"):
            if new_line > 0:
                changed.append(new_line)
            new_line += 1
        elif line.startswith("-") and not line.startswith("---"):
            pass
        else:
            # Context line (starts with a space; an empty context line
            # shows as "" after splitlines) — advances the new-side line.
            new_line += 1
    return sorted(set(changed))


def file_is_new(base: str, path: str, cwd: str | None = None) -> bool:
    """True when the file does not exist in the base ref (new file)."""
    # `git cat-file <ref>:<path>` resolves <path> from the REPO ROOT, not
    # from the working directory — resolve the cwd offset first.
    repo_relative = path
    if cwd:
        try:
            root = subprocess.run(
                ["git", "rev-parse", "--show-toplevel"],
                cwd=cwd,
                capture_output=True,
                text=True,
                check=False,
            )
            if root.returncode == 0:
                root_abs = Path(root.stdout.strip()).resolve()
                cwd_abs = Path(cwd).resolve()
                offset = cwd_abs.relative_to(root_abs).as_posix()
                repo_relative = (Path(offset) / path).as_posix()
        except (ValueError, OSError):
            pass
    result = subprocess.run(
        ["git", "cat-file", "-e", f"{base}:{repo_relative}", "--"],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode != 0


def changed_functions_for_file(
    *,
    base: str,
    head: str,
    path: str,
    cwd: str | None = None,
) -> dict:
    """CLI core: git diff + file content → the scoping decision dict."""
    diff = subprocess.run(
        ["git", "diff", f"{base}...{head}", "--", path],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )
    if diff.returncode != 0:
        return {"mode": "file", "reason": f"git diff failed: {diff.stderr.strip()}"}
    if not diff.stdout.strip():
        return {"mode": "file", "reason": "no diff hunks between base and head"}

    changed_lines = parse_diff_changed_lines(diff.stdout)
    if not changed_lines:
        return {"mode": "file", "reason": "diff touches no added lines"}

    source_path = Path(cwd or ".") / path if cwd else Path(path)
    try:
        source = source_path.read_text()
    except OSError as error:
        return {"mode": "file", "reason": f"cannot read file: {error}"}

    if file_is_new(base, path, cwd=cwd):
        return {"mode": "file", "reason": "new file in this branch"}

    result = map_changed_lines(changed_lines=changed_lines, source=source, path=path)
    result["file"] = path
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", required=True, help="file relative to the working directory")
    parser.add_argument("--base", required=True, help="base ref (e.g. origin/main)")
    parser.add_argument("--head", default="HEAD", help="head ref")
    parser.add_argument(
        "--check-mutable",
        action="store_true",
        help="print 'true'/'false' (has a mutmut-mutable function) instead of the diff mapping",
    )
    args = parser.parse_args(argv)

    if args.check_mutable:
        try:
            source = Path(args.file).read_text()
            has = has_mutable_function(source)
        except (OSError, SyntaxError):
            has = False
        print("true" if has else "false")
        return 0

    result = changed_functions_for_file(
        base=args.base, head=args.head, path=args.file, cwd=os.getcwd()
    )
    # Uniform output shape: the workflow reads both keys unconditionally,
    # so "file" mode carries an empty globs list.
    if result["mode"] == "file":
        result["globs"] = []
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    # Exit 0 in both modes: "file" is the conservative fallback, not an error.
    return 0


if __name__ == "__main__":
    sys.exit(main())

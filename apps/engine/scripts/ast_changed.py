#!/usr/bin/env python3
from __future__ import annotations

import argparse
import ast
import subprocess
import sys
from collections.abc import Callable, Iterable


def same_ast(before: str, after: str) -> bool:
    try:
        return ast.dump(ast.parse(before)) == ast.dump(ast.parse(after))
    except SyntaxError:
        return False


def git_show(ref: str, path: str) -> str | None:
    result = subprocess.run(
        ["git", "show", f"{ref}:{path}"], capture_output=True, text=True, check=False
    )
    return result.stdout if result.returncode == 0 else None


def merge_base(base: str, head: str) -> str | None:
    result = subprocess.run(
        ["git", "merge-base", base, head], capture_output=True, text=True, check=False
    )
    return result.stdout.strip() if result.returncode == 0 else None


def code_changed(
    paths: Iterable[str],
    base: str,
    head: str,
    show: Callable[[str, str], str | None] = git_show,
    find_merge_base: Callable[[str, str], str | None] = merge_base,
) -> list[str]:
    paths = list(paths)
    ancestor = find_merge_base(base, head)
    if ancestor is None:
        return paths
    kept = []
    for path in paths:
        before = show(ancestor, path)
        after = show(head, path)
        if before is None or after is None or not same_ast(before, after):
            kept.append(path)
    return kept


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument("--prefix", default="")
    args = parser.parse_args(argv)
    names = [line.strip() for line in sys.stdin.read().splitlines() if line.strip()]
    kept = code_changed([args.prefix + name for name in names], args.base, args.head)
    for path in kept:
        print(path[len(args.prefix) :])
    return 0


if __name__ == "__main__":
    sys.exit(main())

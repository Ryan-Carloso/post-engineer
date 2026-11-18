"""Provider groups in Python sources, read from the syntax tree.

Usage: python3 scan_python.py <mentions.json> <file>...
Prints one JSON array of {file, line, kind, providers}. See rules.mjs for
what each group kind means. Docstrings are prose and are not scanned.
"""

from __future__ import annotations

import ast
import json
import re
import sys

TOKEN = re.compile(r"[A-Za-z0-9_]+")


def scan(path: str, text: str, index: dict[str, str]) -> list[dict[str, object]]:
    tree = ast.parse(text, filename=path)
    groups: list[dict[str, object]] = []
    docstrings: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = node.body
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
                docstrings.add(id(body[0].value))

    def mention(node: ast.AST | None) -> str | None:
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return index.get(node.value)
        if isinstance(node, ast.Name):
            return index.get(node.id)
        if isinstance(node, ast.Attribute):
            return index.get(node.attr)
        return None

    def compared(node: ast.AST) -> list[str]:
        if isinstance(node, ast.BoolOp):
            return [name for value in node.values for name in compared(value)]
        if isinstance(node, ast.UnaryOp):
            return compared(node.operand)
        if isinstance(node, ast.Compare):
            names = [mention(node.left), *(mention(item) for item in node.comparators)]
            return [name for name in names if name is not None]
        return []

    def subject_providers(node: ast.AST) -> list[tuple[str, str]]:
        """(subject dump, provider) pairs for a test: `subject == 'p'` or
        `'p' == subject`, combined with `and`."""
        if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.And):
            pairs: list[tuple[str, str]] = []
            for value in node.values:
                pairs.extend(subject_providers(value))
            return pairs
        if isinstance(node, ast.Compare) and len(node.ops) == 1 and isinstance(node.ops[0], ast.Eq):
            left = mention(node.left)
            right = mention(node.comparators[0])
            if left is not None and right is None:
                return [(ast.dump(node.comparators[0]), left)]
            if right is not None and left is None:
                return [(ast.dump(node.left), right)]
        return []

    def if_names(node: ast.If) -> list[str]:
        # Every provider an `if` compares against through its whole elif
        # expansion, so a head elif chain and its sibling continuations
        # group as one run instead of splitting across the two detectors.
        names: list[str] = []
        current: ast.AST | None = node
        while isinstance(current, ast.If):
            names.extend(compared(current.test))
            current = current.orelse[0] if len(current.orelse) == 1 and isinstance(current.orelse[0], ast.If) else None
        return names

    def report(node: ast.AST, kind: str, names: list[str | None]) -> None:
        providers = [name for name in names if name is not None]
        if len(set(providers)) < 2:
            return
        groups.append({"file": path, "line": getattr(node, "lineno", 0), "kind": kind, "providers": providers})

    elif_ifs: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.If) and len(node.orelse) == 1 and isinstance(node.orelse[0], ast.If):
            elif_ifs.add(id(node.orelse[0]))
    in_condition: set[int] = set()
    else_ifexps: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.If, ast.IfExp, ast.While)):
            in_condition.add(id(node.test))
        if isinstance(node, ast.IfExp) and isinstance(node.orelse, ast.IfExp):
            else_ifexps.add(id(node.orelse))

    for node in ast.walk(tree):
        if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
            report(node, "list", [mention(item) for item in node.elts])
        elif isinstance(node, ast.Subscript) and isinstance(node.value, (ast.Name, ast.Attribute)) and (
            getattr(node.value, "id", None) == "Literal" or getattr(node.value, "attr", None) == "Literal"
        ):
            items = node.slice.elts if isinstance(node.slice, ast.Tuple) else [node.slice]
            report(node, "list", [mention(item) for item in items])
        elif isinstance(node, ast.Dict):
            report(node, "map", [mention(key) for key in node.keys if key is not None])
        elif isinstance(node, ast.Match):
            report(node, "chain", [mention(case.pattern.value) if isinstance(case.pattern, ast.MatchValue) else None for case in node.cases])
        elif isinstance(node, ast.If) and id(node) not in elif_ifs:
            names: list[str] = []
            current: ast.AST | None = node
            while isinstance(current, ast.If):
                names.extend(compared(current.test))
                current = current.orelse[0] if len(current.orelse) == 1 and isinstance(current.orelse[0], ast.If) else None
            report(node, "chain", list(names))
        elif isinstance(node, ast.IfExp) and id(node) not in else_ifexps:
            names = []
            current = node
            while isinstance(current, ast.IfExp):
                names.extend(compared(current.test))
                current = current.orelse
            report(node, "chain", list(names))
        elif isinstance(node, ast.BoolOp) and id(node) not in in_condition:
            report(node, "chain", list(compared(node)))
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
            report(node, "text", [index.get(token) for token in TOKEN.findall(node.value)])

    # Runs of consecutive `if` statements in one statement list that spread
    # the dispatch across siblings instead of if/elif links: each statement
    # alone names one provider, so without this grouping every sibling is
    # dropped by the per-node minimum while the combined run is
    # per-provider dispatch with a silent fall-through to whatever follows.
    def report_sibling_runs(statements: list[ast.stmt]) -> None:
        run: list[ast.If] = []
        subject: str | None = None

        def flush() -> None:
            nonlocal run, subject
            if len(run) > 1:
                names: list[str] = []
                for statement in run:
                    names.extend(if_names(statement))
                report(run[0], "chain", names)
            run = []
            subject = None

        for statement in statements:
            if not isinstance(statement, ast.If):
                flush()
                continue
            pairs = subject_providers(statement.test)
            single_subject = bool(pairs) and all(name == pairs[0][0] for name, _ in pairs)
            if not single_subject or (subject is not None and pairs[0][0] != subject):
                flush()
            if not single_subject:
                continue
            if subject is None:
                subject = pairs[0][0]
            run.append(statement)
        flush()

    for node in ast.walk(tree):
        for field in ("body", "orelse", "finalbody"):
            statements = getattr(node, field, None)
            if isinstance(statements, list) and statements and all(isinstance(item, ast.stmt) for item in statements):
                report_sibling_runs(statements)
    return groups


def main(argv: list[str]) -> int:
    with open(argv[1], encoding="utf-8") as handle:
        index: dict[str, str] = json.load(handle)
    groups: list[dict[str, object]] = []
    for path in argv[2:]:
        with open(path, encoding="utf-8") as handle:
            groups.extend(scan(path, handle.read(), index))
    json.dump(groups, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

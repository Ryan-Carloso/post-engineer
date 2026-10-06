#!/usr/bin/env python3
"""Mechanical checks for the opencode-review workflow (run outside the LLM).

Reads the PR diff and the list of changed files and reports:

1. FAIL — duplicate migration numbers in supabase/migrations/
   (a collision like 009 happened for real and broke a rebase).
2. WARN — production files changed with no test file changed in the same PR
   (heuristic: paths containing /app/, /lib/, /src/ or apps/engine/app/
   without any changed counterpart in __tests__, test/, *.test.*, *.cy.ts).
3. FAIL — added diff lines containing obvious secret material
   (sk-, ghp_, xox[baprs]-, AKIA, AIza, private key blocks, ...).
   Complements secrets-hygiene (which scans tracked files) with a scan of
   the PR diff itself. Secret VALUES are never printed — only the file and
   the matched pattern name.

Output is a markdown section for the review comment. Exits 1 on any FAIL,
0 otherwise (WARN-only passes).

Usage:
  python3 review-mechanical-checks.py \
    --diff pr.diff --files pr-files.txt --migrations supabase/migrations
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

MIGRATION_RE = re.compile(r"^(\d+)[_-]")

PROD_HINTS = ("/app/", "/lib/", "/src/", "apps/engine/app/")
TEST_HINTS = ("__tests__", "/test/", ".test.", ".spec.", ".cy.ts", "__mocks__")

# High-confidence secret prefixes. Only (file, pattern-name) pairs are
# reported — never the matched value itself.
SECRET_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"sk-[A-Za-z0-9]{20,}"), "OpenAI-style sk- key"),
    (
        re.compile(
            r"ghp_[A-Za-z0-9]{36,}|gho_[A-Za-z0-9]{36,}|ghu_[A-Za-z0-9]{36,}"
            r"|ghs_[A-Za-z0-9]{36,}|ghr_[A-Za-z0-9]{36,}"
            r"|github_pat_[A-Za-z0-9_]{22,}"
        ),
        "GitHub token",
    ),
    (re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"), "Slack token"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "AWS access key id"),
    (re.compile(r"AIza[0-9A-Za-z_-]{35}"), "Google API key"),
    (re.compile(r"glpat-[A-Za-z0-9_-]{20,}"), "GitLab token"),
    (re.compile(r"dop_v1_[a-f0-9]{64}"), "DigitalOcean token"),
    (
        re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
        "private key block",
    ),
]

MAX_LISTED_FILES = 20


def check_migration_numbers(migrations_dir: Path) -> list[tuple[str, str, str]]:
    """Return [(number, first_file, second_file), ...] for duplicated prefixes."""
    seen: dict[str, str] = {}
    dupes: list[tuple[str, str, str]] = []
    if not migrations_dir.is_dir():
        return []
    for path in sorted(migrations_dir.glob("*.sql")):
        match = MIGRATION_RE.match(path.name)
        if not match:
            continue
        number = match.group(1)
        if number in seen:
            dupes.append((number, seen[number], path.name))
        else:
            seen[number] = path.name
    return dupes


def check_test_coverage(files: list[str]) -> tuple[list[str], int]:
    """Return (prod files changed, test files changed count)."""
    prod = [
        f
        for f in files
        if any(h in f for h in PROD_HINTS) and not any(h in f for h in TEST_HINTS)
    ]
    test_count = sum(1 for f in files if any(h in f for h in TEST_HINTS))
    return prod, test_count


def check_secrets_in_diff(diff_text: str) -> list[tuple[str, str, int]]:
    """Return [(file, pattern_name, hit_count), ...] for added diff lines."""
    hits: dict[tuple[str, str], int] = {}
    current_file = "<unknown>"
    for line in diff_text.splitlines():
        if line.startswith("+++ b/"):
            current_file = line[len("+++ b/") :]
        elif line.startswith("+++ "):
            current_file = line[len("+++ ") :].lstrip()
        elif line.startswith("+") and not line.startswith("+++"):
            added = line[1:]
            for pattern, name in SECRET_PATTERNS:
                if pattern.search(added):
                    key = (current_file, name)
                    hits[key] = hits.get(key, 0) + 1
                    break  # one pattern per line is enough
    return [(f, name, n) for (f, name), n in sorted(hits.items())]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--diff", required=True, help="PR diff file (pr.diff)")
    parser.add_argument("--files", required=True, help="changed-files list (pr-files.txt)")
    parser.add_argument(
        "--migrations",
        default="supabase/migrations",
        help="migrations directory",
    )
    args = parser.parse_args()

    lines: list[str] = []
    failed = False

    # 1. Duplicate migration numbers.
    dupes = check_migration_numbers(Path(args.migrations))
    if dupes:
        failed = True
        detail = "; ".join(f"`{n}` in `{a}` and `{b}`" for n, a, b in dupes)
        lines.append(f"- ❌ FAIL — duplicate migration numbers: {detail}")
    else:
        lines.append("- ✅ OK — migration numbers unique in `supabase/migrations/`")

    # 2. Production files changed without test files.
    changed = [
        line.strip()
        for line in Path(args.files).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    prod, test_count = check_test_coverage(changed)
    if prod and test_count == 0:
        listed = prod[:MAX_LISTED_FILES]
        extra = f" (+{len(prod) - len(listed)} more)" if len(prod) > len(listed) else ""
        names = ", ".join(f"`{f}`" for f in listed) + extra
        lines.append(
            "- ⚠️ WARN — production file(s) changed with no test file changed "
            f"in this PR: {names}"
        )
    elif prod:
        lines.append(
            f"- ✅ OK — {len(prod)} production file(s) changed alongside "
            f"{test_count} test file(s)"
        )
    else:
        lines.append("- ✅ OK — no production files changed")

    # 3. Obvious secrets in added diff lines.
    diff_text = Path(args.diff).read_text(encoding="utf-8", errors="replace")
    secrets = check_secrets_in_diff(diff_text)
    if secrets:
        failed = True
        detail = "; ".join(
            f"{name} in `{f}` ({n} line(s))" for f, name, n in secrets
        )
        lines.append(f"- ❌ FAIL — obvious secret material in added diff lines: {detail}")
    else:
        lines.append("- ✅ OK — no obvious secrets in added diff lines")

    print("\n".join(lines) + "\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

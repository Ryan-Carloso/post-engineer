"""Map a post-engineer diff to test files and the suite that should run.

The mapper is a heuristic. A miss becomes a warning on the evidence table,
not a failed job: numeric line coverage stays with Codecov in the existing
web and mcp CI jobs.
"""

from __future__ import annotations

from dataclasses import dataclass

_VERIFICATION_TEST_FILES = (
    "test_verification_collect.py",
    "test_verification_workflow.py",
)
_VERIFICATION_TEST_PATHS = frozenset(
    f".github/scripts/tests/{name}" for name in _VERIFICATION_TEST_FILES
)

SUITE_COMMANDS: dict[str, str] = {
    "verification": (
        "python3 -m pytest "
        + " ".join(f".github/scripts/tests/{name}" for name in _VERIFICATION_TEST_FILES)
        + " -q --tb=line"
    ),
    "review-scripts": "python3 -m pytest .github/scripts/tests -q --tb=line",
}

_TEST_DIRS = {"test", "tests", "__tests__", "__mocks__"}
_SOURCE_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs"}


@dataclass(frozen=True)
class Delegated:
    area: str
    ci_job: str
    command: str

    def as_dict(self) -> dict[str, str]:
        return {"area": self.area, "ci_job": self.ci_job, "command": self.command}


def is_test_path(path: str) -> bool:
    parts = path.split("/")
    if any(part in _TEST_DIRS for part in parts):
        return True
    name = parts[-1]
    return (
        ".test." in name
        or ".spec." in name
        or name.endswith(".cy.ts")
        or name.endswith(".cy.tsx")
    )


def is_product_code(path: str) -> bool:
    """True for app source whose coverage the evidence table should mention."""
    if is_test_path(path) or ".gen." in path or path.endswith(".d.ts"):
        return False
    if path.startswith("apps/mcp/src/") and path.endswith((".ts", ".tsx")):
        return True
    if path.startswith("apps/web/") and "/cypress/" not in path and path.endswith((".ts", ".tsx")):
        return True
    return False


def production_candidates(path: str) -> list[str]:
    """Product files a deleted test likely covers. Empty when the mapping is unsure."""
    name = path.split("/")[-1]
    if name.endswith(".cy.ts") or name.endswith(".cy.tsx"):
        return []
    if not is_test_path(path):
        return []
    parts = path.split("/")
    if "__tests__" in parts:
        parent = parts[: parts.index("__tests__")]
        cleaned = _strip_js_test_suffix(name)
        if cleaned == name:
            return []
        primary = "/".join(parent + [cleaned])
        return _unique([primary, *_ext_swaps(primary)])
    cleaned = _strip_js_test_suffix(name)
    if cleaned == name:
        return []
    sibling = "/".join(parts[:-1] + [cleaned])
    return _unique([sibling, *_ext_swaps(sibling)])


def test_candidates(path: str) -> list[str]:
    """Test files that would cover a product path, whether or not they exist."""
    if is_test_path(path):
        return [path]
    parts = path.split("/")
    name = parts[-1]
    parent = parts[:-1]
    stem, ext = _split_ext(name)
    results: list[str] = []
    if ext in _SOURCE_EXT:
        test_name = f"{stem}.test{ext}"
        results.append("/".join(parent + ["__tests__", test_name]))
        results.append("/".join(parent + [test_name]))
    return results


def local_suites(paths: list[str]) -> list[str]:
    """Suites this workflow can run cheaply, without installing the monorepo."""
    watched = [
        path
        for path in paths
        if path.startswith(".github/scripts/") or path == ".github/workflows/verification.yml"
    ]
    if not watched:
        return []
    verifier_only = all(
        path.startswith(".github/scripts/verification/")
        or path in _VERIFICATION_TEST_PATHS
        or path == ".github/workflows/verification.yml"
        for path in watched
    )
    if verifier_only:
        return ["verification"]
    return ["review-scripts"]


def delegated_suites(paths: list[str], exists) -> list[Delegated]:
    """Areas whose full suite already runs in another CI job.

    `exists` is a path -> bool predicate for the pull-request tree. The
    command lists up to eight mapped test files so a reviewer can run the
    diff scope; the result column says the job was not re-run here.
    """
    rows: list[Delegated] = []
    web = [
        path
        for path in paths
        if path.startswith("apps/web/") and "/cypress/" not in path and not path.endswith(".cy.ts")
    ]
    if web:
        rows.append(Delegated("web", "CI / web", _scoped_command(
            "pnpm --dir apps/web exec vitest run", web, "apps/web/", exists
        )))
    cypress = [path for path in paths if "/cypress/" in path or path.endswith(".cy.ts")]
    if cypress:
        rows.append(Delegated(
            "cypress",
            "CI / cypress",
            "pnpm --dir apps/web exec cypress run",
        ))
    mcp = [path for path in paths if path.startswith("apps/mcp/")]
    if mcp:
        rows.append(Delegated("mcp", "CI / mcp", _scoped_command(
            "pnpm --dir apps/mcp exec vitest run", mcp, "apps/mcp/", exists
        )))
    if any(path.startswith("supabase/migrations/") for path in paths):
        rows.append(Delegated(
            "migrations",
            "opencode-review",
            "python3 .github/scripts/review-mechanical-checks.py --diff pr.diff --files pr-files.txt",
        ))
    if any(is_product_code(path) for path in paths):
        rows.append(Delegated(
            "coverage",
            "CI / web, CI / mcp",
            "codecov patch target 80% and project threshold 2% (codecov.yml)",
        ))
    return rows


def _scoped_command(prefix: str, paths: list[str], strip: str, exists) -> str:
    files: list[str] = []
    for path in paths:
        for candidate in test_candidates(path):
            if exists(candidate) and candidate.startswith(strip):
                relative = candidate[len(strip) :]
                if relative not in files and " " not in relative and "'" not in relative:
                    files.append(relative)
    if not files:
        return prefix
    shown = files[:8]
    suffix = "" if len(files) <= 8 else " ..."
    return prefix + " " + " ".join(shown) + suffix


def _strip_js_test_suffix(name: str) -> str:
    for ext in (".ts", ".tsx", ".js", ".jsx", ".mjs"):
        for mid in (".test", ".spec"):
            suffix = mid + ext
            if name.endswith(suffix):
                return name[: -len(suffix)] + ext
    return name


def _split_ext(name: str) -> tuple[str, str]:
    dot = name.rfind(".")
    if dot <= 0:
        return name, ""
    return name[:dot], name[dot:]


def _ext_swaps(path: str) -> list[str]:
    if path.endswith(".ts"):
        return [path[:-3] + ".tsx"]
    if path.endswith(".tsx"):
        return [path[:-4] + ".ts"]
    return []


def _unique(items: list[str]) -> list[str]:
    seen: list[str] = []
    for item in items:
        if item not in seen:
            seen.append(item)
    return seen

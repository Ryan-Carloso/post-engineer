"""Unit tests for .github/scripts/verify-review-grounding.py.

The grounding verifier is the anti-hallucination gate of the opencode-review
workflow: it drops findings whose file, cited lines, or quoted code do not
check out against the checkout. These tests pin its behavior so a regex
regression cannot silently disable the gate.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent


def load_verifier():
    """Load verify-review-grounding.py as a module (its name has dashes)."""
    path = SCRIPTS_DIR / "verify-review-grounding.py"
    spec = importlib.util.spec_from_file_location("verify_review_grounding", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def verifier():
    return load_verifier()


@pytest.fixture()
def repo(tmp_path, monkeypatch):
    """A fake checkout with one file the findings can cite."""
    target = tmp_path / "apps" / "web" / "lib" / "thing.ts"
    target.parent.mkdir(parents=True)
    target.write_text(
        "export function thing() {\n"
        "  return 42;\n"
        "}\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)
    return tmp_path


def run_main(verifier, monkeypatch, capsys, review_text: str | bytes, tmp_path):
    src = tmp_path / "review.md"
    dst = tmp_path / "review.verified.md"
    if isinstance(review_text, bytes):
        src.write_bytes(review_text)
    else:
        src.write_text(review_text, encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["verify-review-grounding.py", str(src), str(dst)])
    rc = verifier.main()
    out = capsys.readouterr().out
    return rc, dst.read_text(encoding="utf-8"), out


GROUNDED_FINDING = """\
## Review

### MINOR: magic number

**Location:** apps/web/lib/thing.ts:2

```ts
  return 42;
```

Some explanation.
"""


def test_grounded_finding_is_kept(verifier, repo, tmp_path, monkeypatch, capsys):
    rc, published, _ = run_main(verifier, monkeypatch, capsys, GROUNDED_FINDING, tmp_path)
    assert rc == 0
    assert "### MINOR: magic number" in published
    # `:2` normalizes to `:2-2` when that span already matches the quote.
    # A correction note is only added when the cited numbers were wrong.
    assert "**Location:** apps/web/lib/thing.ts:2-2" in published
    assert "corrected" not in published


def test_wrong_line_numbers_are_reanchored(
    verifier, repo, tmp_path, monkeypatch, capsys
):
    # The quote is on line 2. A cited line that does not contain it is
    # rewritten to the quote's real span, with the note on the next line
    # (a same-line suffix would be parsed as part of the path later).
    review = GROUNDED_FINDING.replace("apps/web/lib/thing.ts:2", "apps/web/lib/thing.ts:99")
    rc, published, _ = run_main(verifier, monkeypatch, capsys, review, tmp_path)
    assert rc == 0
    assert "### MINOR: magic number" in published
    assert "**Location:** apps/web/lib/thing.ts:2-2" in published
    assert "_Line numbers corrected from 99._" in published
    for line in published.splitlines():
        if line.startswith("**Location:**"):
            assert "corrected" not in line


def test_quote_missing_from_file_is_not_a_clean_pass(
    verifier, repo, tmp_path, monkeypatch, capsys
):
    review = GROUNDED_FINDING.replace("return 42;", "return 99;")
    rc, published, _ = run_main(verifier, monkeypatch, capsys, review, tmp_path)
    assert rc == 1
    assert published.startswith(verifier.NOT_REVIEWED_MARKER)
    assert "Treat this PR as NOT reviewed" in published
    assert "No finding could be grounded" in published
    assert "MINOR: magic number" in published


def test_nothing_material_review_published_as_is(
    verifier, repo, tmp_path, monkeypatch, capsys
):
    review = "Nothing material is wrong with this PR.\n"
    rc, published, _ = run_main(verifier, monkeypatch, capsys, review, tmp_path)
    assert rc == 0
    assert published == review


def test_unparseable_findings_format_is_not_published(
    verifier, repo, tmp_path, monkeypatch, capsys
):
    # The model ignored the mandated `### SEVERITY:` format and emitted a
    # finding under `## `. This must NOT be published as "nothing material".
    review = """\
## MAJOR: SQL injection

**Location:** apps/web/lib/thing.ts:2

```ts
  return 42;
```
"""
    rc, published, _ = run_main(verifier, monkeypatch, capsys, review, tmp_path)
    assert rc == 1
    assert published.startswith(verifier.NOT_REVIEWED_MARKER)
    assert "## MAJOR: SQL injection" not in published
    assert "Review format error" in published
    assert "Treat this PR as NOT reviewed" in published


def test_heading_inside_quoted_fence_does_not_split_finding(
    verifier, tmp_path, monkeypatch, capsys
):
    # A verbatim quote of a markdown doc may itself contain a `### ` line.
    doc = tmp_path / "docs" / "notes.md"
    doc.parent.mkdir(parents=True)
    doc.write_text("# Title\n\n### Sub section\n\nBody text.\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    review = """\
### MINOR: stale docs

**Location:** docs/notes.md:1-5

```md
# Title

### Sub section

Body text.
```
"""
    rc, published, _ = run_main(verifier, monkeypatch, capsys, review, tmp_path)
    assert rc == 0
    # The finding must survive whole, not split at the inner `### ` line.
    assert published.count("### MINOR: stale docs") == 1
    assert "### Sub section" in published


def test_non_utf8_review_does_not_crash(verifier, repo, tmp_path, monkeypatch, capsys):
    # Raw model output can contain invalid bytes; the verifier must degrade,
    # not turn the review into a red check.
    rc, published, _ = run_main(
        verifier, monkeypatch, capsys, b"### MINOR: x\n\xff\xfe invalid\n", tmp_path
    )
    # A heading with no location is a dropped finding, not a clean review.
    # The process must still return a string instead of raising.
    assert rc == 1
    assert isinstance(published, str)
    assert published.startswith(verifier.NOT_REVIEWED_MARKER)


def test_parse_location_variants(verifier):
    parse = verifier.parse_location
    assert parse("`a/b.py:3-9`") == ("a/b.py", 3, 9)
    assert parse("a/b.py#L3-L9") == ("a/b.py", 3, 9)
    assert parse("'a/b.py:4'.") == ("a/b.py", 4, 4)
    assert parse("[x](a/b.py:5-6)") == ("a/b.py", 5, 6)
    assert parse("PR") == ("PR", None, None)
    assert parse("a/b.py:3-9 _Line numbers corrected from 1._") == ("a/b.py", 3, 9)


def test_backticked_location_is_kept_and_reanchored(verifier, tmp_path, monkeypatch, capsys):
    quote = '                        "response_body": (exc.response_body or "")[:500],'
    source = ("\n" * 55) + quote + "\n"
    package = tmp_path / "pkg"
    package.mkdir()
    (package / "mod.py").write_text(source, encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    review = (
        "Looking at the PR diff, I found one issue.\n\n"
        "### CRITICAL: Raw provider response body leaked to PostHog\n"
        "**Location:** `pkg/mod.py:61-66`\n"
        "```python\n"
        f"{quote}\n"
        "```\n"
        "Fix: scrub it.\n\n"
        "Verdict: REQUEST_CHANGES\n"
    )
    rc, published, _ = run_main(verifier, monkeypatch, capsys, review, tmp_path)
    assert rc == 0
    assert "CRITICAL: Raw provider response body" in published
    assert "**Location:** pkg/mod.py:56-56" in published
    assert "corrected from 61" in published
    assert "Verdict: REQUEST_CHANGES" in published
    assert "Looking at the PR diff" not in published
    for line in published.splitlines():
        if line.startswith("**Location:**"):
            assert "corrected" not in line


def test_pr224_heading_reanchors_onto_line_206(verifier, tmp_path, monkeypatch, capsys):
    """The finding OpenCode actually wrote on PR #224.

    Location was wrapped in backticks and cited a diff hunk (61-66). The
    quote is the response_body line, which sits on line 206 of task_publish.py
    at f470bb9. A padded fixture keeps that line number stable in CI when the
    commit is not in the clone.
    """
    quote = '                        "response_body": (exc.response_body or "")[:500],'
    repo = tmp_path / "checkout"
    target = repo / "apps" / "engine" / "app" / "services" / "task_publish.py"
    target.parent.mkdir(parents=True)
    sha = "f470bb9f7626dd923ad219c110793d318b6ee279"
    real = _git_show(sha, "apps/engine/app/services/task_publish.py")
    if real is None:
        text = ("\n" * 205) + quote + "\n"
    else:
        text = real
        assert text.splitlines()[205] == quote
    target.write_text(text, encoding="utf-8")
    monkeypatch.chdir(repo)
    review = (
        "Looking at the PR diff, the model reported this.\n\n"
        "### CRITICAL: Raw provider response body leaked to PostHog without secret scrubbing\n"
        "**Location:** `apps/engine/app/services/task_publish.py:61-66`\n"
        "```python\n"
        f"{quote}\n"
        "```\n"
        "Scrub the body before track_event.\n\n"
        "Verdict: REQUEST_CHANGES\n"
    )
    rc, published, _ = run_main(verifier, monkeypatch, capsys, review, tmp_path)
    assert rc == 0
    assert "task_publish.py:206-206" in published
    assert "corrected from 61" in published
    assert "Raw provider response body leaked to PostHog without secret scrubbing" in published
    assert "Looking at the PR diff" not in published


def test_path_traversal_is_not_a_clean_pass(verifier, tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    review = "### MINOR: x\n**Location:** ../etc/passwd:1\n```\nroot\n```\n"
    rc, published, _ = run_main(verifier, monkeypatch, capsys, review, tmp_path)
    assert rc == 1
    assert "escapes checkout" in published
    assert published.startswith(verifier.NOT_REVIEWED_MARKER)


def test_partial_drop_stays_green_and_lists_the_drop(
    verifier, repo, tmp_path, monkeypatch, capsys
):
    review = (
        GROUNDED_FINDING
        + "\n### MAJOR: missing file\n**Location:** nope/missing.py:1-2\n```python\nx = 1\n```\n"
    )
    rc, published, _ = run_main(verifier, monkeypatch, capsys, review, tmp_path)
    assert rc == 0
    assert "### MINOR: magic number" in published
    assert "<details>" in published
    assert "MAJOR: missing file" in published
    assert verifier.NOT_REVIEWED_MARKER not in published


def _git_show(sha: str, path: str) -> str | None:
    import subprocess

    probe = subprocess.run(
        ["git", "cat-file", "-e", f"{sha}^{{commit}}"],
        cwd=Path(__file__).resolve().parents[3],
        capture_output=True,
    )
    if probe.returncode != 0:
        return None
    shown = subprocess.run(
        ["git", "show", f"{sha}:{path}"],
        cwd=Path(__file__).resolve().parents[3],
        capture_output=True,
        text=True,
    )
    if shown.returncode != 0:
        return None
    return shown.stdout

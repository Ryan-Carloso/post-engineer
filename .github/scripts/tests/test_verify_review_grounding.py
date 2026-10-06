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


def test_ungrounded_finding_is_dropped_and_stubbed(
    verifier, repo, tmp_path, monkeypatch, capsys
):
    review = GROUNDED_FINDING.replace("apps/web/lib/thing.ts:2", "apps/web/lib/thing.ts:99")
    rc, published, _ = run_main(verifier, monkeypatch, capsys, review, tmp_path)
    assert rc == 0
    assert "MINOR: magic number" not in published
    assert "No findings survived mechanical verification" in published


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
    assert rc == 0
    assert "## MAJOR: SQL injection" not in published
    assert "not published" in published.lower()


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
    assert rc == 0
    assert isinstance(published, str)

"""Structural pins for the verification workflow.

Same-repo pull requests run the workflow file from the merge commit, so
these checks are regression protection: they fail if the workflow grows a
secret, a write-all token, or a target-event checkout of pull-request code.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

VERIFICATION = Path(__file__).resolve().parents[1] / "verification"
if str(VERIFICATION) not in sys.path:
    sys.path.append(str(VERIFICATION))

import scope  # noqa: E402

WORKFLOW = Path(__file__).resolve().parents[2] / "workflows" / "verification.yml"


def _text() -> str:
    return WORKFLOW.read_text(encoding="utf-8")


def _code_lines(text: str) -> list[str]:
    return [line for line in text.splitlines() if not line.strip().startswith("#")]


def test_workflow_is_pull_request_and_has_no_secrets():
    text = _text()
    doc = yaml.safe_load(text)
    triggers = doc[True]
    assert "pull_request" in triggers
    assert "pull_request_target" not in triggers
    code = "\n".join(_code_lines(text))
    assert "pull_request_target" not in code
    assert "secrets." not in code
    assert "contents: write" not in text
    assert "persist-credentials: false" in text
    assert 'GITHUB_TOKEN: ""' in text
    assert "GH_TOKEN: \"\"" in text
    assert "Fork pull request" in text
    assert "HEAD_REPO" in text
    assert "git archive" in text


def test_permissions_are_read_plus_pull_request_comment():
    doc = yaml.safe_load(_text())
    assert doc["permissions"] == {"contents": "read"}
    job = doc["jobs"]["evidence"]
    assert job["permissions"] == {"contents": "read", "pull-requests": "write"}
    assert job["timeout-minutes"] <= 15


def test_actions_are_pinned_first_party():
    uses = re.findall(r"uses:\s*(\S+)", _text())
    assert uses
    for item in uses:
        assert item.startswith("actions/"), item
        assert re.search(r"@[0-9a-f]{40}", item), item


def test_workflow_runs_the_allowlisted_suite_commands():
    text = _text()
    for command in scope.SUITE_COMMANDS.values():
        assert command in text
    assert "refusing local_suites" in text


def test_install_uses_base_requirements():
    text = _text()
    assert 'git show "${BASE_SHA}:.github/scripts/requirements-validator.txt"' in text
    assert "pip install --quiet -r /tmp/requirements-validator.txt" in text


def test_grade_payload_is_verified_before_render():
    text = _text()
    assert "honesty_sha=$(sha256sum /tmp/honesty.json" in text
    assert "modified after grading" in text
    assert text.index("honesty_sha=") < text.index("python3 -m pytest")
    assert text.index("python3 -m pytest") < text.index("modified after grading")
    assert 'SUITE_CODES="$suite_codes"' in text

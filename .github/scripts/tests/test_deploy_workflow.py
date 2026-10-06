"""Pin the deploy workflow's trigger semantics.

deploy.yml applies pending Supabase migrations to production. It must run on
PR merge to main (the user's ship decision), not gated on the full CI suite
going green on main — branch protection already encodes the quality bar via
required checks, and gating on CI held migrations back whenever a
non-required job (e.g. cypress) went red after merge.
"""

from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "deploy.yml"


@pytest.fixture(scope="module")
def workflow():
    with open(WORKFLOW) as f:
        data = yaml.safe_load(f)
    # PyYAML parses the `on:` key as boolean True (YAML 1.1).
    data["on"] = data.get("on", data.get(True))
    return data


def test_triggers_on_pull_request_closed_to_main(workflow):
    on = workflow["on"]
    pr = on["pull_request"]
    assert "closed" in pr["types"]
    assert "main" in pr["branches"]
    assert "workflow_run" not in on


def test_migrate_job_only_runs_for_merged_prs(workflow):
    condition = workflow["jobs"]["migrate"]["if"]
    assert "github.event.pull_request.merged == true" in condition


def test_migrate_job_skips_fork_prs(workflow):
    # The pull_request event does not expose secrets to fork PRs; without
    # this guard a fork merge would fail loudly on the secret checks
    # instead of skipping quietly.
    condition = workflow["jobs"]["migrate"]["if"]
    assert "github.event.pull_request.head.repo.full_name == github.repository" in condition


def test_checks_out_the_merge_commit(workflow):
    steps = workflow["jobs"]["migrate"]["steps"]
    checkout = next(s for s in steps if s.get("uses", "").startswith("actions/checkout@"))
    assert "github.event.pull_request.merge_commit_sha" in checkout["with"]["ref"]


def test_deploy_runs_serialized(workflow):
    assert workflow["concurrency"]["group"] == "deploy-main"
    assert workflow["concurrency"]["cancel-in-progress"] is False

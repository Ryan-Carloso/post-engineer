"""Pin the deploy workflow's trigger semantics.

deploy.yml applies pending Supabase migrations to production. It must run on
every push to main, which is the PR merge (the user's ship decision), not gated on the full CI suite
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
    data["on"] = data.get("on", data.get(True))
    return data


def test_triggers_on_push_to_main_and_dispatch(workflow):
    on = workflow["on"]
    assert on["push"]["branches"] == ["main"]
    assert "workflow_dispatch" in on
    assert "pull_request" not in on
    assert "workflow_run" not in on


def test_migrate_job_runs_in_the_production_environment(workflow):
    assert workflow["jobs"]["migrate"]["environment"] == "production"


def test_migrate_job_has_no_pull_request_dependency(workflow):
    text = WORKFLOW.read_text()
    assert "github.event.pull_request" not in text
    assert "if" not in workflow["jobs"]["migrate"]


def test_checks_out_the_pushed_commit_or_main_on_dispatch(workflow):
    steps = workflow["jobs"]["migrate"]["steps"]
    checkout = next(s for s in steps if s.get("uses", "").startswith("actions/checkout@"))
    ref = checkout["with"]["ref"]
    assert "'refs/heads/main'" in ref
    assert "github.sha" in ref


def test_deploy_runs_serialized(workflow):
    assert workflow["concurrency"]["group"] == "deploy-main"
    assert workflow["concurrency"]["cancel-in-progress"] is False

"""Pin the MCP release workflow to code that is on main.

release-mcp.yml holds `id-token: write` (npm trusted publishing and the MCP
Registry GitHub OIDC login). Issue #456: no fork PR, other branch, tag push or
dispatch on another ref may make an OIDC-bearing job build or publish code
that is not main's HEAD, and no job that holds the OIDC token may run code
from the repository tree (install/build/test scripts).
"""

from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "release-mcp.yml"

MAIN_GUARD = (
    "github.repository == 'Ryan-Carloso/post-engineer'",
    "github.ref == 'refs/heads/main'",
    "fromJSON('[\"push\",\"schedule\",\"workflow_dispatch\"]')",
    "github.event_name",
)


@pytest.fixture(scope="module")
def workflow():
    with open(WORKFLOW) as f:
        data = yaml.safe_load(f)
    data["on"] = data.get("on", data.get(True))
    return data


def _run_blocks(job):
    return [s["run"] for s in job.get("steps", []) if "run" in s]


def _uses(job):
    return [s["uses"] for s in job.get("steps", []) if "uses" in s]


def _privileged(job):
    perms = job.get("permissions", {})
    return perms.get("id-token") == "write" or perms.get("contents") == "write"


def test_triggers_only_on_main_push_schedule_and_dispatch(workflow):
    on = workflow["on"]
    assert set(on) == {"push", "schedule", "workflow_dispatch"}
    assert on["push"]["branches"] == ["main"]
    assert "tags" not in on["push"]
    assert "branches-ignore" not in on["push"]


def test_workflow_default_permissions_are_read_only(workflow):
    assert workflow["permissions"] == {"contents": "read"}


def test_every_privileged_job_is_guarded_to_main(workflow):
    privileged = {name: job for name, job in workflow["jobs"].items() if _privileged(job)}
    assert set(privileged) == {"publish", "tag", "registry"}
    for name, job in privileged.items():
        condition = job.get("if", "")
        for fragment in MAIN_GUARD:
            assert fragment in condition, f"{name} lacks {fragment}"


def test_build_job_is_guarded_and_holds_no_token(workflow):
    build = workflow["jobs"]["build"]
    for fragment in MAIN_GUARD:
        assert fragment in build["if"]
    assert build["permissions"] == {"contents": "read"}


def test_build_checks_out_main_by_full_ref_and_verifies_it(workflow):
    build = workflow["jobs"]["build"]
    checkout = next(s for s in build["steps"] if s.get("uses", "").startswith("actions/checkout@"))
    assert checkout["with"]["ref"] == "refs/heads/main"
    assert checkout["with"]["fetch-depth"] == 0
    verify = next(s for s in build["steps"] if s.get("name") == "Verify the checkout is main's HEAD")
    assert "git merge-base --is-ancestor" in verify["run"]
    assert "refs/remotes/origin/main" in verify["run"]
    assert build["outputs"]["commit"] == "${{ steps.main.outputs.commit }}"


def test_oidc_jobs_never_check_out_or_run_the_tree(workflow):
    oidc = {n: j for n, j in workflow["jobs"].items() if j.get("permissions", {}).get("id-token") == "write"}
    assert set(oidc) == {"publish", "registry"}
    for name, job in oidc.items():
        assert not any(u.startswith("actions/checkout@") for u in _uses(job)), name
        assert not any(u.startswith("pnpm/") for u in _uses(job)), name
        for block in _run_blocks(job):
            assert "pnpm" not in block, name
            assert ".github/scripts" not in block, name
            assert "npm ci" not in block and "npm run" not in block, name
            assert "npm@latest" not in block, name


def test_publish_ships_the_tarball_built_without_the_token(workflow):
    publish = workflow["jobs"]["publish"]
    assert publish["needs"] == "build"
    assert publish["permissions"] == {"contents": "read", "id-token": "write"}
    run = "\n".join(_run_blocks(publish))
    assert 'npm publish "$TARBALL" --provenance --access public' in run
    assert "npm install -g npm@11.6.2" in run


def test_tag_job_tags_the_commit_the_build_resolved(workflow):
    tag = workflow["jobs"]["tag"]
    assert tag["permissions"] == {"contents": "write"}
    checkout = next(s for s in tag["steps"] if s.get("uses", "").startswith("actions/checkout@"))
    assert checkout["with"]["ref"] == "${{ needs.build.outputs.tag_sha }}"
    assert checkout["with"]["persist-credentials"] is True


def test_registry_uses_the_build_server_json(workflow):
    registry = workflow["jobs"]["registry"]
    downloads = [s for s in registry["steps"] if s.get("uses", "").startswith("actions/download-artifact@")]
    assert [d["with"]["name"] for d in downloads] == ["mcp-server-json"]

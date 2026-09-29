"""Negative tests for .github/scripts/validate-ocr-review.py.

Each test mutates a copy of the real workflow and asserts the validator
exits non-zero; the positive control asserts the real workflow passes.

Run: python3 -m pytest .github/scripts/test_validate_ocr_review.py -q
(Wired into CI via the `review-workflows` job.)
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

SCRIPTS = Path(__file__).resolve().parent
VALIDATOR = SCRIPTS / "validate-ocr-review.py"
WORKFLOW = SCRIPTS.parent / "workflows" / "ocr-review.yml"


def validate_text(text: str, tmp_path: Path) -> int:
    target = tmp_path / "ocr-review.yml"
    target.write_text(text)
    proc = subprocess.run(
        [sys.executable, str(VALIDATOR), str(target)],
        capture_output=True,
        text=True,
    )
    return proc.returncode


def validate_proc(text: str, tmp_path: Path) -> subprocess.CompletedProcess[str]:
    target = tmp_path / "ocr-review.yml"
    target.write_text(text)
    return subprocess.run(
        [sys.executable, str(VALIDATOR), str(target)],
        capture_output=True,
        text=True,
    )


def mutate(text: str, old: str, new: str) -> str:
    assert old in text, f"mutation anchor not found: {old!r}"
    return text.replace(old, new, 1)


def test_real_workflow_passes(tmp_path: Path) -> None:
    assert validate_text(WORKFLOW.read_text(), tmp_path) == 0


def test_rejects_pull_request_target(tmp_path: Path) -> None:
    text = mutate(WORKFLOW.read_text(), "on:\n  pull_request:", "on:\n  pull_request_target:")
    assert validate_text(text, tmp_path) != 0


def test_rejects_reindented_pull_request_target(tmp_path: Path) -> None:
    # Indentation tricks must not defeat the pull_request_target prohibition:
    # the check reads the parsed document, not raw-text indentation.
    text = mutate(WORKFLOW.read_text(), "on:\n  pull_request:", "on:\n   pull_request_target:")
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "[FAIL] does not use pull_request_target" in proc.stdout


def test_rejects_job_level_permissions_override(tmp_path: Path) -> None:
    # A job-level `permissions:` block overrides the top-level one in GitHub
    # Actions, so it must be rejected even when top-level is least-privilege.
    text = mutate(
        WORKFLOW.read_text(),
        "  ocr-review:\n    runs-on: ubuntu-latest",
        "  ocr-review:\n    permissions:\n      contents: write\n    runs-on: ubuntu-latest",
    )
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "[FAIL] no job-level permissions override" in proc.stdout


def test_invalid_yaml_fails_cleanly(tmp_path: Path) -> None:
    # Unparseable YAML must surface as validator FAILs,
    # not an unhandled YAMLError traceback.
    text = mutate(WORKFLOW.read_text(), "name: OCR Review (Alibaba OpenCodeReview)", "name: [unclosed")
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "Traceback" not in proc.stderr


def test_on_shorthand_list_fails_cleanly(tmp_path: Path) -> None:
    # `on: [pull_request]` parses the triggers as a list; trigger extraction
    # must surface validator FAILs, not an unhandled AttributeError traceback.
    text = mutate(
        WORKFLOW.read_text(),
        "on:\n  pull_request:\n    types: [opened, synchronize, reopened, ready_for_review]",
        "on: [pull_request]",
    )
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "Traceback" not in proc.stderr


def test_rejects_unpinned_action(tmp_path: Path) -> None:
    text = mutate(
        WORKFLOW.read_text(),
        "@486022daaf14f7142275eddb9b3cacc3cc5dadfa",
        "@v1",
    )
    assert validate_text(text, tmp_path) != 0


def test_rejects_floating_ocr_version(tmp_path: Path) -> None:
    text = mutate(WORKFLOW.read_text(), 'ocr_version: "1.12.9"', 'ocr_version: "latest"')
    assert validate_text(text, tmp_path) != 0


def test_rejects_dropped_env_guard(tmp_path: Path) -> None:
    text = mutate(
        WORKFLOW.read_text(),
        " && steps.env-guard.outputs.blocked == 'false'",
        "",
    )
    assert validate_text(text, tmp_path) != 0


def test_rejects_secret_interpolated_in_run(tmp_path: Path) -> None:
    text = mutate(
        WORKFLOW.read_text(),
        'echo "present=true" >> "$GITHUB_OUTPUT"',
        'echo "${{ secrets.ZAI_API_KEY }}" >> /dev/null',
    )
    assert validate_text(text, tmp_path) != 0


def test_rejects_widened_permissions(tmp_path: Path) -> None:
    text = mutate(WORKFLOW.read_text(), "contents: read", "contents: write")
    assert validate_text(text, tmp_path) != 0


def test_malformed_job_fails_cleanly(tmp_path: Path) -> None:
    # A renamed/missing ocr-review job must surface as validator FAILs,
    # not an unhandled KeyError traceback.
    text = mutate(WORKFLOW.read_text(), "\n  ocr-review:\n", "\n  renamed-job:\n")
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "Traceback" not in proc.stderr


def test_missing_review_step_fails_cleanly(tmp_path: Path) -> None:
    # A missing/renamed OCR action step must surface as validator FAILs,
    # not an unhandled StopIteration traceback.
    text = mutate(
        WORKFLOW.read_text(),
        "uses: alibaba/open-code-review@486022daaf14f7142275eddb9b3cacc3cc5dadfa",
        "uses: actions/checkout@v4",
    )
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "Traceback" not in proc.stderr


def test_missing_env_guard_fails_cleanly(tmp_path: Path) -> None:
    # A dropped env-guard step must surface as validator FAILs,
    # not an unhandled KeyError traceback.
    text = mutate(WORKFLOW.read_text(), "id: env-guard", "id: env-guard-renamed")
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "Traceback" not in proc.stderr


@pytest.mark.parametrize("bad_steps", [None, 5, "oops"])
def test_nonlist_steps_fails_cleanly(tmp_path: Path, bad_steps: object) -> None:
    # `steps:` emptied to null (or set to a scalar) after deleting all steps
    # must surface as validator FAILs, not an unhandled TypeError traceback
    # from the step-index comprehension.
    doc = yaml.safe_load(WORKFLOW.read_text())
    doc["jobs"]["ocr-review"]["steps"] = bad_steps
    proc = validate_proc(yaml.safe_dump(doc), tmp_path)
    assert proc.returncode != 0
    assert "Traceback" not in proc.stderr


def test_rejects_expression_interpolated_in_run(tmp_path: Path) -> None:
    # The workflow's own policy passes context via env:, never interpolated
    # into run: scripts — even non-secret ${{ }} expressions must trip the
    # validator.
    text = mutate(
        WORKFLOW.read_text(),
        'echo "present=true" >> "$GITHUB_OUTPUT"',
        'echo "${{ github.event.number }}" >> /dev/null',
    )
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "[FAIL] no expressions interpolated in any run: script" in proc.stdout


def test_rejects_narrowed_env_guard_pattern(tmp_path: Path) -> None:
    # Narrowing the guard pattern (e.g. back to the form that misses
    # `.env-backup` / `.env2024`) must trip the validator's pattern check.
    text = mutate(WORKFLOW.read_text(), "grep -Eq '(^|/)\\.env'", "grep -Eq '(^|/)\\.env(\\.|$)'")
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "[FAIL] env-guard run block matches .env* paths" in proc.stdout


def test_rejects_api_based_env_guard(tmp_path: Path) -> None:
    # Reverting the guard to the GitHub API file list (truncated on large
    # PRs, so a .env* file past the cap slips through) must trip the
    # validator.
    text = mutate(
        WORKFLOW.read_text(),
        'git diff --name-only --no-renames "$1" "$2"',
        "gh pr view --json files --jq '.files[].path'",
    )
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "[FAIL] env-guard diffs git history, not the truncated API file list" in proc.stdout


def test_main_resets_failures_between_calls(tmp_path: Path) -> None:
    # Regression: FAILURES is module-level; calling main() twice in one
    # process must not leak the first run's failures into the second run.
    import importlib.util

    spec = importlib.util.spec_from_file_location("validate_ocr_review", str(VALIDATOR))
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    bad = tmp_path / "bad.yml"
    bad.write_text("on:\n  pull_request_target:\n")
    assert mod.main(bad) != 0

    good = tmp_path / "good.yml"
    good.write_text(WORKFLOW.read_text())
    assert mod.main(good) == 0


def test_rejects_env_guard_without_merge_shape_check(tmp_path: Path) -> None:
    # Dropping the merge-commit shape verification (which guards against a
    # fast-forward merge ref making HEAD^1 miss earlier .env* changes) must
    # trip the validator.
    text = mutate(WORKFLOW.read_text(), "rev-list --parents", "rev-list --max-count")
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "[FAIL] env-guard verifies merge-commit shape" in proc.stdout


@pytest.mark.parametrize("bad_run", [5, True, ["echo", "hi"]])
def test_nonstring_run_fails_cleanly(tmp_path: Path, bad_run: object) -> None:
    # A non-string `run:` value must surface as validator FAILs, not an
    # unhandled TypeError traceback from the substring checks.
    doc = yaml.safe_load(WORKFLOW.read_text())
    doc["jobs"]["ocr-review"]["steps"][0]["run"] = bad_run
    proc = validate_proc(yaml.safe_dump(doc), tmp_path)
    assert proc.returncode != 0
    assert "Traceback" not in proc.stderr


@pytest.mark.parametrize("bad_if", [True, 5])
def test_nonstring_if_fails_cleanly(tmp_path: Path, bad_if: object) -> None:
    # A non-string `if:` on the review step must not crash the gate checks.
    doc = yaml.safe_load(WORKFLOW.read_text())
    for s in doc["jobs"]["ocr-review"]["steps"]:
        if isinstance(s, dict) and "alibaba/open-code-review@" in str(s.get("uses", "")):
            s["if"] = bad_if
    proc = validate_proc(yaml.safe_dump(doc), tmp_path)
    assert proc.returncode != 0
    assert "Traceback" not in proc.stderr


def test_rejects_secret_interpolated_in_other_job(tmp_path: Path) -> None:
    # Hygiene checks apply to every job: a second job interpolating a secret
    # into run: must trip the validator even though the ocr-review job is clean.
    doc = yaml.safe_load(WORKFLOW.read_text())
    doc["jobs"]["exfiltrate"] = {
        "runs-on": "ubuntu-latest",
        "steps": [{"run": "echo ${{ secrets.ZAI_API_KEY }}"}],
    }
    proc = validate_proc(yaml.safe_dump(doc), tmp_path)
    assert proc.returncode != 0
    assert "[FAIL] no secrets.* interpolated in any run: script" in proc.stdout


def test_rejects_multiline_if_with_secret(tmp_path: Path) -> None:
    # A folded multi-line `if:` block containing secrets.* must trip the
    # validator — the check reads parsed values, not raw-text lines.
    text = mutate(
        WORKFLOW.read_text(),
        "if: steps.key-check.outputs.present == 'true' && steps.env-guard.outputs.blocked == 'false'",
        "if: >\n          steps.key-check.outputs.present == 'true' &&\n          secrets.ZAI_API_KEY != ''",
    )
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "[FAIL] no secrets.* in any `if:` condition" in proc.stdout


def test_rejects_env_guard_without_no_renames(tmp_path: Path) -> None:
    # With rename detection, a renamed .env* shows only the new path, so the
    # old path's secrets (present as removed lines) would slip through.
    text = mutate(
        WORKFLOW.read_text(),
        'git diff --name-only --no-renames "$1" "$2"',
        'git diff --name-only "$1" "$2"',
    )
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "[FAIL] env-guard disables rename detection" in proc.stdout


@pytest.mark.parametrize("bad_permissions", [None, "write-all", ["contents"]])
def test_malformed_permissions_fails_cleanly(tmp_path: Path, bad_permissions: object) -> None:
    # `permissions:` nulled (or set to a non-mapping) must surface as
    # validator FAILs, not a TypeError from set(None).
    doc = yaml.safe_load(WORKFLOW.read_text())
    doc["permissions"] = bad_permissions
    proc = validate_proc(yaml.safe_dump(doc), tmp_path)
    assert proc.returncode != 0
    assert "Traceback" not in proc.stderr


@pytest.mark.parametrize("bad_jobs", [[1], "oops"])
def test_malformed_jobs_fails_cleanly(tmp_path: Path, bad_jobs: object) -> None:
    # `jobs:` as a non-mapping must fail closed, not raise AttributeError on
    # the unguarded `.get` chains.
    doc = yaml.safe_load(WORKFLOW.read_text())
    doc["jobs"] = bad_jobs
    proc = validate_proc(yaml.safe_dump(doc), tmp_path)
    assert proc.returncode != 0
    assert "Traceback" not in proc.stderr


@pytest.mark.parametrize("bad_with", [5, "oops", ["x"]])
def test_malformed_with_fails_cleanly(tmp_path: Path, bad_with: object) -> None:
    # A non-mapping `with:` on the review step must fail closed, not raise
    # AttributeError on `.get`.
    doc = yaml.safe_load(WORKFLOW.read_text())
    for s in doc["jobs"]["ocr-review"]["steps"]:
        if isinstance(s, dict) and "alibaba/open-code-review@" in str(s.get("uses", "")):
            s["with"] = bad_with
    proc = validate_proc(yaml.safe_dump(doc), tmp_path)
    assert proc.returncode != 0
    assert "Traceback" not in proc.stderr


# --- Behavioral tests for the env-guard bash block -----------------------
# The validator pins the guard's structure, but structural substrings cannot
# catch semantic mutations (e.g. flipping the blocked=false branch). These
# tests extract the real run block and execute it against fixture git repos.


def guard_script() -> str:
    doc = yaml.safe_load(WORKFLOW.read_text())
    for s in doc["jobs"]["ocr-review"]["steps"]:
        if isinstance(s, dict) and s.get("id") == "env-guard":
            run = s.get("run")
            assert isinstance(run, str)
            return run
    raise AssertionError("env-guard step missing from workflow")


def git(cwd: Path, *args: str) -> str:
    proc = subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)
    return proc.stdout.strip()


def make_merge_repo(tmp_path: Path, pr_changes, base_late_changes=None) -> Path:
    """Fixture repo whose HEAD is a true merge commit; the base tracks a
    real .env (like this repo does). pr_changes mutates the PR branch;
    base_late_changes (optional) commits on the base branch after the PR
    branched — simulating a stale PR branch with base-side changes."""
    repo = tmp_path / "fixture-repo"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "config", "user.email", "guard-test@example.com")
    git(repo, "config", "user.name", "guard-test")
    (repo / "apps" / "engine").mkdir(parents=True)
    (repo / "apps" / "engine" / ".env").write_text("SECRET=base")
    (repo / "base.txt").write_text("base")
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "base with tracked .env")
    git(repo, "checkout", "-qb", "pr")
    pr_changes(repo)
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "pr work")
    pr_head = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "-")
    if base_late_changes is not None:
        base_late_changes(repo)
        git(repo, "add", ".")
        git(repo, "commit", "-qm", "base-side change after PR branched")
    git(repo, "merge", "-q", "--no-ff", "pr", "-m", "merge pr")
    # Expose the PR head under the refs/pull/N/head pseudo-ref and add the
    # repo as its own "origin", so the guard's event-range fetch works
    # against the fixture.
    git(repo, "update-ref", "refs/pull/60/head", pr_head)
    git(repo, "remote", "add", "origin", str(repo))
    return repo


def run_guard(repo: Path, outcome: str, tmp_path: Path) -> str:
    output_file = tmp_path / "github_output"
    output_file.write_text("")
    env = {
        **os.environ,
        "GUARD_OUTCOME": outcome,
        "GITHUB_OUTPUT": str(output_file),
        "PR_NUMBER": "60",
        "BASE_REF": git(repo, "branch", "--show-current"),
    }
    proc = subprocess.run(
        ["bash", "-c", guard_script()],
        cwd=repo,
        env=env,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    values = dict(
        line.split("=", 1) for line in output_file.read_text().splitlines() if "=" in line
    )
    return values.get("blocked", "<missing>")


def test_guard_blocks_env_touching_merge(tmp_path: Path) -> None:
    def change(repo: Path) -> None:
        (repo / "apps" / "engine" / ".env").write_text("SECRET=changed")

    repo = make_merge_repo(tmp_path, change)
    assert run_guard(repo, "success", tmp_path) == "true"


def test_guard_allows_clean_merge(tmp_path: Path) -> None:
    def change(repo: Path) -> None:
        (repo / "README.md").write_text("docs")

    repo = make_merge_repo(tmp_path, change)
    assert run_guard(repo, "success", tmp_path) == "false"


def test_guard_blocks_renamed_env(tmp_path: Path) -> None:
    # Rename detection would show only the new path; the guard disables it
    # so the deleted old .env path still matches.
    def change(repo: Path) -> None:
        git(repo, "mv", "apps/engine/.env", "apps/engine/config.txt")

    repo = make_merge_repo(tmp_path, change)
    assert run_guard(repo, "success", tmp_path) == "true"


def test_guard_skips_non_merge_head(tmp_path: Path) -> None:
    # A fast-forward merge ref resolves to a single-parent commit; HEAD^1
    # is then just the previous PR commit, so the diff would miss a .env*
    # change from an earlier commit — the guard must fail closed. The .env
    # touch sits in the first commit so a weakened shape check (-ge 1)
    # would wrongly report blocked=false here.
    repo = tmp_path / "fixture-repo"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "config", "user.email", "guard-test@example.com")
    git(repo, "config", "user.name", "guard-test")
    (repo / "apps" / "engine").mkdir(parents=True)
    (repo / "apps" / "engine" / ".env").write_text("SECRET=1")
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "first commit touches .env")
    (repo / "README.md").write_text("docs")
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "second commit is clean")
    assert run_guard(repo, "success", tmp_path) == "true"


def test_guard_skips_when_checkout_failed(tmp_path: Path) -> None:
    def change(repo: Path) -> None:
        (repo / "README.md").write_text("docs")

    repo = make_merge_repo(tmp_path, change)
    assert run_guard(repo, "failure", tmp_path) == "true"


def test_rejects_default_open_env_guard_gate(tmp_path: Path) -> None:
    # `blocked != 'true'` runs the review when the output is missing/empty
    # (e.g. a refactor dropping the echo); the gate must be fail-closed.
    text = mutate(
        WORKFLOW.read_text(),
        "steps.env-guard.outputs.blocked == 'false'",
        "steps.env-guard.outputs.blocked != 'true'",
    )
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "[FAIL] review gated on env-guard (fail-closed == 'false')" in proc.stdout


def test_parent_words_coercion_is_explicit() -> None:
    # `[ "" -ge 3 ]` would print "integer expression expected" and rely on
    # set -e if-condition semantics; the guard must normalize and coerce
    # explicitly. (The run_guard behavioral tests above execute the real
    # script with real wc output, proving the whitespace normalization does
    # not break the padded numbers wc actually emits.)
    script = guard_script()
    assert "${parent_words//[[:space:]]/}" in script
    assert 'case "$parent_words"' in script


def test_rejects_env_guard_without_pr_head_range(tmp_path: Path) -> None:
    # Dropping the HEAD^2..HEAD range (which catches base-side changes the
    # merge absorbed) must trip the validator.
    text = mutate(WORKFLOW.read_text(), '"HEAD^2 HEAD" ', "")
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "[FAIL] env-guard covers merge-vs-PR-head range" in proc.stdout


def test_rejects_env_guard_without_event_range(tmp_path: Path) -> None:
    # Dropping the event base..head fetch must trip the validator.
    text = mutate(
        WORKFLOW.read_text(),
        ' "refs/remotes/guard/base-tip refs/remotes/guard/pr-head"',
        "",
    )
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "[FAIL] env-guard covers event base..head range" in proc.stdout


def test_rejects_env_guard_without_pr_context(tmp_path: Path) -> None:
    # The guard script needs PR_NUMBER/BASE_REF from env:; dropping the
    # wiring must trip the validator.
    text = mutate(
        WORKFLOW.read_text(),
        "\n          PR_NUMBER: ${{ github.event.pull_request.number }}",
        "",
    )
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "[FAIL] env-guard receives PR context via env:" in proc.stdout


def test_rejects_floating_action_tag(tmp_path: Path) -> None:
    # Unpinning a first-party action back to a floating tag must trip the
    # validator's all-actions SHA-pin check.
    text = mutate(
        WORKFLOW.read_text(),
        "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
        "actions/checkout@v4",
    )
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "[FAIL] all actions pinned to full SHAs" in proc.stdout


def test_guard_blocks_base_side_env_rotation(tmp_path: Path) -> None:
    # M1: the PR branches when .env is V1; the base rotates .env to V2; the
    # PR never touches .env. HEAD^1..HEAD is V2..V2 (clean), so the old
    # guard would allow the review — but the base..head ranges surface the
    # rotation and must block.
    def pr_change(repo: Path) -> None:
        (repo / "README.md").write_text("pr change")

    def rotate_env(repo: Path) -> None:
        (repo / "apps" / "engine" / ".env").write_text("SECRET=V2")

    repo = make_merge_repo(tmp_path, pr_change, base_late_changes=rotate_env)
    assert run_guard(repo, "success", tmp_path) == "true"


def test_guard_blocks_env_in_event_base_head_range(tmp_path: Path) -> None:
    # R3 isolation: the merge ref itself is .env-clean, but the fetched
    # event refs (base-tip..pr-head) touch .env — proving the
    # event-payload range is actually consulted, not just present.
    def clean_change(repo: Path) -> None:
        (repo / "README.md").write_text("docs")

    repo = make_merge_repo(tmp_path, clean_change)
    git(repo, "checkout", "-q", "pr")
    (repo / "apps" / "engine" / ".env").write_text("SECRET=V9")
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "touch .env after merge ref computed")
    git(repo, "update-ref", "refs/pull/60/head", git(repo, "rev-parse", "HEAD"))
    git(repo, "checkout", "-q", "-")
    assert run_guard(repo, "success", tmp_path) == "true"


def test_rejects_early_artifact_upload(tmp_path: Path) -> None:
    # 2026-09-29: an earlier attempt uploading artifacts 409-conflicts with
    # the next attempt's upload (fixed per-run artifact name) and kills a
    # successful review before its comments post.
    text = mutate(
        WORKFLOW.read_text(),
        """          # No artifact upload here either: only the LAST attempt uploads
          # (fixed per-run artifact name would 409-conflict otherwise).
          upload_artifacts: 'false'""",
        "",
    )
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "only the last ocr attempt uploads artifacts" in proc.stdout


def test_rejects_missing_second_fallback(tmp_path: Path) -> None:
    text = mutate(WORKFLOW.read_text(), 'id: ocr-fallback-2', 'id: ocr-fallback-2-removed')
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "ocr second free-model fallback step exists" in proc.stdout


def test_rejects_second_fallback_missing_chain_gate(tmp_path: Path) -> None:
    text = mutate(
        WORKFLOW.read_text(),
        "&& steps.ocr-fallback.outcome == 'failure'",
        "",
    )
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "fallback 2 only runs when fallback 1 failed" in proc.stdout


def test_rejects_fallback_1_without_continue_on_error(tmp_path: Path) -> None:
    # Without continue-on-error on fallback 1, its failure ends the job
    # before fallback 2 ever runs — silently breaking the 3-level chain.
    text = mutate(
        WORKFLOW.read_text(),
        """        # second fallback below gets its chance. steps.ocr-fallback.outcome
        # still records 'failure', so the next gate stays accurate.
        continue-on-error: true""",
        "",
    )
    proc = validate_proc(text, tmp_path)
    assert proc.returncode != 0
    assert "fallback 1 has continue-on-error" in proc.stdout

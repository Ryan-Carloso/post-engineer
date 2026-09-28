#!/usr/bin/env python3
"""Structural validation for .github/workflows/ocr-review.yml.

Run: python3 .github/scripts/validate-ocr-review.py

Guards the design decisions of the Alibaba OpenCodeReview workflow:
- `pull_request` trigger (NOT pull_request_target: a brand-new workflow file
  never fires on its own PR under pull_request_target, which resolves the
  workflow from the base branch)
- secret gating via step outputs (secrets.* are unreliable in `if:`), and the
  secret is passed via `env:`, never interpolated into `run:` scripts
- .env* guard: the review is skipped when the PR touches secrets-bearing
  files (real secrets are never committed; this is defense in depth)
- least-privilege permissions, superseded-run cancellation
- the third-party action is SHA-pinned AND ocr_version is pinned (the action
  defaults to npm `latest`, which would float the reviewed binary)
- primary + free-model fallback share one action pin; the fallback retries
  with the permanently-free glm-4.7-flash on z.ai's standard endpoint when
  the primary attempt fails (e.g. quota exhausted)
- run steps use `shell: bash` + `set -euo pipefail`
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

WORKFLOW = Path(__file__).resolve().parent.parent / "workflows" / "ocr-review.yml"

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    status = "ok" if condition else "FAIL"
    print(f"[{status}] {name}" + (f" -- {detail}" if detail and not condition else ""))
    if not condition:
        FAILURES.append(name)


def as_str_dict(value: object) -> dict:
    """Return `value` if it is a dict, else {} — malformed YAML must surface
    as validator FAILs, never as AttributeError tracebacks."""
    return value if isinstance(value, dict) else {}


def main(workflow: Path = WORKFLOW) -> int:
    # Reset per-run: main() may be called more than once in the same process
    # (it accepts a workflow parameter for reuse), and stale FAILURES from a
    # prior run must not leak into the next run's exit code.
    FAILURES.clear()
    try:
        text = workflow.read_text()
        doc = yaml.safe_load(text)
        if not isinstance(doc, dict):
            raise TypeError("workflow root is not a mapping")
        # NOTE: in YAML 1.1 `on:` parses as boolean True
        triggers = doc.get(True, {})
        if not isinstance(triggers, dict):
            raise TypeError("`on:` block is not a mapping")
        trigger_types = triggers.get("pull_request", {}).get("types", [])
    except (OSError, yaml.YAMLError, AttributeError, TypeError) as e:
        check("workflow parses as expected document", False, str(e))
        return 1

    # Triggers. pull_request_target is detected in the parsed document, not
    # via raw-text indentation, so re-indentation or flow-style `on:` cannot
    # evade the prohibition (a new workflow file never fires on its own PR
    # under pull_request_target, which resolves the workflow from base).
    for event in ("opened", "synchronize", "reopened", "ready_for_review"):
        check(f"trigger includes pull_request:{event}", event in trigger_types)
    check("does not use pull_request_target", "pull_request_target" not in triggers)

    # Steps — fail closed with a clean FAIL instead of a traceback on
    # malformed workflows: this script exists to catch exactly these
    # regressions, so crashing on them defeats its purpose as a CI guard.
    try:
        steps = doc["jobs"]["ocr-review"]["steps"]
    except (KeyError, TypeError):
        check("job ocr-review with steps exists", False)
        return 1
    if not isinstance(steps, list):
        # `steps:` emptied to null (or a scalar) after deleting all steps
        # must fail closed with a clean FAIL, not a TypeError traceback
        # from the comprehensions below.
        check("job ocr-review with steps exists", False)
        return 1
    by_id = {s.get("id"): s for s in steps if isinstance(s, dict) and s.get("id")}

    # Hygiene checks (secrets/expressions in run:, shell discipline) apply to
    # every job in the workflow: a future job must not sneak in a secret
    # interpolation or a lax shell. The env-guard checks below stay scoped to
    # the ocr-review job, which is where the guard lives.
    all_steps: list[dict] = []
    if_vals: list = []
    jobs = doc.get("jobs")
    if isinstance(jobs, dict):
        for job in jobs.values():
            if not isinstance(job, dict):
                continue
            if "if" in job:
                if_vals.append(job["if"])
            job_steps = job.get("steps", [])
            if isinstance(job_steps, list):
                for s in job_steps:
                    if isinstance(s, dict):
                        all_steps.append(s)
                        if "if" in s:
                            if_vals.append(s["if"])

    # Secret gating must not rely on secrets.* inside job/step `if:`. The
    # values come from the parsed document (not a raw-text regex), so folded
    # multi-line `if: >` blocks cannot evade the check.
    check(
        "no secrets.* in any `if:` condition",
        not any("secrets." in str(v) for v in if_vals),
        f"if={if_vals}",
    )
    check("secret gate uses step outputs", "steps.key-check.outputs.present" in text)

    review_step = next(
        (
            s
            for s in steps
            if isinstance(s, dict) and "alibaba/open-code-review@" in str(s.get("uses", ""))
        ),
        None,
    )
    check("ocr review step exists", review_step is not None)
    if review_step is None:
        return 1
    cond = review_step.get("if", "")
    cond_str = cond if isinstance(cond, str) else ""
    check("review gated on key-check", "steps.key-check.outputs.present == 'true'" in cond_str, f"if={cond}")
    check(
        "review gated on env-guard (fail-closed == 'false')",
        "steps.env-guard.outputs.blocked == 'false'" in cond_str,
        f"if={cond}",
    )

    # Secrets are passed via env: / action inputs, never interpolated into
    # run: scripts. This is enforced generally (any secrets.*), not just for
    # one secret name, so a future step cannot sneak another one in.
    secret_uses = [ln for ln in text.splitlines() if "secrets.ZAI_API_KEY" in ln]
    check(
        "secret only referenced in env:/with: mappings",
        all(re.match(r"^\s*\w+:\s*\$\{\{\s*secrets\.ZAI_API_KEY\s*\}\}\s*(#.*)?$", ln) for ln in secret_uses)
        and len(secret_uses) >= 2,
        f"lines={secret_uses}",
    )
    run_blocks = [s.get("run", "") for s in all_steps if "run" in s]
    check(
        "run: values are strings",
        all(isinstance(r, str) for r in run_blocks),
        "non-string run: values crash substring checks — fail closed instead",
    )
    str_runs = [r for r in run_blocks if isinstance(r, str)]
    check(
        "no secrets.* interpolated in any run: script",
        not any("secrets." in r for r in str_runs),
        "pass secrets via env: instead (GitHub hardening guide)",
    )
    check(
        "no expressions interpolated in any run: script",
        not any("${{" in r for r in str_runs),
        "pass context via env: instead — the workflow's own policy",
    )

    # run: steps are explicit bash with strict mode
    for s in all_steps:
        if "run" in s:
            name = s.get("name", s.get("id", "?"))
            run = s.get("run")
            check(f"step '{name}' uses shell: bash", s.get("shell") == "bash")
            check(
                f"step '{name}' sets -euo pipefail",
                isinstance(run, str) and "set -euo pipefail" in run,
            )

    # .env* guard: skip review when the PR touches secrets-bearing files.
    # The pattern must live in the guard step's own run block, not just
    # somewhere in the file, or a refactor could drop the guard silently.
    check("env-guard step exists", "env-guard" in by_id)
    guard_step = by_id.get("env-guard")
    guard_run = guard_step.get("run", "") if isinstance(guard_step, dict) else ""
    if not isinstance(guard_run, str):
        guard_run = ""
    check(
        "env-guard runs before review",
        "env-guard" in by_id and list(by_id).index("env-guard") < steps.index(review_step),
    )
    check(
        "env-guard run block matches .env* paths",
        "grep -Eq '(^|/)\\.env'" in guard_run,
        "pattern must be enforced by the guard step itself",
    )
    check(
        "env-guard diffs git history, not the truncated API file list",
        "git diff" in guard_run and "gh pr view" not in guard_run,
        "the API file list truncates on large PRs; a .env* file past the cap would slip through",
    )
    check(
        "env-guard disables rename detection",
        "git diff --name-only --no-renames" in guard_run,
        "with rename detection a renamed .env* shows only the new path, "
        "so the old path's secrets (present as removed lines) would slip through",
    )
    check(
        "env-guard verifies merge-commit shape",
        "rev-list --parents" in guard_run,
        "a fast-forward merge ref would make HEAD^1 miss .env* changes from earlier commits",
    )
    check(
        "env-guard covers merge-vs-PR-head range",
        '"HEAD^2 HEAD"' in guard_run,
        "base-side changes absorbed by the merge (e.g. a rotated .env on a stale branch) only show in HEAD^2..HEAD",
    )
    check(
        "env-guard covers event base..head range",
        '"refs/remotes/guard/base-tip refs/remotes/guard/pr-head"' in guard_run,
        "the action may diff the event-payload SHAs instead of the merge ref",
    )
    guard_env = as_str_dict(guard_step.get("env")) if isinstance(guard_step, dict) else {}
    check(
        "env-guard receives PR context via env:",
        "PR_NUMBER" in guard_env and "BASE_REF" in guard_env,
        f"env={guard_env}",
    )

    # Concurrency + least-privilege permissions. A job-level `permissions:`
    # block overrides the top-level one in GitHub Actions, so any override
    # on the review job is rejected outright.
    check("concurrency cancels superseded runs", "cancel-in-progress: true" in text)
    perms = as_str_dict(doc.get("permissions"))
    check(
        "permissions are least-privilege",
        set(perms) <= {"contents", "pull-requests"}
        and perms.get("contents") == "read"
        and perms.get("pull-requests") == "write",
        f"permissions={perms}",
    )
    job_perms = as_str_dict(as_str_dict(doc.get("jobs")).get("ocr-review")).get("permissions")
    check("no job-level permissions override", job_perms is None, f"permissions={job_perms}")

    # Third-party action pinned by SHA, and the CLI version pinned too.
    # Every `uses:` entry (including first-party actions) must be SHA-pinned:
    # a floating major tag is a supply-chain hijack vector.
    uses = re.findall(r"^\s*uses:\s*(\S+)", text, re.M)
    check(
        "all actions pinned to full SHAs",
        len(uses) > 0 and all(bool(re.fullmatch(r"[^@\s]+@[0-9a-f]{40}", u)) for u in uses),
        f"uses={uses}",
    )
    ocr_uses = [u for u in uses if u.startswith("alibaba/open-code-review@")]
    check(
        "ocr action invocations share one pin",
        1 <= len(ocr_uses) <= 2 and len(set(ocr_uses)) == 1,
        f"uses={ocr_uses}",
    )
    ocr_version = str(as_str_dict(review_step.get("with")).get("ocr_version", ""))
    check(
        "ocr_version pinned (not npm latest)",
        bool(re.fullmatch(r"\d+\.\d+\.\d+", ocr_version)),
        f"ocr_version={ocr_version!r}",
    )

    # LLM wiring matches the sibling review workflow
    with_block = as_str_dict(review_step.get("with"))
    check("z.ai coding endpoint configured", with_block.get("llm_url") == "https://api.z.ai/api/coding/paas/v4")
    check("model configured", str(with_block.get("llm_model", "")).startswith("glm-"))
    check("openai-compatible protocol", str(with_block.get("llm_use_anthropic")) == "false")

    # Free-model fallback: when the primary attempt fails (e.g. quota
    # exhausted), retry with the permanently-free glm-4.7-flash on z.ai's
    # standard endpoint. Both invocations share one action pin (checked
    # above); the fallback carries the same fail-closed gates plus the
    # primary-failure condition.
    fallback_step = next(
        (s for s in steps if isinstance(s, dict) and s.get("id") == "ocr-fallback"),
        None,
    )
    check("ocr free-model fallback step exists", fallback_step is not None)
    if fallback_step is not None:
        fb_cond = fallback_step.get("if", "")
        fb_cond_str = fb_cond if isinstance(fb_cond, str) else ""
        check(
            "fallback gated on key-check",
            "steps.key-check.outputs.present == 'true'" in fb_cond_str,
            f"if={fb_cond}",
        )
        check(
            "fallback gated on env-guard (fail-closed == 'false')",
            "steps.env-guard.outputs.blocked == 'false'" in fb_cond_str,
            f"if={fb_cond}",
        )
        check(
            "fallback only runs when primary failed",
            "steps.ocr-primary.outcome == 'failure'" in fb_cond_str,
            f"if={fb_cond}",
        )
        fb_with = as_str_dict(fallback_step.get("with"))
        check(
            "fallback uses z.ai standard endpoint",
            fb_with.get("llm_url") == "https://api.z.ai/api/paas/v4",
            f"llm_url={fb_with.get('llm_url')!r}",
        )
        check(
            "fallback uses permanently-free Flash model",
            fb_with.get("llm_model") == "glm-4.7-flash",
            f"llm_model={fb_with.get('llm_model')!r}",
        )
        check(
            "fallback pins ocr_version",
            bool(re.fullmatch(r"\d+\.\d+\.\d+", str(fb_with.get("ocr_version", "")))),
            f"ocr_version={fb_with.get('ocr_version')!r}",
        )
        check(
            "fallback uses openai-compatible protocol",
            str(fb_with.get("llm_use_anthropic")) == "false",
            f"llm_use_anthropic={fb_with.get('llm_use_anthropic')!r}",
        )

    # Comment conventions
    check("ocr summary marker documented", "<!-- ocr-summary -->" in text)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} check(s) failed.")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else WORKFLOW
    sys.exit(main(target))

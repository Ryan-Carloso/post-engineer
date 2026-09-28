#!/usr/bin/env python3
"""Structural validation for .github/workflows/opencode-review.yml.

Run: python3 .github/scripts/validate-opencode-review.py

Guards the design decisions of the OpenCode review workflow:
- direct `opencode run` (verified against the installed CLI: there is no
  --standalone flag), no third-party wrapper
- z.ai Coding Plan and standard API fallback wiring (endpoints, env-keyed apiKey)
- secret gating via step outputs (secrets.* are unreliable in `if:`)
- a new PR comment per push, never updated in place (header carries head SHA)
- least-privilege permissions, superseded-run cancellation
- .env* cleanup before the agent runs (real secrets are gitignored and never committed)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

WORKFLOW = Path(__file__).resolve().parent.parent / "workflows" / "opencode-review.yml"

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    status = "ok" if condition else "FAIL"
    print(f"[{status}] {name}" + (f" -- {detail}" if detail and not condition else ""))
    if not condition:
        FAILURES.append(name)


def main() -> int:
    text = WORKFLOW.read_text()
    doc = yaml.safe_load(text)

    # Triggers
    # NOTE: in YAML 1.1 `on:` parses as boolean True
    triggers = doc.get(True, {}).get("pull_request", {}).get("types", [])
    for event in ("opened", "synchronize", "reopened", "ready_for_review"):
        check(f"trigger includes pull_request:{event}", event in triggers)

    # No third-party OpenCode action wrapper; only first-party actions allowed
    uses = re.findall(r"^\s*uses:\s*(\S+)", text, re.M)
    check("no anomalyco/opencode action", not any("anomalyco/opencode" in u for u in uses))
    check(
        "only first-party actions used",
        all(u.startswith("actions/") for u in uses),
        f"uses={uses}",
    )

    # Pinned OpenCode install (H5): never the floating opencode.ai/install
    # script — its download source is unpinned and has pointed at third-party
    # forks. The release artifact must be checksum-verified before execution.
    check(
        "no floating opencode.ai/install script",
        "opencode.ai/install" not in text,
        "install must be a pinned, checksum-verified release artifact",
    )
    check("pinned OPENCODE_VERSION set", "OPENCODE_VERSION:" in text)
    check("pinned OPENCODE_SHA256 set", "OPENCODE_SHA256:" in text)
    check("release checksum verified before use", "sha256sum -c" in text)
    check(
        "installs from official sst/opencode releases",
        "github.com/sst/opencode/releases/download" in text,
    )
    check("uses `opencode run`", "opencode run" in text)
    check(
        "does not use a `--standalone` flag",
        "opencode --standalone run" not in text and "opencode run --standalone" not in text,
    )

    # z.ai Coding Plan provider wiring
    check("z.ai coding endpoint configured", "https://api.z.ai/api/coding/paas/v4" in text)
    check("z.ai standard endpoint configured", "https://api.z.ai/api/paas/v4" in text)
    check("api key from ZAI_API_KEY env", '"{env:ZAI_API_KEY}"' in text)
    check("no ZHIPU_API_KEY references", "ZHIPU_API_KEY" not in text)
    check("OPENCODE_MODEL default set", "OPENCODE_MODEL: zai-coding-plan/" in text)
    check("free fallback model default set", "ZAI_FREE_MODEL: glm-" in text)
    check(
        "free fallback model is a permanently-free Flash model",
        re.search(r"^\s*ZAI_FREE_MODEL:\s*glm-\S*flash\s*$", text, re.M) is not None,
        "ZAI_FREE_MODEL must stay a free Flash model (e.g. glm-4.7-flash) "
        "so the fallback survives quota exhaustion",
    )
    check("standard API retry follows Coding Plan", "retrying with z.ai standard API" in text)

    # Secret gating must not rely on secrets.* inside job/step `if:`
    ifs = re.findall(r"^\s*if:\s*(.+)$", text, re.M)
    check(
        "no secrets.* in any `if:` condition",
        not any("secrets." in i for i in ifs),
        f"if={ifs}",
    )
    check("secret gate uses step outputs", "steps.check.outputs.has_key" in text)

    # A new PR comment per push, never updated in place
    check("review marker defined", "<!-- opencode-review -->" in text)
    check(
        "posts a new comment per run",
        "gh pr comment" in text,
    )
    check(
        "never patches an existing comment in place",
        "-X PATCH" not in text,
        "workflow must not PATCH issues/comments",
    )
    check(
        "review header carries the head SHA",
        "github.event.pull_request.head.sha" in text,
    )

    # Prompt-injection guard (H6): LLM output over attacker-controlled
    # PR title/diff must be scrubbed of secret material before it becomes a
    # permanent public PR comment.
    check("secret scrub step exists", "Scrub secrets from review output" in text)
    check("masks ZAI_API_KEY in logs", "::add-mask::" in text)
    check(
        "scrubs review.md before posting",
        "review.md" in text and "***REDACTED***" in text,
    )

    # Concurrency + least-privilege permissions
    check("concurrency cancels superseded runs", "cancel-in-progress: true" in text)
    perms = doc["jobs"]["review"].get("permissions", {})
    check(
        "permissions are least-privilege",
        set(perms) <= {"contents", "pull-requests"}
        and perms.get("contents") == "read"
        and perms.get("pull-requests") == "write",
        f"permissions={perms}",
    )

    # .env cleanup before the agent runs
    check("removes .env* before review", "-name '.env*'" in text)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} check(s) failed.")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

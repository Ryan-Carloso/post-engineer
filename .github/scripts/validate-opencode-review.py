#!/usr/bin/env python3
"""Structural validation for .github/workflows/opencode-review.yml.

Run: python3 .github/scripts/validate-opencode-review.py

Guards the design decisions of the OpenCode review workflow:
- direct `opencode run` (verified against the installed CLI: there is no
  --standalone flag), no third-party wrapper
- review chain (free-first, paid last resort): OpenRouter free router
  (openrouter/free) -> z.ai standard (glm-4.7-flash) -> z.ai Coding Plan ->
  OpenRouter auto router (openrouter/auto); glm-4.5-flash was dropped
  from the chain
- OpenRouter tiers use the special router ids (no hardcoded model list to
  rot — same convention as the engine's _PROVIDER_DEFAULT_MODELS), one
  OPENROUTER_API_KEY serving both tiers
- the job runs if EITHER key is configured; each tier is skipped when its
  key is missing (secret gating via step outputs: secrets.* are unreliable
  in `if:`)
- both keys masked in logs and scrubbed from review.md before the comment
  is posted
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
    check("z.ai fallback model default set", "ZAI_FREE_MODEL: glm-" in text)
    check(
        "z.ai fallback model is a permanently-free Flash model",
        re.search(r"^\s*ZAI_FREE_MODEL:\s*glm-\S*flash\s*$", text, re.M) is not None,
        "ZAI_FREE_MODEL must stay a free Flash model (e.g. glm-4.7-flash) "
        "so the fallback survives quota exhaustion",
    )
    # glm-4.5-flash was dropped from the chain (poor review quality):
    # neither the env var nor the model id may remain.
    check(
        "no ZAI_FREE_MODEL_FALLBACK references",
        "ZAI_FREE_MODEL_FALLBACK" not in text,
        "the second z.ai fallback was removed; no reference may remain",
    )
    # glm-4.5-flash was dropped from the chain (poor review quality):
    # it must not appear in any live workflow logic (historical notes in
    # comments are fine — the removal reason lives in AGENTS.md).
    non_comment_lines = [
        line for line in text.splitlines() if not line.lstrip().startswith("#")
    ]
    check(
        "no glm-4.5-flash in workflow logic",
        not any("glm-4.5-flash" in line for line in non_comment_lines),
        "glm-4.5-flash was dropped from the review chain",
    )

    # OpenRouter tiers: special router ids, one key for both tiers
    check(
        "OPENROUTER_FREE_MODEL default set",
        "OPENROUTER_FREE_MODEL: openrouter/free" in text,
        "must use the OpenRouter free router id, not a concrete model",
    )
    check(
        "OPENROUTER_MODEL default set",
        "OPENROUTER_MODEL: openrouter/auto" in text,
        "must use the OpenRouter auto router id, not a concrete model",
    )
    check(
        "OpenRouter endpoint configured",
        "https://openrouter.ai/api/v1" in text,
    )
    check(
        "OpenRouter api key from env",
        '"{env:OPENROUTER_API_KEY}"' in text,
    )
    check(
        "OpenRouter provider uses openai-compatible package",
        text.count('"npm": "@ai-sdk/openai-compatible"') >= 2,
        "the openrouter provider must use the same npm package as z.ai",
    )
    check(
        "attempt order documented: openrouter free -> 4.7 -> coding plan -> openrouter paid",
        all(
            marker in text
            for marker in (
                "OpenRouter free router ->",
                "z.ai standard (glm-4.7-flash) -> z.ai Coding Plan ->",
                "OpenRouter auto router",
            )
        ),
        "the review step comments must pin the four-tier attempt order",
    )

    # Two-key gating: the job runs if EITHER key is configured; each tier is
    # skipped when its key is missing. Gating must not rely on secrets.*
    # inside job/step `if:`.
    ifs = re.findall(r"^\s*if:\s*(.+)$", text, re.M)
    check(
        "no secrets.* in any `if:` condition",
        not any("secrets." in i for i in ifs),
        f"if={ifs}",
    )
    check("secret gate uses step outputs", "steps.check.outputs.has_key" in text)
    check(
        "per-tier key outputs recorded",
        "has_zai_key=" in text and "has_openrouter_key=" in text,
        "the check step must record one output per provider key",
    )
    check(
        "tiers skipped when their key is missing",
        '"${ZAI_API_KEY:-}"' in text and '"${OPENROUTER_API_KEY:-}"' in text,
        "the attempt list must be built from the keys actually present",
    )

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
    # permanent public PR comment. Both keys are masked in logs and scrubbed.
    check("secret scrub step exists", "Scrub secrets from review output" in text)
    check(
        "masks both keys in logs",
        text.count("::add-mask::") >= 2
        and "::add-mask::${ZAI_API_KEY}" in text
        and "::add-mask::${OPENROUTER_API_KEY}" in text,
        "both ZAI_API_KEY and OPENROUTER_API_KEY must be masked",
    )
    check(
        "scrubs review.md before posting",
        "review.md" in text and "***REDACTED***" in text,
    )
    check(
        "scrubs both key values from review.md",
        'for var in ("ZAI_API_KEY", "OPENROUTER_API_KEY")' in text,
        "the scrub step must iterate over both key env vars",
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

#!/usr/bin/env python3
"""Structural validation for .github/workflows/opencode-review.yml.

Run: python3 .github/scripts/validate-opencode-review.py

Guards the design decisions of the OpenCode review workflow:
- direct `opencode run` (verified against the installed CLI: there is no
  --standalone flag), no third-party wrapper
- runtime model chain via select-review-models.py and model-preferences.json
  (free models first, paid fallbacks last); glm-4.5-flash was dropped
- OpenRouter free tier uses the special router id (no hardcoded model list
  to rot — same convention as the engine's _PROVIDER_DEFAULT_MODELS), one
  OPENROUTER_API_KEY serving both tiers
- the job always runs (free OpenCode models need no secret); each paid tier
  is skipped when its key is missing (secret gating via step outputs)
- both keys masked in logs and scrubbed from review.md before the comment
  is posted
- a new PR comment per push, never updated in place (header carries head SHA)
- least-privilege permissions, superseded-run cancellation
- .env* cleanup before the agent runs (real secrets are gitignored and never committed)
"""
from __future__ import annotations

import json
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
    check(
        "api key built from env placeholder",
        '"{env:%s}" % key_var' in text,
        "provider apiKey must be built as {env:<KEY_VAR>} from the key variable",
    )
    check(
        "providers map to their own key variable",
        '''if base_url == "https://opencode.ai/zen/v1":
                  key_var = "OPENCODE_ZEN_API_KEY"''' in text
        and '''elif "z.ai" in base_url:
                  key_var = "ZAI_API_KEY"''' in text
        and '''else:
                  key_var = "OPENROUTER_API_KEY"''' in text,
        "opencode/z.ai/openrouter providers must map to their own key variable",
    )
    check("OpenCode Zen endpoint configured", "https://opencode.ai/zen/v1" in text)
    check(
        "OPENCODE_ZEN_API_KEY masked and scrubbed",
        "::add-mask::${OPENCODE_ZEN_API_KEY}" in text
        and "OPENCODE_ZEN_API_KEY" in text[text.index("Scrub secrets from review output") :],
    )
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
        "OPENROUTER_MODEL: z-ai/glm-5.3-flash" in text,
        "paid tier must pin z-ai/glm-5.3-flash, not the auto router",
    )
    check(
        "OpenRouter endpoint configured",
        "https://openrouter.ai/api/v1" in text,
    )
    check(
        "OpenRouter provider uses openai-compatible package",
        text.count('"npm": "@ai-sdk/openai-compatible"') >= 2,
        "the openrouter provider must use the same npm package as z.ai",
    )
    prefs_path = Path(__file__).resolve().parent.parent / "review" / "model-preferences.json"
    check("model preferences file exists", prefs_path.is_file(), str(prefs_path))
    prefs = json.loads(prefs_path.read_text()) if prefs_path.is_file() else {}
    check(
        "select-review-models.py invoked in workflow",
        "select-review-models.py" in text,
    )
    check(
        "pass 1 loads attempts from review-model-chain.json",
        "review-model-chain.json" in text and "mapfile -t attempts" in text,
    )
    check(
        "free-model banner uses chain freeModels list",
        "freeModels" in text and "mapfile -t FREE_MODELS" in text,
    )
    check(
        "opencode run closes stdin",
        "< /dev/null" in text,
        "non-interactive review must not read from stdin",
    )
    check(
        "attempt order is printed before the first model runs",
        text.find("Review attempt order:") != -1
        and text.find("Review attempt order:") < text.find("Attempting review with"),
    )
    max_chain = int(prefs.get("maxChainLength") or 8)
    pass1_minutes = 10 + max(max_chain - 1, 0) * 7
    pass2_minutes = 8
    overhead_minutes = 5
    required_minutes = pass1_minutes + pass2_minutes + overhead_minutes
    timeout_match = re.search(r"^\s*timeout-minutes:\s*(\d+)\s*$", text, re.M)
    timeout_minutes = int(timeout_match.group(1)) if timeout_match else 0
    check(
        "job timeout covers max chain plus pass 2",
        timeout_minutes >= required_minutes,
        f"timeout-minutes is {timeout_minutes}; max chain {max_chain} needs at "
        f"least {required_minutes}m",
    )
    check(
        "review is not skipped when paid keys are missing",
        "has_key=false" not in text,
    )
    check(
        "free models still run without paid keys",
        "free models only" in text,
    )

    # The machine-checked finding format lives in the prompt file, not in
    # the workflow. Absence of a guard is a finding: the prompt must not
    # tell the model to skip issues it cannot quote.
    prompt_path = Path(__file__).resolve().parent.parent / "review" / "review-prompt.md"
    prompt = prompt_path.read_text()
    check(
        "prompt requires verbatim code quotes",
        "verbatim" in prompt,
        "each finding must quote its cited code verbatim",
    )
    check(
        "prompt treats a missing guard as a finding",
        "absence of code is a finding" in prompt and "cannot quote verbatim" not in prompt,
        "do not tell the model to drop findings it cannot quote",
    )
    check(
        "prompt defines the machine-checkable finding format",
        "### SEVERITY:" in prompt and "**Location:**" in prompt,
    )
    review_dir = prompt_path.parent
    english = "Write the entire review in English."
    for name in (
        "review-prompt.md",
        "verify-prompt.md",
        "review-checklist.md",
        "review-instructions.md",
    ):
        check(
            f"{name} requires English output",
            english in (review_dir / name).read_text(),
            "posted review text must be required to be English",
        )
    check(
        "grounding verifier script invoked in workflow",
        "verify-review-grounding.py" in text,
    )
    check(
        "pass 1 grounding receives the changed-file list",
        "review.md pass1.md --context pr-context.md --files pr-files.txt" in text,
    )
    check(
        "pass 2 grounding receives the changed-file list",
        "pass2-raw.md pass2.md --context pr-context.md --files pr-files.txt" in text,
    )
    # Idea C — mechanical checks outside the LLM (replaces the old
    # TDD-coverage prompt bullet).
    check(
        "mechanical checks script invoked in workflow",
        "review-mechanical-checks.py" in text,
    )
    check(
        "mechanical checks section appended to the comment",
        "## Mechanical checks" in text,
    )
    check(
        "prompt no longer asks the LLM to flag test coverage",
        "flag new or changed production logic that ships without test coverage"
        not in text,
        "test-coverage flagging moved to the mechanical checks script",
    )
    check(
        "mechanical failures fail the job",
        "Fail job on mechanical check failure" in text,
    )
    # skipped when its key is missing. Gating must not rely on secrets.*
    # inside job/step `if:`.
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
        "has_zai_key=" in text
        and "has_openrouter_key=" in text
        and "has_opencode_key=" in text,
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
        "masking happens before any LLM output is logged",
        text.index("Mask provider secrets") < text.index("Verify review grounding"),
        "the add-mask step must precede the grounding step, which echoes "
        "dropped finding headings",
    )
    check(
        "scrubs review.verified.md before posting",
        "review.verified.md" in text and "***REDACTED***" in text,
        "the scrub step must target the posted artifact review.verified.md, "
        "not the raw review.md",
    )
    check(
        "scrubs both key values from review.md",
        'for var in ("ZAI_API_KEY", "OPENROUTER_API_KEY", "OPENCODE_ZEN_API_KEY")' in text,
        "the scrub step must iterate over every provider key env var",
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

    # The PR diff must be built from the local checkout (git diff), never
    # `gh pr diff`: the patch-diff CDN can serve a stale diff in the minutes
    # after a push, which once failed the job on an already-fixed line.
    check("PR diff built locally, not via gh pr diff", "gh pr diff" not in text)

    # Review script unit tests are wired into CI (TDD rule for the new
    # parsing/security logic in the review scripts).
    ci_path = Path(__file__).resolve().parent.parent / "workflows" / "ci.yml"
    check(
        "review script unit tests run in CI",
        "pytest .github/scripts/tests" in ci_path.read_text(),
        "the review-workflows job must run the script unit tests",
    )

    # Reviewer agent, grounding failure, and the scripts that feed the model.
    check("review runs with the reviewer agent", "--agent reviewer" in text)
    check(
        "project config and root AGENTS.md are not loaded",
        "OPENCODE_DISABLE_PROJECT_CONFIG=1" in text,
    )
    check(
        "reviewer instructions file is referenced",
        "review-instructions.md" in text,
    )
    check(
        "primary model comes from a repo variable",
        "vars.REVIEW_MODEL_PRIMARY" in text,
    )
    check("heuristic script invoked", "review-heuristics.py" in text)
    check("review context script invoked", "review-context.py" in text)
    check(
        "fully dropped review fails the job after the comment is posted",
        "review-grounding: not-reviewed" in text
        and text.index("Post review as a new PR comment")
        < text.index("Fail job on mechanical check failure")
        and "review-grounding: not-reviewed"
        in text[text.index("Fail job on mechanical check failure") :],
    )
    upload_uses = [item for item in uses if item.startswith("actions/upload-artifact@")]
    check(
        "upload-artifact pinned to a commit SHA",
        len(upload_uses) == 1
        and re.fullmatch(r"actions/upload-artifact@[0-9a-f]{40}", upload_uses[0]) is not None,
        f"upload uses={upload_uses}",
    )
    check(
        "upload-artifact is not a floating tag",
        not any(item.startswith("actions/upload-artifact@v") for item in uses),
    )

    root = Path(__file__).resolve().parent.parent.parent
    agent_text = (root / ".opencode" / "agent" / "reviewer.md").read_text()
    frontmatter = agent_text.split("---", 2)[1]
    check(
        "reviewer agent mode is primary",
        re.search(r"^mode:\s*primary\s*$", frontmatter, re.M) is not None
        and "subagent" not in frontmatter,
    )
    check(
        "reviewer denies edit and bash",
        re.search(r"^  edit:\s*deny\s*$", agent_text, re.M) is not None
        and re.search(r"^  bash:\s*deny\s*$", agent_text, re.M) is not None,
    )

    print()
    if FAILURES:
        print(f"{len(FAILURES)} check(s) failed.")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

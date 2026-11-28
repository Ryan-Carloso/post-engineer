#!/usr/bin/env python3
"""Structural validation for .github/workflows/opencode-review.yml.

Run: python3 .github/scripts/validate-opencode-review.py

Guards the design decisions of the OpenCode review workflow:
- direct `opencode run` (verified against the installed CLI: there is no
  --standalone flag), no third-party wrapper
- static model chain in REVIEW_MODELS: two OpenCode free models measured on
  the real review prompt, 12 minutes per attempt
- the job always runs (free OpenCode models need no secret); each paid tier
  is skipped when its key is missing (secret gating via step outputs)
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

    triggers = doc.get(True, {}).get("pull_request", {}).get("types", [])
    for event in ("opened", "synchronize", "reopened", "ready_for_review"):
        check(f"trigger includes pull_request:{event}", event in triggers)

    uses = re.findall(r"^\s*uses:\s*(\S+)", text, re.M)
    check("no anomalyco/opencode action", not any("anomalyco/opencode" in u for u in uses))
    check(
        "only first-party actions used",
        all(u.startswith("actions/") for u in uses),
        f"uses={uses}",
    )

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

    check(
        "api key built from env placeholder",
        '"{env:%s}" % key_var' in text,
        "provider apiKey must be built as {env:<KEY_VAR>} from the key variable",
    )
    check(
        "providers map to their own key variable",
        '''if base_url == "https://opencode.ai/zen/v1":
                  key_var = "OPENCODE_ZEN_API_KEY"''' in text
        and '''else:
                  key_var = "OPENROUTER_API_KEY"''' in text,
        "opencode/openrouter providers must map to their own key variable",
    )
    check("OpenCode Zen endpoint configured", "https://opencode.ai/zen/v1" in text)
    check(
        "OPENCODE_ZEN_API_KEY masked and scrubbed",
        "::add-mask::${OPENCODE_ZEN_API_KEY}" in text
        and "OPENCODE_ZEN_API_KEY" in text[text.index("Scrub secrets from review output") :],
    )
    check("no ZHIPU_API_KEY references", "ZHIPU_API_KEY" not in text)
    chain_match = re.search(r"^  REVIEW_MODELS: \$\{\{ vars\.REVIEW_MODELS \|\| '([^']+)' \}\}$", text, re.M)
    chain = chain_match.group(1).split(",") if chain_match else []
    check(
        "REVIEW_MODELS default races the measured models across two providers",
        chain
        == [
            "opencode/nemotron-3.5-lightning-free",
            "opencode/flint-40b-free",
            "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
        ],
        f"chain={chain}",
    )
    check(
        "REVIEW_MODEL_VERIFY default is flint-40b-free",
        "REVIEW_MODEL_VERIFY: ${{ vars.REVIEW_MODEL_VERIFY || 'opencode/flint-40b-free' }}" in text,
    )
    check(
        "pass 2 never verifies with the model that won pass 1",
        'if [ "$verify" = "$pass1_model" ]; then' in text
        and '[ "$candidate" != "$pass1_model" ]' in text,
    )

    check(
        "no OPENROUTER_MODEL paid z-ai default",
        "OPENROUTER_MODEL: z-ai/glm-5.3-flash" not in text,
    )
    check(
        "OpenRouter endpoint configured",
        "https://openrouter.ai/api/v1" in text,
    )
    check(
        "OpenRouter provider uses openai-compatible package",
        text.count('"npm": "@ai-sdk/openai-compatible"') >= 1,
        "the openrouter provider must use the openai-compatible package",
    )
    check(
        "no runtime model discovery",
        "select-review-models.py" not in text
        and "model-preferences.json" not in text
        and "review-model-chain.json" not in text,
        "the chain is the static REVIEW_MODELS list",
    )
    check(
        "pass 1 reads attempts from REVIEW_MODELS",
        'read -r -a requested <<< "$REVIEW_MODELS"' in text,
    )
    check(
        "free-model banner matches free ids",
        '[[ "$1" == *-free || "$1" == *:free ]]' in text,
    )
    check(
        "opencode run closes stdin",
        "< /dev/null" in text,
        "non-interactive review must not read from stdin",
    )
    check(
        "pass 1 starts every model in parallel",
        'for i in "${!attempts[@]}"; do' in text
        and 'start_attempt "$i" "${attempts[$i]}"' in text
        and text.find('start_attempt "$i"') < text.find("while [ -z \"$chosen\" ]"),
        "a hung free model must not delay the others",
    )
    check(
        "pass 1 stops the losing attempts",
        'kill -- "-$(cat "attempt-$i.pid")"' in text
        and "setsid timeout 12m opencode run" in text,
    )
    check(
        "parallel attempts use separate OpenCode data dirs",
        'XDG_DATA_HOME="$RUNNER_TEMP/opencode-attempt-$i/data"' in text,
    )
    check(
        "pass 1 attempt timeout is 12m",
        text.count("timeout 12m opencode run") == 2,
        "a working review finishes in under 10 minutes; a hung model must not hold the job longer",
    )
    attempt_minutes = 12
    overhead_minutes = 5
    required_minutes = attempt_minutes + attempt_minutes + overhead_minutes
    timeout_match = re.search(r"^\s*timeout-minutes:\s*(\d+)\s*$", text, re.M)
    timeout_minutes = int(timeout_match.group(1)) if timeout_match else 0
    check(
        "job timeout covers parallel pass 1 plus pass 2",
        timeout_minutes >= required_minutes,
        f"timeout-minutes is {timeout_minutes}; parallel pass 1 plus pass 2 "
        f"need at least {required_minutes}m",
    )
    check(
        "review is not skipped when paid keys are missing",
        "has_key=false" not in text,
    )
    check(
        "free models still run without paid keys",
        "free models only" in text,
    )

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
    check(
        "prompt verdict is APPROVE or REQUEST_CHANGES only",
        "Verdict: APPROVE | REQUEST_CHANGES" in prompt
        and "APPROVE_WITH_NITS" not in prompt,
        "Ryan: any posted finding is REQUEST_CHANGES; there is no NITS verdict",
    )
    check(
        "APPROVE requires zero ### headings",
        "zero `###` headings" in prompt and "No material findings." in prompt,
    )
    check(
        "pass 2 OpenCode free needs no paid key",
        '[[ "$verify" == *-free ]]' in text,
    )
    check(
        "pass 2 paid OpenCode still needs zen key",
        "OPENCODE_ZEN_API_KEY" in text[text.index("key_ok=false") :],
    )
    verify_prompt = (prompt_path.parent / "verify-prompt.md").read_text()
    check(
        "verify-prompt has no APPROVE_WITH_NITS verdict",
        "APPROVE_WITH_NITS" not in verify_prompt
        and "Verdict: APPROVE | REQUEST_CHANGES" in verify_prompt,
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
    ifs = re.findall(r"^\s*if:\s*(.+)$", text, re.M)
    check(
        "no secrets.* in any `if:` condition",
        not any("secrets." in i for i in ifs),
        f"if={ifs}",
    )
    check("secret gate uses step outputs", "steps.check.outputs.has_key" in text)
    step_ids = {
        step["id"] for step in doc["jobs"]["review"]["steps"] if "id" in step
    }
    referenced_ids = set(re.findall(r"steps\.([A-Za-z0-9_-]+)\.", text))
    check(
        "an attempt without a Verdict line fails in both passes",
        text.count("grep -qE '^Verdict: (APPROVE|REQUEST_CHANGES)'") == 2
        and '"attempt-$i.md"; then' in text
        and "pass2-raw.md; then" in text,
        "narration with no verdict must not be posted as a review",
    )
    check(
        "every referenced step id exists",
        referenced_ids <= step_ids,
        f"missing ids: {sorted(referenced_ids - step_ids)}",
    )
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

    check("concurrency cancels superseded runs", "cancel-in-progress: true" in text)
    perms = doc["jobs"]["review"].get("permissions", {})
    check(
        "permissions are least-privilege",
        set(perms) <= {"contents", "pull-requests"}
        and perms.get("contents") == "read"
        and perms.get("pull-requests") == "write",
        f"permissions={perms}",
    )

    check("removes .env* before review", "-name '.env*'" in text)

    check("PR diff built locally, not via gh pr diff", "gh pr diff" not in text)

    ci_path = Path(__file__).resolve().parent.parent / "workflows" / "ci.yml"
    check(
        "review script unit tests run in CI",
        "pytest .github/scripts/tests" in ci_path.read_text(),
        "the review-workflows job must run the script unit tests",
    )

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
        "model chain comes from a repo variable",
        "vars.REVIEW_MODELS" in text,
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
        "reviewer agent step budget is 120",
        re.search(r"^steps:\s*120\s*$", frontmatter, re.M) is not None,
        "steps: 40 died on PR #586 (83 files, diff truncated at 200 KB); "
        "120 gives the reviewer room to finish",
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

# API naming lint

CI gate (`.github/workflows/api-naming.yml`) that blocks bad or ambiguous
names in externally-exposed API contracts — e.g. a `replay` field whose
meaning isn't clear from the JSON alone. Triggered by an agent adding a
`replayed` field that required internal knowledge to understand.

## How it works

1. **Diff-based.** Only names **added** in the PR diff are checked, and only
   inside the contract surface (`api_paths` in `.github/api-naming.yml`):
   - `apps/web/app/api/**/route.ts` (Next.js route response/request shapes)
   - `apps/mcp/src/tools.ts` (Zod tool schemas)
   - `apps/engine/app/models/**/*.py` + `apps/engine/app/controllers/**/*.py` (Pydantic models)
   
   Existing names are grandfathered — the lint never asks you to rename a
   shipped field.
2. **Deterministic denylist.** Case-insensitive **exact** match on the full
   identifier. `replay` fails; `replayed`, `replayCount` and `metadata` do
   not (no substring matching). Each entry has a `severity` (`error` fails
   the job, `warn` becomes an annotation).
3. **LLM review.** New names that clear the denylist are sent with their code
   context to an OpenAI-compatible chat-completions endpoint, which judges
   whether the name is self-explanatory to a consumer with no access to code
   or comments. A `fail` verdict becomes an error, `warn` a warning.
4. **Report.** Findings become `::error`/`::warning` annotations (with file,
   line, reason, and alternatives) and an upserted PR comment marked
   `<!-- api-naming-lint -->` (updated in place, never spammed).

The LLM layer never blocks on infrastructure: no API key, HTTP errors,
timeouts, or malformed output degrade to warnings. The denylist always runs.

Implementation: dependency-free Node ESM in `.github/scripts/api-naming/`,
tested with `node --test .github/scripts/api-naming/*.test.mjs`.

## Reading a failure

The annotation and the PR comment tell you exactly what failed:

```
❌ API naming issue
Field: replay
Location: `apps/web/app/api/x/route.ts:13` (via denylist)
Problem: Unclear from the JSON alone: replaying data, rerunning a job, or retrying execution?
```

Fix: rename the field to something self-explanatory (`retryCount`,
`attemptCount`, …). The bar is "understandable from the JSON alone" —
there is no exceptions mechanism; a denylisted name is either renamed or
it fails the lint. If a name on the denylist is actually clear in every
context, remove it from the denylist instead.

## Adding a banned name

Edit `.github/api-naming.yml`:

```yaml
denylist:
  mybadname:
    severity: error   # or warn
    reason: "Why this name is unclear, in one sentence."
```

Severity `error` fails CI; `warn` only annotates. Keep the reason factual —
it is shown verbatim in the PR comment.

## Setting the LLM key (GitHub Secrets)

Repo Settings → Secrets and variables → Actions → New repository secret:

- Name: `API_NAMING_LLM_API_KEY`
- Value: your provider key.

The endpoint is OpenAI-compatible and configurable in `.github/api-naming.yml`
(`llm.base_url`, `llm.model`, `llm.max_names`, `llm.timeout_ms`). Without the
secret, the LLM layer skips with a warning — CI still runs the denylist.

## Running locally

```bash
# Against the current branch vs origin/main:
node .github/scripts/api-naming/run.mjs --base origin/main --head HEAD

# Against a saved diff (no git needed):
node .github/scripts/api-naming/run.mjs --diff-file /tmp/change.diff --findings-out /tmp/findings.json

# Tests:
node --test .github/scripts/api-naming/*.test.mjs
```

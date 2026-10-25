# post-engineer review checklist

Apply each section whose trigger matches the changed files. Each item names
what to check and where the contract lives. Grep, don't guess.

Write the entire review in English.

## 1. Telemetry, logs and alerts (engine, web, mcp)

Trigger: any added/changed call to `track_event`, `track_ai_request`,
`posthog.capture`, `logger.*`, Discord alert helpers, or `safe_reason`.

- Every **free-text** property (bodies, error messages, model output,
  exception text, upstream responses) sent to PostHog must go through
  `scrub_error_text()` (or at least `scrub_secret_values()`) from
  `apps/engine/app/services/analytics.py`. `track_event` itself only redacts
  by **key name** (`_SECRET_KEY_PATTERN`) — a key like `response_body`,
  `error`, `message`, `detail` is NOT redacted. Unscrubbed free text =
  CRITICAL.
- Read the module docstring of `analytics.py`: properties are ids, counts,
  and enums, never raw request bodies. Any new exception to that rule must
  be recorded in the "Deliberate exception" block, like the `ai_request`
  `response_preview` (already scrubbed with `scrub_secret_values`). Missing
  = MAJOR.
- `upload_publisher.PublishError.response_body` is documented as
  remote-controlled text that may echo sensitive data — it must never reach
  Discord, task `error`, PR comments, or analytics unscrubbed.
- Error strings that reach Discord / the task `error` field must not contain
  absolute local paths (basename only) or upstream bodies.
- `distinct_id` comes from `properties["user_id"]`; check the value is the
  real owner, not a placeholder.
- Telemetry must never raise into the main path (wrapped, or uses
  `track_event` which swallows).

## 2. Edge cases on collections and aggregates

Trigger: new `any()`, `all()`, `len(...) == 0`, loops building a result list,
reductions, "all failed / all succeeded" logic.

- What happens when the input/result list is **empty**? `not any([])` is
  `True`, `all([])` is `True`. Is the empty case reachable (defensive
  `continue`, empty `video_paths`, orphan/restart paths, filtered inputs)?
- Is the success/failure decision persisted consistently on every branch
  (e.g. `publish_results` written on success but not on all-failed)?
- Partial success: is the outcome visible to the user, and do retries /
  idempotency checks still let the failed part be retried?

## 3. Idempotency, retries, restarts (engine)

Trigger: `apps/engine/app/services/task*.py`, `orphan_requeue*`, `state`.

- Idempotency markers (`publish_results`, status flags): does the change
  alter when they are written? Could a retry now be skipped forever, or
  double-post?
- Orphan/boot triage calls the same functions with persisted params —
  check those call sites too (`grep -rn publish_videos apps/engine`).
- `persist_state_update` vs `update_task`: FAILED and result writes must be
  the resilient one.

## 4. Cross-file contracts

Trigger: any change to a function's return shape, a persisted state key, an
API response field, an event name/properties, or a DB column.

- Grep every consumer in `apps/engine`, `apps/web`, `apps/mcp`.
  New/removed keys (e.g. a `status` field, entries without `videoUrl`) must
  be handled by readers or flagged.
- Engine responses are wrapped in `BaseResponse {status, message, body}`;
  web proxies read `body`, never `data`.
- Docstrings that describe behaviour (Raises:, Returns:) must match the new
  behaviour.

## 5. PR hygiene / what actually merges

Trigger: always. Use `pr-context.md`.

- If the body says "stacked on #N" / "depends on #N", the **base branch**
  must be #N's head branch, not `main`, unless #N is merged. If base is
  `main` and the diff contains #N's commits/files, merging this PR silently
  merges #N → MAJOR.
- Does the diff contain files the body does not mention (another feature,
  generated assets, unrelated tests)?

## 6. Test quality

Trigger: any changed test file.

- **Dead mocks:** a `patch(...)`/`patch.object(...)` whose target is
  re-patched inside the same `with` before the code under test runs; a
  `side_effect` that is never reached; mocks configured but never asserted.
- Comments that contradict the assertions (e.g. "both fail → raises" above
  code that asserts no exception).
- Assertions that cannot fail (`assertLessEqual(len(x), 500)` when the
  fixture is shorter, asserting on the mock's own return value).
- The risky path has a test: the security property (scrubbing), the
  empty-input path, the all-failed path, telemetry failure not breaking the
  main path.
- Web tests mocking an engine upstream must mock the real envelope
  `{status, message, body}`.

## 7. Web / TypeScript

Trigger: `apps/web/**`, `apps/mcp/**`.

- No `any`; strict types. Server-only secrets never imported into client
  components. Supabase RLS / service-role usage only server-side.
- UI changes: loading/empty/error states exist.
- **MCP parity:** a new or changed `apps/web/app/api/**/route.ts` endpoint
  has an MCP tool that calls it (mapped in
  `apps/mcp/src/__tests__/parity-endpoint-tools.json`; the parity test
  proves the tool reaches that method and path) or a typed exclusion in
  `apps/mcp/src/__tests__/parity-exclusions.json` whose kind the parity
  test verifies against the route per handler. A PR that adds or changes an
  exclusion, or touches the parity test, its `parity/` verifier, the
  behavioural bearer test, the guard scripts/workflow or CODEOWNERS, fails
  `parity-exclusion-guard` until the code owner approves the current head
  in a review and applies `parity-exclusion-approved` (the guard checks the
  timeline and the review SHA, not just the label list). Never suggest
  weakening the test or adding a free-text exemption; the fix is the tool.

## 8. Migrations and config

Trigger: `supabase/migrations/**`, workflows, docker, env.

- Migration numbers unique (mechanically checked), reversible or explicitly
  forward-only, RLS policies on new tables.
- Workflows: pinned action SHAs, least-privilege `permissions`, secrets never
  echoed, no `pull_request_target` with checkout of PR code.

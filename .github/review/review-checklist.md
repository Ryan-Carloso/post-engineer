# post-engineer review checklist

Apply each section whose trigger matches the changed files. Each item names
what to check and where the contract lives. Grep, don't guess.

Write the entire review in English.

## 1. Telemetry, logs and alerts (web, mcp)

Trigger: any added/changed call to `track_event`, `track_ai_request`,
`posthog.capture`, `logger.*`, Discord alert helpers, or `safe_reason`.

- Every **free-text** property (bodies, error messages, exception text,
  upstream responses) sent to PostHog must go through `scrubErrorText()`
  (`apps/web/lib/publisher/scrub-error.ts`). `trackApiEvent` redacts by
  **key name** only — a key like `response_body`, `error`, `message`,
  `detail` is NOT redacted. Unscrubbed free text = CRITICAL.
- Properties are ids, counts and enums, never raw request bodies. Raw
  provider bodies never reach Discord, the stored `error`, the owner email
  or analytics unscrubbed.
- Error strings that reach Discord, the stored reason or the email must not
  contain absolute local paths or upstream bodies.
- `distinct_id` is the real owner (`userId`), never a placeholder.
- Telemetry must never raise into the main path (wrapped, or uses
  `trackApiEvent`, which swallows).

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

## 3. Idempotency, retries, restarts (publish scheduler)

Trigger: `apps/web/lib/publisher/**`, `apps/web/lib/scheduler*.ts`,
`claim_next_publish_slot`, or the publish ledger.

- Does every publish path go through the SQL slot claim? A slot claimed by a
  second worker must not publish twice.
- Idempotency markers (`publish_outcomes`, the publish ledger, status
  flags): does the change alter when they are written? Could a retry now be
  skipped forever, or double-post?
- A resumed `publishing` slot (lease expired, or no lease) must skip the
  accounts the ledger already published.
- Terminal writes (failed / published) and the media cleanup happen exactly
  once, on every branch.

## 4. Cross-file contracts

Trigger: any change to a function's return shape, a persisted state key, an
API response field, an event name/properties, or a DB column.

- Grep every consumer in `apps/web` and `apps/mcp`.
  New/removed keys (e.g. a `status` field, entries without `videoUrl`) must
  be handled by readers or flagged.
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

## 7. Web / TypeScript

Trigger: `apps/web/**`, `apps/mcp/**`.

- No `any`; strict types. Server-only secrets never imported into client
  components. Supabase RLS / service-role usage only server-side.
- UI changes: loading/empty/error states exist.
- **MCP parity:** a new or changed `apps/web/app/api/**/route.ts` endpoint
  is reachable through an MCP intent tool: mapped as `{ tool, action }` in
  `apps/mcp/src/__tests__/parity-endpoint-tools.json` (the parity test proves
  that the tool, or the named action's handler, reaches that method and
  path, and that invoking the action sends the request) or covered by a
  typed exclusion in `apps/mcp/src/__tests__/parity-exclusions.json` whose
  kind the parity test verifies against the route per handler. A tool is a
  complete abstraction of an intent: flag a new tool or action that only
  mirrors one endpoint when an existing intent tool should call it. A PR that
  adds or changes an exclusion, or touches the parity test, its `parity/`
  verifier, the behavioural bearer test, the guard scripts/workflow or
  CODEOWNERS, fails `parity-exclusion-guard` until the code owner approves
  the current head in a review and applies `parity-exclusion-approved` (the
  guard checks the timeline and the review SHA, not just the label list).
  Never suggest weakening the test or adding a free-text exemption; the fix
  is the action.

## 8. Migrations and config

Trigger: `supabase/migrations/**`, workflows, docker, env.

- Migration numbers unique (mechanically checked), reversible or explicitly
  forward-only, RLS policies on new tables.
- Workflows: pinned action SHAs, least-privilege `permissions`, secrets never
  echoed, no `pull_request_target` with checkout of PR code.

# Repository Layout (Nx monorepo, pnpm)

- `apps/web/` — Next.js 15 dashboard + API routes (run via `pnpm dev:web`, serves on `http://localhost:3434`)
- `apps/engine/` — Python/FastAPI video-generation engine (run via `pnpm dev:engine`, serves on `http://127.0.0.1:8080`)
- `apps/mcp/` — Post Engineer MCP server (npm package `post-engineer-mcp`; local stdio tool, tests via `pnpm exec nx test mcp`)
- Commands at repo root: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` (Nx run-many across all apps)

## Workflow rules

- Never push directly to `main` — always open a PR.
- TDD by default: every code change (features, fixes, refactors) ships with
  new or updated tests, and the relevant suite is green before committing.
- Keep PRs small and focused; CI must be green and review threads resolved
  before merge.
- **Look at the UI you changed.** A green test suite says nothing about layout:
  after editing anything under `apps/web`, load the `preview-ui` skill
  (`.opencode/skills/preview-ui/SKILL.md`) and verify the screen in the running
  dev server at `http://localhost:3434` — screenshots, both locales (PT is the
  default), and the console. Never schedule a real post or spend tokens to take
  a picture.
- **The deployed version is generated at deploy time; never bump it by
  hand.** The repo-root `VERSION` file is ONLY the MAJOR.MINOR release
  baseline (e.g. `1.28`), edited by hand when cutting a release line —
  never per PR, never by CI. The deployed version is
  `MAJOR.MINOR.PR_NUMBER` (e.g. PR #152 -> `1.28.152`), generated on the
  VPS from the commit being deployed: the patch position is the number of
  the merged PR that introduced that exact commit, resolved through the
  GitHub API (`GET /repos/{owner}/{repo}/commits/{sha}/pulls`, merged PRs
  only, via `deploy-version.sh` in the deployment repo). Consequences:
  - **No version commits, no version PRs, no version conflicts.** Nothing
    version-related is ever written back to git; parallel PRs can never
    conflict on a version file. There is no bump script.
  - If the PR for the deployed commit cannot be resolved (API down, a
    direct push with no PR), the deploy FAILS before building instead of
    shipping an unidentified build.
  - `package.json` / `pyproject.toml` / `apps/mcp/package.json` versions
    stay hand-maintained and independent (the npm package has its own
    release flow); nothing syncs them automatically.
  - Build metadata is injected as `VERSION` / `PR_NUMBER` / `BUILD` (the
    PR number) / `COMMIT` (full SHA) at deploy time and reported by the
    engine's `GET /version` and `/health` (and proxied by the web's
    `/api/version` for the UI badge). CI injects its own values so the
    suites exercise the same code path.

# Env Files Policy (NEVER commit real secrets)

- Real env files (`apps/web/.env`, `apps/engine/.env`,
  `apps/engine/config.toml`) are gitignored and are NEVER committed.
- There are only three env files by design: `apps/web/.env` (all web vars,
  including `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` used by Cypress),
  `apps/engine/.env` (engine vars), and `apps/engine/config.toml`
  (engine behavior config with provider API keys). Do not introduce new env
  files — add vars to these. Do NOT create `.env.local` overrides.
- Never remove the `.env` ignore rules from `.gitignore`, never stage real
  secret files, and never print secret values in diffs, logs, or comments.
- New contributors create them from the `*.example` files (see README).

# Supabase Authentication Rules

## Social Account Data

- All account consumers use React Query through `useYouTubeAccountsQuery` and `useInstagramAccountsQuery` in `apps/web/lib/api.ts`. Keep one implementation per network and explicit network names.
- Use the shared `youtube-accounts` and `instagram-accounts` query keys; invalidate the corresponding cache after successful OAuth or a real server mutation.
- Keep remote account state in React Query, rather than parallel `useState`/`useEffect` fetch hooks. Actions must perform their named operation; use cache invalidation directly for refresh-only work.

## Strict Requirements

- **NEVER add fallback values** for environment variables
- Always fail explicitly when environment variables are missing
- Do not provide default values or fallback configurations
- Use strict type checking - no `any` types allowed

### Exception: PostHog telemetry keys (2026-09-30)
PostHog (`POSTHOG_API_KEY` / `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST`)
is intentionally warn-and-continue, not fail-fast. Rationale: telemetry must
never break the app — if the key is missing or PostHog is down, the app keeps
serving requests and logs to console/Vercel only. The `??` chain across the two
key vars is not a "fallback value" in the banned sense (no hardcoded default);
it reflects that the server accepts either the server-side or the public key.
This is a deliberate, documented exception to the fail-fast rule.

## Environment Variables

All environment variables must be defined or throw explicit errors:

```ts
// ❌ WRONG - fallbacks are forbidden
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'fallback-url'

// ✅ CORRECT - fail explicitly
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
```

## Type Safety

- Use `unknown` instead of `any` for untyped data
- Provide explicit type annotations for all functions
- Use proper type guards and narrowing
- No type assertions unless absolutely necessary

## UI Components

- Components under `apps/web/components/ui/` are reusable presentational components.
- They may receive props, including data and callbacks; this is the preferred API for shared UI.
- Keep fetching, OAuth, state management, and other screen-specific logic outside these components.

### Reuse before you build (strict)

Never hand-roll a control, an avatar, a card or an icon that this repo already
has. Before writing any new UI, look — in this order:

1. `apps/web/components/ui/` — the shadcn set (`components.json`: style
   `default`, base `neutral`, lucide icons). Missing primitives are added with
   `pnpm dlx shadcn@latest add <primitive>`, never hand-written.
2. `apps/web/components/` — app-level shared pieces: `account-card.tsx`
   (social account with thumbnail, checkbox **and** compact tile modes),
   `provider-icon.tsx` (network glyphs), `ui/social-accounts-section.tsx`,
   `ui/insufficient-tokens-dialog.tsx`, `ui/version-badge.tsx`, `ui/token-pack-cards.tsx`.
3. `apps/web/lib/ui.tsx` — the icon set (`PlusIcon`, `TrashIcon`, `FilmIcon`,
   `CalendarIcon`, `CoinsIcon`, `ComposeIcon`, `AccountsIcon`, `GlobeIcon`,
   `CheckIcon`, `AlertIcon`, `SpinnerIcon`) plus `INPUT_CLASS` and
   `SECTION_LABEL_CLASS`; compose with `cn()` from `lib/utils.ts` so the
   caller's classes win.
4. `apps/web/lib/ui.tsx` providers/registry and `lib/publish-links.ts` for the
   exhaustive network maps (`satisfies Record<SocialProvider, ...>`).

A second, differently-styled version of an existing component is a bug: it
drifts, it drops the accessibility work (labels, roles, `aria-*`) and the
thumbnail/fallback handling that component already does. Reuse it and pass
`className`/`compact`/callbacks. Only add a component when nothing fits — and
then say in the PR why.

Visual verification is part of "done": a hand-rolled `<select>` for something
the app already renders as persona cards (avatar + name + badges) is exactly the
kind of regression the `preview-ui` skill exists to catch.

## "use server" Directive

All server actions must use the "use server" directive:

```ts
'use server'

import { createClient } from '@/lib/supabase-client'

export async function signInWithGitHubAction() {
  const supabase = createClient()
  // Implementation...
}
```

## Error Handling

- Never silently fail authentication
- Always log errors for debugging
- Provide explicit error messages
- Do not catch and suppress errors

## Code Comments

- **All code comments are in English. Always.** Never write comments in Portuguese (or any other language) — in code, tests, migrations, or docs-as-comments.
- When you touch a file, convert any existing non-English comments to English as part of the change.

## Public GitHub content

- **Everything posted publicly on GitHub is in English. Always.** PR titles and bodies, issue titles and bodies, review comments, and any other public text — never Portuguese (2026-10-10, user's call; PR #158's body was fully rewritten from PT to EN). When opening or editing a PR/issue, write and review the body in English before submitting.

## Next.js version note

This repo pins a specific Next.js version whose APIs and conventions may differ
from generic Next.js knowledge. Before writing framework-level code, check the
version in `apps/web/package.json` and the docs in
`node_modules/next/dist/docs/` (resolved from `apps/web/`). Heed deprecation
notices.

## Code review

- PRs are reviewed by CI workflows in `.github/workflows/` (including an AI
  reviewer). Read reviewer feedback before requesting merge; address findings
  in focused follow-up commits.

## Engine proxy contract (2026-10-07)

- The engine wraps every payload in its `BaseResponse` envelope
  `{ status, message, body }` — the payload key is `body`, never `data`.
  Both voice proxy routes read `body.data` and returned 502 on every call
  since the open-source release (the voice picker never loaded in prod).
- Tests that mock an engine upstream must mock the real envelope; a
  `{ data: [...] }` mock passes while production 502s. Same class as the
  round-7 rule "Mock the production invariant, not a fake" — grep every
  web route that parses an engine response when this shape is in doubt.

## Billing reconciliation (2026-10-03)

- **Never treat engine HTTP 200 as "task alive".** The task endpoint
  returns a numeric `state` (-1 failed, 1 complete, 3 queued, 4
  processing) plus the failure reason — a 200 with `state: -1` is a
  provably dead task, and treating it as alive silently routes
  refundable failures into "ambiguous, wait for a human". Always parse
  the body; only -1/1 are terminal, everything else is active, and a
  200 without a readable state is unverifiable (not active).
- **Time-boxed auto-refund beats a human queue for stuck jobs.** Past
  N days (default 3) with no video and no provable delivery, refund:
  a wrong refund costs ~$0.10 of GPU, charging a user for nothing is
  the worse error. Every refund emits `refund_issued` as the audit
  trail — the queue was process theater around a decision the data
  already made.
- **Backfill, don't fail, on proof of delivery.** A published slot
  means the video shipped: mark the generation `completed`, not
  `failed`. A `failed` row for a published video lies to every
  consumer of the history.

## API naming lint (2026-10-03)

- `.github/workflows/api-naming.yml` lints only NEW field/param names in the
  PR diff under the contract surface (`apps/web/app/api/**/route.ts`,
  `apps/mcp/src/tools.ts`, engine Pydantic models/controllers). Existing
  names are grandfathered — never rename a shipped field to satisfy it.
- Denylist (`.github/api-naming.yml`) is exact-match, case-insensitive:
  `replay` fails, `replayed`/`replayCount` do not (those go to the LLM
  layer). Ambiguous-but-valid names are judged by the optional LLM layer,
  which skips gracefully without `API_NAMING_LLM_API_KEY`.
- Implementation is dependency-free Node ESM in
  `.github/scripts/api-naming/`, tested with
  `node --test .github/scripts/api-naming/*.test.mjs`. The config parser
  supports a restricted YAML subset only (documented in the config file) —
  keep new config values simple.

## Web/API review learnings (standing rules, distilled 2026-09-28)

Recurring findings from OpenCode/OCR review of the persona image library
(`apps/web/`). Follow these so the same issues don't come back:

- **Never fail silently on mutations.** Upload/save/delete surface errors to
  the user and log them; non-2xx, non-JSON, and `success:false` responses
  are never treated as success. Invalidate caches only on real success.
- **New stateful UI ships with behavioral tests.** A component with editing,
  pending, or error state gets component tests, not just lib tests.
- **Reuse the single primary-swap helper.** `setPrimaryLibraryImage` is the
  only code that unsets/sets the primary flag; PATCH reuses it and a failed
  unset is a 500, never a confusing unique-index violation.
- **Log storage cleanup failures.** A failed storage remove on DELETE is
  logged, never swallowed — orphaned files stay diagnosable.
- **Library images need a face.** Faceless personas (`face_mix_percent = 0`)
  reject library image adds, matching the creation rule.
- **No `instanceof File`.** Use a structural guard (`isFileLike`): the
  undici `File` constructor differs from the test env's.
- **Unknown `image_id` is always 404.** Even for an empty library — never a
  silent fallback to the legacy photo. Empty-string and non-string `image_id`
  are 400; silent coercion hides broken integrations.
- **Explicit overrides are not rotation picks.** A pinned `image_id` never
  touches the anti-repeat history.
- **Selection is pure; history is a post-gate write.** `resolveVideoImage`
  never touches `recent_image_ids`. The caller records via
  `recordRecentImageId` only after the token gate passes — a rejected
  request must not mark an image as used.
- **History writes are atomic.** `record_persona_image_use` (SQL) prepends,
  dedupes, and caps the window in one UPDATE; app-side read-modify-write
  loses concurrent updates.
- **An unsignable selected image is a 503.** Never silently fall back to a
  different face when the resolved library image can't be signed.
- **Score with the full video context.** Image selection gets topic, niche,
  AND the persona `script_prompt`, not just topic/niche.
- **Service-role bypasses RLS.** Every service-client handler re-checks
  ownership explicitly; say so in a comment at each call site.
- **Rollback failures are loud.** Creation rollback logs persona-delete and
  photo-remove failures instead of discarding them.
- **Keep SQL literals coupled.** The `10` in `002_persona-images.sql` mirrors
  `MAX_PERSONA_IMAGES`; the coupling is documented in both places.
- **Sync editor state with refetches.** Local editor copies re-sync from
  props when not editing; in-progress edits are never clobbered.

## Supabase migrations (standing rules, 2026-10-03)

The user asked for numbered migrations so self-hosters know the apply
order — this supersedes the earlier triage note that "versioned SQL
migrations" were declined as reviewer churn.

- **Numbered, append-only, in `supabase/migrations/`.** The numeric prefix
  IS the apply order (`supabase db push` reads that directory and applies
  only pending migrations, tracked in
  `supabase_migrations.schema_migrations`). New migrations always append a
  new number; never edit a shipped number. Existing databases then apply
  only the new files.
- **Everything idempotent.** `create table/index if not exists`,
  `add column if not exists`, `create or replace`, `drop ... if exists`
  before recreating an incompatible object.
- **Inline `references` never fires on an existing table.**
  `create table if not exists` with an inline FK is a no-op when an
  earlier migration (or the 001 snapshot) already created the table — the
  FK silently never exists on that DB. Declare FKs on existing tables in
  an explicit do-block guarded on `pg_constraint` (pattern: section 1b of
  `migrations/002_persona-images.sql`; pinned by the FK assertions in the
  SQL-literals sync test).
- **Pin app-coupled SQL with a static sync test.** When the app depends on
  SQL behavior, a test parses the migration file and asserts the literals
  (pattern: the `supabase/migrations/002_persona-images.sql literals` describe block;
  note the test resolves the file under `supabase/migrations/`).
- **Update `supabase/README.md` and `docs/SELF_HOSTING.md`** when adding a
  migration.
- **CI validates every migration PR** (`supabase-migrations` job in
  `ci.yml`): filename numbering unique + strictly increasing, destructive
  DDL (`DROP COLUMN`, `TRUNCATE`, unconditional `DROP TABLE`) blocked
  unless the PR has the `db:destructive-approved` label, and the full
  chain must apply cleanly to an ephemeral Postgres.
- **CD applies migrations on merge to `main`** (`deploy.yml`, on PR merge):
  `supabase db push --linked` (pending only). The web app itself deploys to
  our own VPS (`apps/web/docker-compose.yml`, via `deploy.sh` on the host)
  — migrations land first, then the host is redeployed. If migrations fail,
  the workflow fails loudly and nothing else runs.
- **Moving a migration file breaks its readers.** The `git mv` of
  001-003 into `supabase/migrations/` turned three SQL-sync tests red
  (ENOENT in CI, PR #65): grep every test for the old path in the same
  PR — the sync tests are the coupling that pins app behavior to the
  migration chain. Migration files stay byte-identical across moves so
  `db push` checksums keep matching.

## MCP review learnings (standing rules, distilled 2026-09-27)

Recurring findings from 11 rounds of review on the MCP server (`apps/mcp/`).
Follow these so the same issues don't come back:

- **Secrets never surface.** Bearer <redacted>, app passwords, and base-URL userinfo
  must never appear in error messages, logs, or agent-visible output. Redact
  raw, percent-encoded, and JSON-escaped forms; cap upstream error bodies
  (200 chars); fail fast on a missing key without logging it.
- **HTTPS or loopback only.** Remote API URLs must be https; http is allowed
  only for loopback hosts (`localhost`, `127.0.0.1`, `::1`, `[::1]`). Validate
  the URL and use the normalized form (`origin + pathname`), never the raw
  string — userinfo credentials must not ride along silently.
- **Validate OAuth URLs.** An `auth_url` handed to an agent must be https:
  `z.string().url()` accepts any scheme, including `javascript:`.
- **Empty responses are explicit.** A 204/empty-body success resolves
  `{ ok: true }`, never `undefined` — handlers must not render "undefined"
  to agents (e.g. "task started: undefined" for a paid job).
- **Non-JSON success bodies are errors.** A 200 with a malformed body must
  reject loudly, never resolve as success.
- **Single source of truth for tool schemas.** Define each shape once in
  `tools.ts`, register it in `index.ts`, and pin every registration with an
  invariant test — no inline `{}` that can drift.
- **No test-only seams on production interfaces.** Inject clocks/config via
  options (e.g. `now: () => Date`), never via `_fieldForTesting` on input
  types.
- **Network calls time out.** Every fetch gets an `AbortSignal` timeout so a
  hung request can't block the agent session forever.
- **Tests must not pass vacuously.** Assert the spawned process is actually
  alive; use ephemeral ports and `mkdtempSync`, never fixed ports/paths;
  skip symlink tricks on Windows (needs elevated privileges).
- **Engines must cover the newest syntax used.** Import attributes
  (`with: { type: 'json' }`) need Node >= 20.10, not just >= 20.
- **Commit messages describe the implementation**, not the process
  ("redact encoded app password, inject clock via options", never
  "review 11 findings").


## Web/API review learnings — distilled rounds 2–28

Validation and errors:

- 400, never silent truncate/coerce/drop: over-length input, malformed metadata arrays, index-aligned arrays shorter than the file count, non-file entries in multipart fields, conflicting dual-spelling params (`image_id`/`imageId`), unknown ids = 404 (empty string too), bare-extension/dotfiles rejected (`lastIndexOf('.') > 0`, matching Node's extname).
- Validate shared params before branch splits and before index-aligned arrays; cheap param checks before expensive file reads; strict `/^\d+$/` parsing (parseInt coerces `3x`).
- POST booleans accept only `true`/`false` — no silent coercion; validate enums at the narrowing boundary (e.g. `isPublishProvider` guard drops unknowns).
- Never render raw English/server errors in the localized UI: map known failure classes to i18n keys (dynamic regex for limit-changing classes); unknown warning codes map to a localized generic fallback, never the internal slug.
- Fail loud on every error path: every select on an auth path handles its error explicitly; never discard a query error on a security branch; databases are not "not found" at every `.single()` — PGRST116 → 404, anything else logged 500. Rejects in the picker need visible feedback.
- Distinguish transient vs gone: 404 = truly gone; 401/403 = config error (log at error, never transient); 5xx/429/aborts/unparseable-200 = transient, retryable. Every promise chain gets a `.catch` — a wedged loading state is a bug.

Mutations and rollback:

- A committed mutation is never a total failure: report what actually committed (200 + warnings + a distinct code like `row_refetch_failed`), never a bare 500. Conversely, a metadata-only failure keeps the honest 500 and the editor stays open so edits aren't silently discarded.
- Partial-success contracts are symmetric across producers: warnings are stable codes (`PERSONA_IMAGE_WARNING_CODES`), rendered amber not red, surfaced by every consumer, mapped through one shared mapper.
- Rollback order: delete rows BEFORE storage objects (row first, storage best-effort after — loud logs, one retry). Never remove row-backed storage while surviving rows reference it; remove row-backed storage only AFTER a successful cascade delete. Split leftovers `{ orphanPaths, rowBackedPaths }`, surface them at every call site (with `??` defaults at optional consumers).
- Cascade deletes collect storage paths from every ON DELETE CASCADE table BEFORE deleting rows — after the cascade the paths are unrecoverable.
- Atomicity: multi-statement DB mutations go in one SQL function with locks (primary swap, check-then-act); re-check status in UPDATE predicates (`.eq('status', 'pending')`, zero rows → 409); atomic RPC for last-slot delete checks.
- Ownership: service-role bypasses RLS — every service-client handler re-checks ownership explicitly, comment at each call site. Ownership RPCs take `p_user_id` and RAISE (P0002) when the ownership-checked statement finds no row — an advisory guard that doesn't stop execution is not enforcing. OAuth callers take the service-client branch too (`isApiKey === true || isOAuth === true`).
- Image selection: explicit overrides are not rotation picks (a pinned `image_id` never enters anti-repeat history); selection is pure, and history is written only after the token gate passes (a rejected request must not mark an image used); history writes are atomic in SQL; sanitize untyped JSONB (`recent_image_ids`) read-time with Array.isArray guards.
- Coerce derived state at the write boundary on EVERY branch: the faceless branch is unconditional; legacy NULL face_mix_percent coerces to `DEFAULT_FACE_MIX_PERCENT`; every consumer of a nullable flag must agree on what NULL means (`(faceMixPercent ?? 0) !== 0`).
- History/timing writes belong after the external accept (engine accepts/creates the job), never after the token gate — a failed engine call leaves zero history. An unsignable resolved image is a 503, never a silent different-face fallback; resolve legacy fallbacks lazily (only when the primary source yields nothing).

Types and constants:

- Narrow every field downstream consumers read, including ids; keep valid entries when narrowing arrays (drop only malformed ones); strip internal fields (`image_path`) from every response projection; never expose internal paths in client-safe types.
- Client-safe constants (limits, warning codes, defaults) live in dependency-free leaf modules; every user-facing number derives from shared constants — no exceptions; interpolate numeric limits into i18n copy.
- Route modules export only HTTP handlers; shared helpers dedupe on the third copy; one shared guard per input class (`SAFE_TASK_ID`), pinned by a source-level sync test listing every consumer.

Fan-out and rate limiting:

- Every new upload surface gets `applyRateLimit` (10/min); destructive DELETE gets a stricter profile; expensive GETs that fan out get their own profile. When adding a limiter to an existing route, mock it no-op in every existing suite (the in-memory limiter's shared bucket 429s the 11th call); one dedicated test owns the real 429 path.
- Bound downstream fan-out AND DB reads on list endpoints: aggregate budget (`Date.now() - start < BUDGET_MS`), caps (engine lookups, counts), deterministic `.order().limit()`; items past budget degrade to null, counts stay complete; carry a `truncated` flag in response + client type + UI.
- Post-commit cleanup that must not block the response goes in `after()` — with its own budget and loud skip logging.
- Parallelize independent counts with `Promise.all`.

UI behavior:

- UI gates derive from persisted/loaded data, not create-flow stores; sync editor state with refetches (re-sync local copies when not editing; never clobber in-progress edits). Gate edit-UI sections on `editingPersona !== undefined`.
- Pending queues survive refetches (render outside conditionals); disable every interactive element while a mutation is pending (inputs, cancel, retry buttons, pickers); mirror every hardening branch with a test.
- No side effects inside setState updaters; defer blob-URL revocation past the state commit (queueMicrotask); effect deps key on identity (`personaId`), not object references.
- Destructive dialogs: initial focus, Escape to cancel (not while deleting), focus trap, reset-on-close; retry must not wipe user input (key state per persona, not per attempt); type-to-confirm mitigates but doesn't replace a11y.
- Client fetch helpers never throw on HTTP errors: check `response.ok`, guard `response.json()` (Vercel 502 HTML bodies throw); parse non-ok bodies to surface structured server codes; hoist config-throwing helpers out of transient catch blocks (extract the parse helper on the third copy).
- Consume structured server errors: a parsed flag with no UI consumer is an overclaim (e.g. PERSONA_NOT_FOUND closes + refetches, never offers retry).

Consumer coverage and tests:

- When a review closes a gap in a guard, grep every consumer for every field the UI reads/renders. Every new server flag gets a consumer + producer AND consumer tests ("close the mirror" — pin retry copy, retry contract there too).
- New stateful UI ships with behavioral tests; error and edge branches get tests, not just happy paths; budget-skip and degradation branches are production logic — mocked-clock tests; conditional UI rows need >0 fixtures on BOTH producer and consumer sides.
- Multipart route tests need `// @vitest-environment node`. When production adds a chain link, grep every test mock of that query and extend the chain — the outdated mock is the bug. Mocks must echo production invariants (e.g. insert payload's image_path so row-less detection works). A test asserting an error path must verify the error path was actually taken (not dead config).
- Test names must match their assertions; keep names, comments, and claims in sync with the code while refactoring. When a helper under test fires telemetry, patch the entry point in every driving test. Tests rename subject to the same staleness rule — grep names when declaring a mechanism stale. Sync-test assertion failures must name the offending key (vitest accepts a message as second `expect` arg).
- Testing env vars: `vi.stubEnv(key, undefined)` deletes a var and restores on unstub — NEVER `delete process.env.X` (permanent worker leak). Clear/stub ALL related vars (ambient values leak via `patch.dict(..., clear=False)`). `vi.restoreAllMocks()` in afterEach; don't `mockReset()` a `vi.stubGlobal`'d fetch mid-suite (phantom attributions) — arm mocks explicitly per test.
- Answer "already covered" with the test's name; don't argue. Mutation-verify your own pins (revert the fix, the pin must fail).
- Test every surface a contract touches: producer artifacts AND all consumers — sync tests pin actual producer artifacts (sentence constants, SQL defaults), not just the code.
- Cross-app copy: a file-parsing sync test pins literals appearing in multiple apps (prompt copy, install commands, DEFAULT_POSTHOG_HOST) in the same PR; EN/PT parity tests cover every pinned line.

Schemas and SQL:

- Pin app-coupled SQL with static, file-parsing sync tests, two-direction: every insert key is a real column (phantom keys) AND every NOT NULL-without-default column is supplied. Assertion failures must name the offending key. Also pin restored DEFAULTs (dropping a default in schema.sql must fail CI) and SQL literal VALUES across parallel files by exact `includes` (no dynamic RegExp — CodeQL).
- DDL parsers: exclude table-level constraint keywords (`primary/unique/foreign/check/constraint/exclude`); match `\bnot null\b`/`\bdefault\b` whole-words on comment-stripped lines (a column named `default_topic`/trailing comments); column-level PRIMARY KEY is implicitly NOT NULL; document the one-column-per-line assumption. Validate against a code atom AND mutation-verify (the tests are the production-500 class guard, leave a trap to prove the pin works).
- Schema-sync tests parse the file, not production DBs; the explicit insert column is what protects production. DB defaults only cover fresh installs — deployed DBs converge via idempotent manual SQL files.

Misc:

- Unicode-aware tokenization (`\p{L}\p{N}` with `u` flag) for keyword/babel classes. Hoist TTLs to named constants; name nested ternaries extracted into helpers.
- Pin shared-param validation on every dispatch branch when routes fan out by content-type — check dispatch order, each branch applies shared validation.
- Dead code: when a flow is removed, delete the entire path — API route + client functions + MCP tool + docs + i18n keys + tests; grep stale comments and dead i18n keys everywhere siblings exist; remove read-side branches too (otherwise nullable fields promote to default path — define fallback + test). `delete dead i18n keys` is an error, not a smell. Keep intentionally-unbounded queries documented (schedules note) vs bounded.
- Reword dead-flow runtime strings too: validator error copy naming removed fields reaches API clients verbatim in 400 bodies; pair every user-facing reword with negative-match tests (`not.toMatch(/removedFieldName/i)`).
- Conflict resolution on user-facing copy needs semantic verification, not just marker removal — diff resolved strings against BOTH sides' intent (reword vs parameterization); after ANY rebase touching a package.json, run `pnpm install --frozen-lockfile` locally before pushing (and grep for duplicated keys when conflict resolution touched version files).
- Overridable base classes go through `twMerge` (already a dependency) — pinned with an override test.
- Link cards by the lookup key (the detail lookup), not the row PK; include new providers everywhere end-to-end (grep selects, responses, account-resolution sites); invalidate every query key a mutation feeds (list + detail).
- PR #52/#55: the `kind: 'batch'` phantom insert key class — cross-check every new insert key against the canonical schema file; assert the ABSENCE of phantom keys, not just the presence of expected ones.

## MCP review learnings — distilled rounds 4, 5, 19

- Re-parse Zod schemas INSIDE the handler closure (like handleCreatePersona): a `.refine()` parsed only against the raw tool shape never runs on the tool path — a domain rule must be machine-checkable where it claims to be. Zod messages must match optional semantics ("must be a non-empty string", not "is required" on optional fields).
- Trim/normalize metadata on EVERY entry point (add + update share one normalization; "tag: ''" can never match keyword selection). Fail fast on the effective value, not just presence: createPersona computes the effective face mix once (shared with the form field) and rejects before any file read. Length checks go through the shared helper on all paths.
- stat() before readFile for local uploads (medium-T disk misname OOMs stdio); sequential reads bound the stdio memory budget (no Promise.all over 10×10MB); pure-argument checks (index ranges) before any file read; derive display capacities from exported constants, never hardcode "10MB" next to `MAX_LIBRARY_IMAGE_BYTES`; encode domain rules (at least one of tag/description/isPrimary) in the schema; no-op calls fail fast client-side; file-carrying requests get a longer timeout (120s vs 30s); independent reads via Promise.all.
- No test-only seams on production interfaces: inject clocks/config via options (`now: () => Date`), never `_fieldForTesting`. Export shared limits from the client module and import them into schemas/descriptions/dialect strings.
- Export/type shapes stay in ONE place: tool schemas defined in tools.ts, registered in index.ts, pinned by an invariant test — no inline `{}` that can drift. Shared helper extraction goes into a new leaf module (errors.ts), never across an existing edge (avoids client↔tools cycle).
- Strict null checks only — spell out `=== undefined || === null` even for genuine nullish checks (`== null` is banned); do not "simplify" to `=== undefined` on reviewer request when the null-rejecting Zod schema proves null can never arrive (pin rejection by test instead). Pin undefined/[] equivalence in validators (missing array and `[]` behave identically).
- isPrimary is swap-only on MCP too (literal `true`; meaningless explicit false fails at parse time). Bare-extension files (".png") behave identically to Node's extname semantics on every boundary.
- Sanitize engine errors before surfacing to agents (`sanitizeEngineError`): redact bearer/app-password/base-URL-userinfo shards; 204/empty bodies resolve `{ ok: true }`, never "undefined"; non-JSON 200 bodies reject loudly; every fetch gets an AbortSignal timeout so a hung request can't block the session.
## CI lessons

- **Rebase can silently drop a dependency from package.json while the lockfile
  keeps it (2026-10-01, PR #34):** after rebasing onto main, conflict
  resolution on `apps/mcp/package.json` kept the old branch's
  `dependencies` block (without `posthog-node`) while `pnpm-lock.yaml`
  still referenced it — CI's `pnpm install --frozen-lockfile` failed with
  `ERR_PNPM_OUTDATED_LOCKFILE` ("specifiers in the lockfile don't match").
  Same class of bug previously bit `apps/web/package.json` (@sentry/nextjs
  resurrected). Rule: after ANY rebase that touches a package.json, run
  `pnpm install --frozen-lockfile` locally before pushing; and when taking
  `--theirs`/`--ours` on a package.json, diff the dependencies blocks
  explicitly instead of trusting the merge.

- Never pass CLI flags through `pnpm <script> -- <flags>` in workflows:
  pnpm (v10) forwards a literal `--` to the script, so
  `pnpm test -- --coverage` runs `vitest run -- --coverage`, and vitest then
  silently skips coverage generation (tests still pass, no report files are
  written). The downstream step fails later with a confusing "file not found".
  Invoke the binary directly instead: `pnpm exec vitest run --coverage ...`.
- `actions/upload-code-coverage` fails closed on a missing report file even
  with `fail-on-error: 'false'` (that input only downgrades *upload* errors,
  e.g. Code Quality not enabled). The coverage-generation step must actually
  produce the file, or CI goes red.
- **OCR review 409 artifact conflict (2026-09-29):** the `alibaba/open-code-review`
  action's "Upload review artifacts" step runs `always()` with a fixed per-run
  name (`ocr-review-result-<run_id>-<run_attempt>`). Our workflow invokes the
  action twice (primary + free-model fallback), so when the primary fails and
  the fallback runs, the fallback's upload 409s on the name the primary already
  created — the job goes red and "Post review comments" is skipped even though
  the fallback review SUCCEEDED. Fix: `upload_artifacts: 'false'` on the
  primary attempt only; the fallback keeps its upload (its artifacts are the
  useful ones). Verified against run 36537786650 (single artifact from the
  primary, fallback 409).
- **OCR review exits 1 on informational-only findings (2026-09-29):** with the
  409 fixed, a run can still go red with just two `low` severity comments that
  explicitly say "no code quality concerns" (verified: PR #17, run 36538879908,
  both notes praised the docs). The action exits 1 whenever its comments list
  is non-empty. A red ocr-review check is NOT actionable until the findings are
  read: download the `ocr-review-result-<run_id>-1` artifact and inspect
  `ocr-result.json`'s `comments[].content` before touching code.
- **OCR review concurrency vs z.ai rate limits (2026-09-29):** the action's
  default `--concurrency 8` trips z.ai's rate limiter (HTTP 429 on BOTH the
  coding endpoint/glm-5.3-flash and the standard endpoint/glm-4.7-flash —
  observed on PR #17's run 36538879908, 13 requests all 429ing after retries).
  The workflow now pins `review_concurrency: '2'` on BOTH attempts (the
  validator requires the two invocations to stay in sync on shared settings).
  If ocr-review goes red with `classification: "provider"` /
  `reason: "provider or subtask request failed"` in the artifact's
  `ocr-result.json`, it's z.ai throttling, not our code — re-run the job
  later rather than "fixing" anything.
- **OCR review: verify alleged type errors against the code (2026-09-29):**
  the reviewer flagged a `high` "return type mismatch" on a function with NO
  return-type annotation whose four paths all return a consistent 5-tuple and
  whose caller handles the None case explicitly — pure false positive.
  Declined without code change. Pattern: the reviewer invents a "contract"
  (e.g. "5-tuple contract", "should be Optional[...]") that the code never
  declares; check whether the alleged contract exists before touching anything.
- **opencode-review model chain (2026-10-19, runtime discovery):**
  `select-review-models.py` builds the attempt list at CI time from
  `.github/review/model-preferences.json` (ranked preferred free models,
  denylist, paid fallbacks). It discovers OpenCode zero-cost models via
  `opencode models opencode --verbose` (stdin closed) and OpenRouter `:free`
  tool-capable models from the public models API when `OPENROUTER_API_KEY` is
  set. Chain = available preferred free (in order) + a capped set of newly
  discovered free models + paid fallbacks last (max length 8). Optional
  `REVIEW_MODEL_CHAIN_OVERRIDE` repo variable replaces the chain. Discovery
  failure falls back to the static preferred list. The job always runs (free
  OpenCode models need no secret). glm-4.5-flash was dropped — poor review
  quality. `openrouter/openrouter/free` stays only as the last paid-fallback
  router id, not in the preferred free list. One `OPENROUTER_API_KEY` serves
  paid and discovered free OpenRouter models.
- **opencode-review hardened — grounded findings + mechanical checks
  (2026-10-06):** the review prompt requires a machine-checkable format per
  finding (`### SEVERITY: title`, `**Location:** path:line1-line2`, verbatim
  code fence first, plus "do not report findings you cannot quote verbatim");
  `.github/scripts/verify-review-grounding.py` drops findings whose
  file/lines/quote don't verify against the checkout (zero survivors → stub
  comment; "nothing material" reviews publish as-is).
  `.github/scripts/review-mechanical-checks.py` appends a "Mechanical
  checks" section to the comment: FAIL on duplicate `supabase/migrations/`
  numbers (the real 009 collision) or obvious secrets in added diff lines,
  WARN on prod files changed with no test file changed — this replaced the
  LLM's old TDD-coverage prompt bullet. Mechanical FAILs post the comment
  first, then fail the job.
  **Follow-up (review's own findings, same day):** the grounding verifier
  now fails closed — finding-like output that ignores the `### SEVERITY:`
  format is NOT published (a format deviation previously slipped through as
  "nothing material"); heading detection skips fenced code blocks (a quoted
  `### ` line no longer splits a finding); the review read uses
  `errors="replace"`; `::add-mask::` runs in its own step right after the
  key check, before any LLM output can be logged; both scripts have pytest
  unit tests (`.github/scripts/tests/`) wired into the `review-workflows` CI
  job, and the validator pins the posted artifact as `review.verified.md`.

## Test quirks (vitest 4.1)

- **Don't `mockReset()`/`mockClear()` a `vi.stubGlobal`'d fetch in
  `beforeEach` when a test makes it throw.** Observed 2026-09-28
  (lib/__tests__/token-balance-real.test.ts): with the reset in place, a
  throwing fetch mock surfaces as a phantom `Error` attributed to the test
  even though the code under test catches it and behaves correctly
  (verified: right return value, logger.warn called once). Without the
  reset, the same test passes. Arm the mock explicitly in each test instead
  of resetting the stubbed global.

## Logger migration rule (2026-09-28)
- When migrating a direct `console.warn/error(msg, obj)` call to
  `logger.warn/error(...)`, the logger's console emission must preserve the
  EXACT call shape (message first, metadata/error as separate args).
  Pre-existing route tests pin it with
  `toHaveBeenCalledWith(msg, expect.objectContaining(...))` — adding a
  `[WARN] [logId]` prefix arg or JSON-stringifying metadata into the message
  breaks them (10 tests went red this way; the fix was a shape-preserving
  passthrough in `writeConsole`). The logger adds Bugsink routing and returns
  the logId; it must not reshape the console call.
- Same reason: don't "improve" the metadata at a migrated call site
  (`console.warn(msg, err)` -> `logger.warn(msg, { err })` is NOT faithful
  when a test expects the raw object as 2nd arg). Migrate the shape as-is;
  split cause/metadata only where no test pins the old shape.


## Engine learnings — distilled (PRs #38/#43/#48/#49/#51/#53 and follow-ups)

Secret scrubbing and redaction:

- Scrub-then-truncate is a repo-wide rule: scrub the FULL free-text field before truncating, at every surface — telemetry, client-visible stored error columns, task errors, logs, `cross_post_results`, publish reasons. Stored error text is client-visible (web status poll), same treatment. Grep for siblings (`scrub_secret_values(str(x)[:200])`) whenever fixing; every scrub site gets a >cap-length probe pinning "the scrubber received the whole message" (all-calls check, not `assert_called_once_with`).
- Probe a free-text redaction pattern against every serialization shape (bare, JSON, dict repr); probe values must dodge every other defense layer (`?sig=abc123xyz`, not `token=secret`) so the test pins the intended path; probe filler needs a separator after the secret (the greedy `[^\s,;\"']+` value pattern otherwise swallows both).
- Redact the known credential, don't pattern-match it: exact secret → `str.replace`/`redact_known_url` (no anchor to dodge), unknown free text → key-anchored scrubber. Variant sets: sorted longest-first; urllib3 embeds the request target, so include path+query and the transport's requote variants (`requests.utils.requote_uri`, not hand-enumerated safe-sets); skip variants <8 chars; guard `str.replace("", x)` emptiness (it interleaves between every character). One redaction shape per failure family — HTTP errors embed full URLs, connection-phase errors embed path fragments; pin each family behaviorally, and probe degenerate configs (a redaction test must include content the buggy code would actually mangle).
- Don't scrub what isn't free text: typed ints (and never bools) forward raw to PostHog so numeric filters keep working. Verify the sink's actual destination before acting on a "raw log leaks" claim.
- Verify a reviewer's suggested repair actually repairs the finding — if the finding proves the tool can't match, the suggested fix is a no-op (mutation-check the suggestion itself; only the white-box order pin may detect the revert).

Telemetry and funnel:

- Funnel entry = accepted, not attempted: `video_generation_requested` fires in an `on_accepted` callback after `add_task` acceptance, before the thread starts, never on queue-full rejection (pinned at manager level with fake that records callback-vs-execute order). Don't overclaim ordering in comments/tests — PostHog orders by timestamp, so say that, not "requested happens before started".
- Separate dedup guards per incident family (dispatch-failure vs task-pipeline): no shared guard can suppress or re-arm the other's terminal event. Dedup by notice, not by state: publish pre-writes FAILED then raises, so the FIRST notice always emits (bounded emission set), later notices stay deduped; milestone cache pops on every notice. One id may briefly emit two tried failure events while requested stays deduped — document the trade-off at the guard so nobody "fixes" the dashboard anomaly wrongly.
- Every lifecycle event carries full segmentation context; guard optional ids (`if user_id is not None` — pre-task slot failures sit outside the funnel by design) and document it at the call site. Degraded identity props use the `or`-sentinel "unknown" — `dict.get`'s default does not fire on explicit None; assert EVERY prop in the sentinel test (apply the None-sentinel to every sibling `.get(` in the diff).
- Import-time side effects warm in the server startup hook (not at module import in CLI/test paths); warm expensive lazy imports out from under locks (`analytics.warm_client()` at startup).
- New process-local guards break tests that reuse ids — clear the guard in setUp (same as the failed-event guard pattern). Grep the concept repo-wide in one pass when declaring comments stale ("Bugsink bridge" took three rounds).

Task lifecycle and billing:

- Never treat engine HTTP 200 as "task alive": parse the numeric state (-1 failed, 1 complete, 3 queued, 4 processing); 200 with readable terminal state is provably dead, 200 without a readable state is unverifiable (not active).
- Time-boxed auto-refund beats a human queue for stuck jobs (default 3 days, `refund_issued` audit trail); backfill, don't fail, on proof of delivery (published slot ⇒ completed); a wrong refund costs ~$0.10, charging for nothing is the worse error.
- Whoever charges owns the refund ledger: place each refund next to the charge that produced it; `refund_tokens` returning False is a REAL failure — log loudly and keep the batch running; an unreadable terminal state must be loud, not just fail-closed.
- A backstop that re-derives state can downgrade it: prefer the stored code; if re-categorizing, teach the categorizer the producer's exact messages (pin with a source-parsing sync test).
- Never write a boolean flag False over an unknown current value (settle writes `tokens_refunded=true` only; absence of a write is the safe default).
- A stage that throws on data issues spams every tick: data-dependent failures (deleted persona, missing embed) fail the slot once, never the stage repeatedly — fallible lookups live inside the per-item try. Name deliberate token-loss trade-offs in a tracking comment at the skip site.
- Bound every boot-time loop: cap the batch (100, ordered), log progress every 25, drain leftovers on later boots (idempotent ordering). Single-writer assumptions need an ops constraint in tracked docs (config.example.toml: stop-then-start only, never rolling deploys).

Tests and code:

- A test comment claiming behavior must pin it with an assertion — mirror sibling patterns (`assertEqual(store.refund_batch_calls, [])`). Verify vendor wire formats against the vendored SDK's own code (posthog-python's exception_utils is ground truth for stacktrace shape), not the reviewer's word.
- One predicate per concept: classification and property-forwarding gates can't disagree (a None status would mis-group silently). Pin the default branch of a classification explicitly. Pin operation order behaviorally when no input distinguishes it (spy on input, not output). A cap on an ordered diagnostic list keeps the INNERMOST frames (Sentry ends with the raise site) — pin `frames[-1]`.
- Never `git stash`/`pop` casually in a shared repo: verify `git stash list` first; prefer explicit worktree/branch ops. For mutation checks, NEVER `sed -i` with broad patterns — python with exact-string anchors + immediate restore, and `git diff` production files before committing.
- When the same default literal exists in N code paths, pin all N (`test_wrapper_default_provider_is_omniroute` mirrors the fallback path's pin).

## Review/task infrastructure

- Route-binding tests: when the fix IS one line of wiring, pin it at the route boundary (cheap; a revert stays green otherwise). Pull request summary: route-level pinning works only when the wiring is the fix.
- Logging census: migrating a route's failures to the central logger requires a pinned log-assertion test (`route-logging.test.ts`) — the migration is half-done without it. The logger's console emission preserves the EXACT call shape (message first, metadata second) — never reshape migrated calls; don't "improve" metadata (`(msg, err)` → `{ err }` is not faithful when a test pins the raw shape); split only where nothing pins the old shape.
## Simplify always: delete dead code, fail fast (2026-09-29)
- When a flow is removed, delete the ENTIRE path: API route + client
  functions + MCP tool + docs + i18n keys + tests. A half-deleted flow
  (e.g. POST /api/schedule gone but MCP schedule_video still calling it)
  is worse than the old code — it breaks loudly at runtime instead of
  failing at build time.
- Never silently ignore invalid states. Fail fast with a loud error so a
  resurrected dead path surfaces immediately instead of hiding as dead
  rows in the DB.
- If an endpoint/tool isn't used, it shouldn't exist. "Keep it por agora"
  is how garbage accumulates.

## Verify web-edited commits before merging (2026-09-29)
- A GitHub web edit ("Atualizar o tools.ts" on PR #18) duplicated JSDoc
  lines and left tools.ts unparseable — CI on the old head never caught it
  because the edit landed after the last green run. Cherry-picking the
  branch surfaced the break locally via vitest.
- Rule: after cherry-picking or merging a branch that contains web-made
  commits, run the affected test suite + typecheck locally before pushing.
  A green CI badge on an older head means nothing for a newer edit.

## Build learnings (2026-10-01)
- **A dynamic `import()` does NOT keep a Node-only package out of the client
  bundle.** Webpack statically analyzes `import('posthog-node')`, resolves it
  at build time, and bundles the SDK into the client chunk. posthog-node
  ships no browser export condition (only node/edge/workerd), so the client
  build died on `node:fs` / `node:os` / `node:path` (UnhandledSchemeError)
  via the chain `billing/page.tsx → token-balance.ts → logger.ts →
  posthog-server.ts`. Mark the import `/* webpackIgnore: true */` so webpack
  emits it untouched: Node resolves it natively at runtime on the server,
  and the browser never reaches it (the `typeof window` guard returns null
  first). Pinned by `posthog-server.node.test.ts` ("marks the posthog-node
  dynamic import with webpackIgnore: true"). Same bug class as the earlier
  `node:crypto`-in-the-browser-bundle incident — a client-reachable module
  must never give webpack a statically resolvable path to a Node-only
  package.
- **CI never runs `next build` for web — only Vercel does.** Webpack
  client-bundle breakage slips through a green CI; treat the Vercel preview
  build as the web build gate, and reproduce locally with
  `npx nx build web --skip-nx-cache` (local env needs the build-time
  `NEXT_PUBLIC_*` vars; a dummy `.env` suffices for verification — never
  commit it).


## Cypress practical gotchas

- `cy.wait()` only on requests the client actually fires: grep the app for the actual request (React Query hooks etc.) before wiring an intercept wait; log in for real (`cy.loginE2EUser()`) in every app-page spec — server-side middleware otherwise bounces to /landing and nothing mounts; an unused intercept is dead code — delete it.
- React datetime-local inputs: NEVER `.invoke('val')` + `.trigger('change')` (React's value tracker swallows the event). Set the value via the native prototype setter (the AUT's `ownerDocument.defaultView`, not the spec window's) and dispatch `new Event('input', { bubbles: true })`; assert the store-backed effect before submitting.
- `<video>` fixtures must be real playable mp4s generated with ffmpeg (`-movflags +faststart`), verified with ffprobe before commit; `cy.intercept` corrupts binary fixtures unless the encoding is forced (`{ fixture: 'x.mp4,null' }` — mp4 is not in Cypress's binary extension list).
- The AppShell renders BOTH the desktop sidebar and mobile header in the DOM (CSS-hidden twins break `scrollIntoView()`/`be.visible`). Scope page assertions inside a visible container (`[data-testid=account-page] …`) and use exact-href selectors (`a[href="/posts/${id}"]`, never `href^="/posts/"` which matches `/posts/new`).
- Never `cy.clock()` with all timers faked on a React Query page — notifyManager delivers results through real `setTimeout(0)`, so queries wedge in loading forever. Fake only what the test needs: `cy.clock(Date.now(), ['setInterval', 'clearInterval', 'Date'])`.
- New spec files under cypress/e2e must be modules (`export {};` at the end) — top-level helpers are globals across specs.
- After any `router.push` target change, grep the Cypress specs for the old URL (`grep -n "url().should" apps/web/cypress/e2e/*.cy.ts`); fix is a test-only update in the same PR — never revert the product change.

## Next.js brand assets and metadata icons

- Replacing brand assets means replacing EVERY icon surface: browsers request `/favicon.ico` first, so a stale `.ico` silently defeats new PNGs. Audit `favicon.ico` + `icon` + `apple-icon` together.
- `app/icon.png` / `apple-icon.png` are served RAW (no next/image optimization): keep small at source (icon ≤512px, apple 180×180); never commit byte-identical duplicates — prefer config `icons: { icon: '/logo.png' }` so the next rebrand can't drift twins apart.
- Config `icons` and file-convention icons do NOT merge in this Next version — declaring only `icon:` silently drops `apple-touch-icon`. Declare EVERY role in config; verify framework merge semantics in `node_modules/next/dist` before assuming additive behavior.
- `next/image` `priority` emits a preload link — reserve it for genuine LCP candidates (mocks swallow unknown DOM attrs; pin `priority`'s absence at the prop level via a capturing `vi.mock`).
- Pin config-declared metadata in layout tests (exact `metadata.icons` export + existence check that each href resolves under `public/`), and assert the brand mark per surface (`getAllByTestId('app-logo')`).

## Misc infrastructure rules

- supabase-js `rpc()` NEVER throws on Postgres errors — it returns `{ data, error }`. Destructure `{ error: refundError }` (and siblings), log loudly on failure; a billing correction still proceeds (the refund is a discrepancy, not a request failure). Verify the reviewer's line citations before acting — the cited location may not even exist in the file.
- Stryker mutates the ENTIRE changed file, not the diff: touching a route can flip `mutation (web)` red on pre-existing surviving mutants. Raise the score without scope creep: assert exact log messages, query-builder args (select/eq/order), and both sides of conditionals (`not.toHaveBeenCalledWith`); the CI mutation-report artifact names every survivor.
- Stryker's `[[]]`/`[]]` bracket escaping is needed in EVERY workflow that calls `stryker run --mutate` (bracketed route paths match nothing unescaped — zero files matched is the symptom).
- The ephemeral-Postgres `supabase-migrations` CI job stubs `auth` (and `storage` schema) only — the first migration touching `storage.buckets/objects` needs a minimal compat stub added to that step (production Supabase already has the schema; migrations stay untouched).
- mutmut's baseline runs only the covering tests in ARBITRARY order — never assert exact counts over shared global state (locate fixtures by id; known leakers with no tearDown happen to run later in the full suite; the symptom is `N != 1` in the baseline while the engine job is green).
- Document hard infrastructure names in the module docstring (e.g. both storage backends share `STORAGE_BUCKET = "videos"` — any other bucket name fails every upload). Prefer the caller's precise param type over a reviewer's suggested `object`.
- Comments describing schema state change in the SAME PR that changes the schema; restoring a dropped DEFAULT in schema.sql only covers fresh installs — ship an idempotent `alter table … set default` manual SQL file so deployed DBs converge. Sync-test failures must be mutation-verified, self-identifying (name the offending key), and document parser assumptions.
- CI web build verification: CI never runs `next build` for web — Vercel is the build gate; reproduce locally with `npx nx build web --skip-nx-cache` (needs build-time `NEXT_PUBLIC_*`; a dummy `.env` suffices, never commit it). A dynamic `import('node-only-package')` does NOT keep it out of the client bundle — webpack resolves it statically; mark `/* webpackIgnore: true */` (Node resolves it at runtime; the browser bails on the `typeof window` guard first). Server-only leaves must never give webpack a statically resolvable path to Node-only packages (pinned by dedicated test).
- Stryker runs the dry run from `apps/web/.stryker-tmp`, not `apps/web` — never read files via `../engine` relative to `process.cwd()` in web tests; resolve the repo root from the test file location (`findRepoRoot(import.meta.url)` in `apps/web/test/repo-root.ts` walks up to the `pnpm-workspace.yaml` marker, works from sandbox copies too).
- Hermetic env-var tests: CI injects ambient values (e.g. `BUILD=<run number>`) into every job — `patch.dict(os.environ, {...}, clear=False)` and `vi.stubEnv()` only touch listed vars; clear/stub EVERY related var when testing fallback/default behavior (engine: `_clear_build_env(monkeypatch)` first).
- Percent-encoded route params: decode before pattern-matching. Callers build paths with `encodeURIComponent` and double-encoding happens — `resolveSlotUuid` decodes until stable (capped at 3 rounds; decode failure falls back to the raw value). Never assume a route param arrived decoded.

## SSRF guard shape (server-side fetches of attacker-controlled URLs, PR #64)

- DNS-resolve the host (`node:dns/promises` `lookup` with `{all:true}`), refuse when ANY resolved address is non-public (loopback/private/link-local incl. 169.254.169.254/CGNAT/multicast/reserved + IPv4-mapped IPv6), fail closed on DNS errors, fetch with `redirect: 'error'` so a 3xx to an internal URL is never followed. Keep https-only + timeout guards. Name the DNS-rebinding residual in a comment at the check site.
- Make the DNS lookup injectable for tests (`fetchCimdDocument(clientId, fetchImpl = fetch, lookupImpl = defaultLookup)`) — no network in tests. Null-returning helpers degrade safely (call sites have no try/catch; a throw 500s the route).

## Billing: idempotent replay (PR #72)

- A replay must never charge: audit every path that returns `replayed: true`. When the spend is not idempotent at the DB level (no unique constraint ledger-side), the app must undo its own redundant spend — and NOT refund when the spend was skipped (gating on `!alreadySpent` protects a legitimate prior/concurrent spend).
- Fail closed on idempotency pre-checks: any lookup that gates a charge must 500 on a swallowed DB error — a failed SELECT never looks like "not found").
- Zombie schedules (0 slots) need age-gated cleanup (>10 min so no live request can still be working), with the ledger check preventing a second charge when the operation runs fresh.
- A test that never reaches the code path it names is worse than no test: when a test configures an error, assert the error path was actually taken.

## Faceless billing: per-post flag (PR #86)

- Faceless is a per-slot flag, never a persona attribute: `scheduled_posts.faceless` (written by the web at creation) is the only "no face" signal; engine `slot_faceless(slot)` counts only literal `True` — None/missing/malformed price the expensive with-face case. `build_persona_params(..., faceless=True)` contributes voice only (no avatar/photo).
- Pricing is mirrored in two languages and MUST stay in lockstep: web `computeVideoTokens(faceless, quality)` and engine `token_cost(faceless, face_quality)` — web pre-pays, engine refunds; both test files pin the same table (faceless→1; ok→2; very_good→3; unknown→2).
- The MCP no longer knows "faceless personas": `avatarUrl` required, client sends no personaMode/faceMixPercent (pinned absent); stale legacy keys are ignored, not rejected (negative tests).

## Faceless persona 500 — schema sync follow-ups

- Two-direction schema-sync test for `public.personas`: every insert key is a real column AND every NOT NULL-without-default column is supplied; name the offending key in the failure; pin the restored `default '{}'` sentinel (dropping the default must fail CI); match whole words on comment-stripped DDL (`\bnot null\b` / `\bdefault\b`); filter constraint keywords; column-level PRIMARY KEY is implicitly NOT NULL; document the one-column-per-line parsing assumption; mutation-verify the pins.
- Test names are subject to the same staleness rule as comments — grep test names too.

## JWT tamper tests

- JWT tamper tests must flip a fully-significant base64url char: `token.slice(0, -2) + "aa"` is a byte-level no-op ~1/256 of the time (ES256 signatures are 64 bytes = 86 base64url chars; the last chars are padding-ish and decoders ignore some low bits). Flip the FIRST signature char — proven with a 300-iteration loop asserting the signature bytes always change and verification always rejects.

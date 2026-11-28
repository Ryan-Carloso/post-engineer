# Repository Layout (Nx monorepo, pnpm)

- `apps/web/` — Next.js 15 dashboard, API routes and the in-process publish scheduler (`pnpm dev:web`, `http://localhost:3434`)
- `apps/mcp/` — MCP server (npm `post-engineer-mcp`, stdio; tests via `pnpm exec nx test mcp`)
- Root commands: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`

## Workflow

- Never push to `main` — always open a PR. Small, focused PRs; CI green and review threads resolved before merge.
- **Beta: breaking changes are preferred over backward-compat dual paths.** Zero real users (only the owner and a test account), so delete the old path instead of deprecating it. DB migrations still need care. When the first paying user arrives, the owner flips this rule: deprecation + migration window become mandatory.
- TDD by default: every change ships with new/updated tests; the relevant suite is green before committing.
- Commit messages describe the implementation, not the process ("redact encoded app password", never "review 11 findings").
- After a rebase touching any `package.json`, run `pnpm install --frozen-lockfile` and diff the dependency blocks (conflict resolution has silently dropped deps and duplicated `"version"` keys). After merging commits made in the GitHub web editor, run the affected tests + typecheck locally.
- Check a branch still merges with `git merge-tree --write-tree --merge-base=$(git merge-base HEAD origin/main) HEAD origin/main` and grep `^CONFLICT` — plain `git merge-tree` prints no conflict markers and reports a false clean.
- **Versioning is generated at deploy time; never bump by hand, no version commits/PRs.** `VERSION` holds only MAJOR.MINOR; the root `package.json` version is independent. Web = `MAJOR.MINOR.<merged PR number>`; MCP = `MAJOR.MINOR.<ordinal of the last commit touching apps/mcp/ in main>` (`.github/scripts/mcp-release-version.sh`; `apps/mcp/package.json`'s version is ignored). `release-mcp.yml` publishes it to npm on every `apps/mcp/` merge and on a schedule (a failed publish heals itself, or `gh workflow run release-mcp.yml`). The deploy ships the web only once npm serves that MCP version, and the web answers any other `X-MCP-Version` with 426 (`lib/mcp-version-gate.ts`) — change the version rule in both places together.

## CI gates — fix the code, never weaken the gate

Never widen an allowlist, ignore list, exclusion, threshold or entry list, and never edit a gate's test, to make a finding go away. Each checker prints what is wrong; the rules below are what it cannot tell you.

- **File size (`file-size`):** files over the 500-line cap are grandfathered and may not grow by one line — extract existing code into a small sibling module in the same change (e.g. `apps/mcp/src/schedule-shapes.ts`, `apps/web/lib/publisher/`). Run `node .github/scripts/file-size/check.mjs --base <merge-base> --head HEAD` **after the final commit** (it measures committed HEAD). `*.gen.<ext>` files are exempt and each is pinned by a drift test against its generator; vendored CalendarCN files (`.github/scripts/file-size/vendored-calendarcn.mjs`) are exempt from size, Stryker, UI coverage and Codecov.
- **MCP parity (MCP tests + `parity-exclusion-guard`):** every `apps/web/app/api/**/route.ts` handler is reachable through an MCP intent tool action, mapped in `apps/mcp/src/__tests__/parity-endpoint-tools.json` and sampled in `parity-action-samples.json`. A tool is a complete intent — never add a tool or action just because an endpoint exists; a step of an intent (a resolver lookup, a preview before confirm) maps to the action that calls it. The fix for a parity failure is an action on the right `intent-*.ts` tool. Exclusions (`parity-exclusions.json`), the verifier, the bearer test, the guard and CODEOWNERS are code-owned: a PR touching them waits for the owner's `parity-exclusion-approved` label — never apply it yourself.
- **Dead code (`dead-code`, `pnpm lint:dead-code`, `:fix` drops needless `export`s):** knip (apps, `scripts/`, `.github/scripts/`), `.github/scripts/dead-code/contracts.mjs` (`shared/contracts/`) and vulture (CI Python). Code used only by its own tests is dead too — knip counts a test import as a use, so delete such TypeScript by hand together with its tests.
- **Duplication (`duplication`, `pnpm lint:duplication`):** no block of 10+ lines / 100+ tokens twice in production code. The fix is one shared function or module, never a tweak that only breaks the token match. A route the parity verifier reads by syntax (an `oauth-redirect` or `bearer-rejected` exclusion) keeps the checked call in its own file and moves only the rest.
- **Provider lists (`provider-lists`):** `shared/contracts/providers.ts` holds `SOCIAL_PROVIDERS`, every named subset and the per-provider maps. Elsewhere, no hand-typed list of 3+ networks and no per-provider if/switch chain — use `Record<SocialProvider, …>`; export a new subset there.
- **Comments (`comments`, `pnpm lint:comments`):** source files carry zero comments — name things so the code explains itself; the why goes in the PR body or docs. **No directive exception:** `eslint-disable`/`oxlint-disable`, `@ts-expect-error`, `@vitest-environment`, `codeql[...]`, webpack/vite magic comments, JSDoc types, `# noqa`, `# type: ignore` and Python shebangs fail like any other comment. Fix the code the suppression hid, or move the setting into config: a Node-environment test is named `*.node.test.ts` (vitest `node` project); a Node-only package goes in `SERVER_ONLY_PACKAGES` (`next.config.ts`); a CodeQL false positive is dismissed on GitHub. Only generated and vendored files are exempt; code-owned files are not. The MCP bin's TypeScript shebang is a shebang token, not a comment.
- **Rate limits (`rate-limits`):** every exported method of every `apps/web/app/**/route.ts` reaches `applyRateLimit`; an intentional exemption is a typed entry in `.github/scripts/rate-limits/allowlist.json`. Reads machines poll use `profileForCaller(auth, CALLER_RATE_LIMITS.x)`. In other suites mock only `applyRateLimit` (spread `importOriginal`).
- API naming lint checks only new names in the contract surface; never rename shipped fields to satisfy it.
- In workflows use `pnpm exec <bin>`, never `pnpm <script> -- <flags>` (pnpm forwards a literal `--`).

## Review findings

- **A finding that names an invariant becomes a gate, not a one-off fix.** Default to a regression test that fails with the fix reverted. Promote it to a repo-wide checker only if it passes the whole repository with no new allowlist entry — needing one means it was an incident; keep the test. A finding that cannot be pinned mechanically is said so in the PR body.
- The AI reviewer often cites stale lines and invents contracts: grep the cited code before changing anything; decline false positives. A red review job with no findings is usually throttling — re-run.
- Local review: `opencode run --agent reviewer` with a free model (`opencode/nemotron-3.5-lightning-free` or `opencode/flint-40b-free`). CI races every `REVIEW_MODELS` entry (`opencode-review.yml`, `.github/scripts/review-race.sh`) and keeps the first review with a Verdict line.

## PR body

- Everything public on GitHub (titles, bodies, review comments) is in English. A PR body never claims server-side behavior the code does not implement — a prompt-side mitigation is not a server-side guard.
- **Every PR body has a before/after diagram** explaining the change (left = problem, right = solution): Excalidraw style (white background, sketchy strokes, colors, English), drawn by the agent and attached with `gh pr edit <n> --attach <png>` (gh ≥ 2.99) so it is a `github.com/user-attachments` URL. Never commit it or push it to `ui-diff-assets`.
- **A PR that changes what the user sees (layout, styling or copy) is not merge-ready without before/after screenshots in the body's `UI changes` section** — same screen, locale and viewport; mobile when layout changes; both locales when copy changes. Take them with the `ui-diff` skill (`.opencode/skills/ui-diff/SKILL.md`): `run` → `publish --pr <n>` → paste the published URLs into the body (the sticky comment never replaces the body). When publish is impossible, attach the images in chat for the owner. Captures are public: mark any new element showing a person's or account's identity with `[data-ui-diff-mask]` (pinned by `lib/__tests__/ui-diff-config.test.ts`). Run with `TMPDIR` on disk (`/tmp` is a 512M tmpfs); never `--motion`.
- Before that, look at the UI you changed with the `preview-ui` skill (`.opencode/skills/preview-ui/SKILL.md`): both locales (PT is default), console. Never schedule a real post for a screenshot.

## Chat replies

- **Every summary the agent posts in chat ships with a spoken MP3** next to the text. Never run it inside the live `mpt-tts-cpu` container (the deploy recreates it); run a one-off container: `docker run --rm -v tts_models:/models -v tts_voices:/voices -v <script>:/tmp/tts.py:ro -v /tmp/opencode:/out mpt-tts-cpu:latest python /tmp/tts.py`, where the script calls `local_tts.backends._use_system_espeak()` then `kokoro.KPipeline(lang_code="p", repo_id=backends.KOKORO_REPO, device="cpu")` with voice `pf_dora` (pt-BR). It is a reply format, not a code path.

## Env files (never commit secrets)

- One env file: `apps/web/.env` (incl. Cypress `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD`), gitignored, created from `apps/web/.env.example`. No new env files, no `.env.local`. Never remove `.env` ignore rules, stage secret files, or print secret values.
- **No fallback values for env vars** — fail explicitly when missing (`process.env.X!`, never `|| 'default'`). Exception: PostHog keys are warn-and-continue — telemetry must never break the app.

## Code standards

- No `any`; use `unknown` + type guards. Explicit function types. Avoid type assertions. Server actions use `'use server'`.
- Strict null checks: spell out `=== null || === undefined`; `== null` is banned. Falsy is not absent (`''` is a provided value).
- Never fail silently: log errors, surface explicit messages, never catch-and-suppress. Pass the original error as the logger cause — never `undefined` or the message string. Mutations treat non-2xx, non-JSON and `success:false` as failures; invalidate caches only on real success.
- Guard every property access on remote-controlled JSON.
- When a flow is removed, delete the whole path (route, client fns, MCP action, docs, i18n keys, tests).
- When fixing a flagged pattern, grep the whole repo for siblings before calling it fixed.
- Test names, docstrings and docs describe what the code actually does — update them in the same change.
- Pin the same literal everywhere it lives (SQL limits vs TS constants, cross-app copy) with a file-parsing sync test. No dynamic `new RegExp(interpolated)`, even in tests (CodeQL) — use `includes`.
- A new check on stored data accepts every form the product already stores (e.g. a persona language as `en-US` or `English`); grep the other subsystems first.
- No value imports back across an extraction boundary (circular import): pass helpers in as parameters, import only types.
- This repo pins a Next.js version: check `apps/web/package.json` and `node_modules/next/dist/docs/` before framework-level code.

## Web UI

- `components/ui/` = presentational components (props + callbacks); fetching/OAuth/state stay outside.
- **Reuse before you build (strict):** `components/ui/` (shadcn; add primitives with `pnpm dlx shadcn@latest add <x>`), then `components/`, then `lib/ui.tsx` (icons, `INPUT_CLASS`, `SECTION_LABEL_CLASS`; compose with `cn()`) and `lib/publish-links.ts`. A second differently-styled version of an existing component is a bug; justify any new component in the PR.
- **Every dropdown is `SelectField` from `components/ui/select.tsx`** (built on UI SDK `@ui-sdk/react/select`), never a native `<select>` (`lib/__tests__/no-native-select.node.test.ts` fails the build). Pass the options as data: the trigger needs their labels before the list opens. New UI primitives are built on UI SDK (`@ui-sdk/react`) behaviors styled with our Tailwind tokens; an existing primitive without it is converted when touched.
- Social accounts come from the React Query hooks in `lib/api.ts` (`useSocialAccountsQuery` and the per-provider hooks), all on the single `social-accounts` key; no parallel `useState`/`useEffect` fetchers.
- Never render raw server/English errors, transport errors (`TypeError: Failed to fetch`) or internal codes in the localized UI — map to i18n keys with a localized generic fallback. User-facing numbers interpolate shared constants.
- Client fetch helpers never throw on HTTP errors: check `response.ok`, guard `response.json()` (proxy HTML bodies), return `{ success: false, error }`. Every promise chain has a `.catch`.
- UI gates derive from persisted/loaded data, not create-flow (zustand) stores. Disable every control while a mutation is pending. No side effects in setState updaters. Effect deps key on ids, not objects. Dedupe list items at the source so React keys cannot collide.
- Destructive dialogs: initial focus, Escape, focus trap, reset on close.
- Overridable base classes go through `twMerge`. `next/image` `priority` only for real LCP images. Metadata `icons` disables file-convention icons in this Next version — declare every role.
- A dynamic `import()` doesn't keep Node-only packages out of the client bundle — add the package to `SERVER_ONLY_PACKAGES` in `next.config.ts` (server external; empty module in the client and edge builds). CI doesn't run `next build`; reproduce with `npx nx build web --skip-nx-cache`.

## Web API

- Validate strictly: 400 on over-length, malformed, conflicting or coerced input — never silently truncate/coerce/drop. Validate shared params before branch splits; cheap checks before expensive reads.
- Unknown ids → 404. At `.single()`: PGRST116 → 404, any other error → logged 500. Never discard a query error on an auth/security branch.
- Classify failures: 404 = gone; 401/403 = config error (log at error, never retry); 5xx/429/aborts/unparseable-200 = transient (retry with backoff).
- Service-role bypasses RLS: re-check ownership. API-key **and** OAuth callers take the service-client branch (`isApiKey === true || isOAuth === true`).
- **A persona-scoped API key sees only its personas' data in every response field**, not just the rows (`isScopedApiKey(auth)` + UUID-validated `auth.personaIds`). A capped read never feeds a scope decision — read only the ids the rows reference (`.in('id', ids)`).
- supabase-js `rpc()` never throws — always check `error`.
- Multi-step DB mutations go in one SQL function with locks; check-then-act re-checks in the UPDATE predicate (zero rows → 409).
- A committed mutation is never a bare 500: return what committed plus stable warning codes (e.g. `FIRST_COMMENT_WARNING_CODES`), rendered amber.
- Coerce derived state at the write boundary on every branch, including legacy data.
- Deletes: collect storage paths before cascade; delete rows first, storage after (best-effort, one retry, loud logs).
- Bound fan-out and reads: caps + time budgets, deterministic `.order().limit()`, expose `truncated`. Post-commit cleanup goes in `after()` with its own budget.
- Insert keys must exist in the schema; NOT NULL-without-default columns must be supplied (schema-sync tests pin both).
- Route files export only handlers. Decode percent-encoded route params before pattern-matching.
- `GET /api/version` reports only build metadata and telemetry flags.
- SSRF: server fetches of user URLs resolve DNS and reject non-public addresses, fail closed, `redirect: 'error'`, https + timeout; inject the lookup for tests.

## Publishing (web scheduler)

- The scheduler runs inside the web process (`lib/scheduler-jobs.ts` + `lib/publisher/`), one slot at a time, bounded by a per-tick cap and time budget. Never publish a slot without the SQL claim `claim_next_publish_slot` — it is the only bound on concurrent publishers.
- The route and the scheduler share `lib/upload/publish-content.ts`; calling a handler directly skips the publish ledger that stops a resumed slot from publishing twice.
- **Handlers report dead accounts:** every `lib/upload/*-handler.ts` catch calls `reportAccountUnauthorized(...)`. `isUnauthorizedError` knows each network's dead-token shape (HTTP 401; Bluesky `invalid_credentials`; Meta HTTP 400 with `providerCode === 190` via `readMetaErrorCode`). Never add a numeric `code` field to Meta errors — `httpStatusOf` reads it as an HTTP status.
- Scrub secrets before truncating, on every surface (telemetry, logs, Discord, stored/client-visible errors, email). Redact known credentials by exact replacement including encoded variants; the pattern scrubber is only for unknown text.
- Data-dependent failures fail the item once, not the whole tick. A Supabase outage logs once and stops the tick, with a reminder every 30 minutes.
- Uploaded videos live in the `videos` bucket (`lib/publisher/constants.ts`); cleanup runs after a terminal state.
- Post metrics (`lib/metrics/`): any re-read of `post_metrics` mirrors the "collected" rule of `find_post_metrics_due` (YouTube rows with null/`scope_missing` `analytics_status` are not collected); every `metricsTargets` consumer logs `unknownProviders`; budgets count against `MAX_POSTS_PER_RUN`, not the `+1` probe limit.

## MCP

- Secrets (bearer tokens, app passwords, URL userinfo, upstream errors) never reach output/logs — redact raw, encoded and JSON forms; cap upstream bodies.
- HTTPS or loopback-only URLs, normalized; OAuth `auth_url` must be https.
- Empty 2xx → `{ ok: true }`; non-JSON 2xx → error. Every fetch has an `AbortSignal` timeout (files: 120s).
- Tools are intent tools (10, each with an `action`), not one per endpoint. Each registers from its `intent-*.ts` module via `byAction({ action: handler }, SPECS, 'tool')` (`action-tool.ts`): one flat advertised schema, a strict per-action re-parse, no defaults on the flat shape. Persona and account fields take a name or an id (`refs.ts`: exact match, candidates on ambiguity, never a guess). Actions that read a local file are stdio-only. Shared limits live in one module.
- Bounded memory: `stat()` before reading files, read sequentially; argument checks before any file read.
- No test-only seams on production interfaces — inject via options (`now: () => Date`).

## Supabase migrations

- Numbered, append-only in `supabase/migrations/`; never edit a shipped file. Everything idempotent. Add FKs in a `pg_constraint`-guarded do-block (`create table if not exists` never adds them to an existing table).
- `supabase/README.md` is the single migration list — update it with each migration. Moving a migration file: grep the tests that read it.
- Never hand-edit `supabase/schema.snapshot.json`: regenerate with `dump-schema --write` against a freshly migrated local Postgres.
- Adding a value to a provider list: update every table's check constraint in the same migration, check the live database too (objects the chain no longer defines can linger in prod), and pin each list to `providers.ts` with a sync test.
- CI applies the chain to an ephemeral Postgres (stubs only `auth`/`storage`). Beta: destructive migrations need only the owner's merge. CD runs `supabase db push --linked --include-all` on merge, so an out-of-order merge still applies.

## Prompts and docs

- Every prompt is a row in `user_prompts`; there is no prompt text, step list or slug list in git. The web and the MCP read `GET /api/prompts[/slug]`; change prompts in the app or with the `prompts` tool, never in code.
- Docs facts are imported from their source of truth (`TOOL_DESCRIPTIONS`, `buildInstallPrompt`, the providers contract), never retyped. Editing a docs page bumps `updatedAt` and `contentHash` together.

## Testing gotchas

- Test names are in English. Tests must not pass vacuously: assert the path under test was taken, and mutation-verify new pins (revert the fix → the test fails). Test names match their assertions; rename a test when its behavior flips.
- Order a guard test so the guarded statement can break the assertion (a commented `drop table` goes *after* the statement it protects). A "never touches the database" test asserts every query channel and runs as the caller that reaches each query.
- Mocks mirror production (real query chains, envelopes, echoed payloads). Fixtures use shapes production produces in every row: PostgREST returns a nullable column as `null`, never absent. Fixture dates derive from `Date.now()` — a fixed future date is a time bomb.
- Every new failure branch gets its own test asserting the outcome and the exact log call. A cap test needs one more candidate than the budget. A locale test asserts the formatted value, not the translation key.
- Env: `vi.stubEnv(key, undefined)`, never `delete process.env.X`; stub every related var (CI injects ones like `BUILD`). Don't `mockReset()` a `vi.stubGlobal`'d fetch in `beforeEach`. Multipart route tests run in Node: name them `*.node.test.ts`.
- Logger migrations preserve the exact console call shape (`msg, obj`). JWT tamper tests flip the first signature char.
- Web tests find repo files with `findRepoRoot(import.meta.url)` (`apps/web/test/repo-root.ts`), never `process.cwd()` (Stryker runs from `.stryker-tmp`).
- Cypress: specs end with `export {};`; log in via `cy.loginE2EUser()`; only `cy.wait()` on requests the app fires; scope selectors to a visible container (the AppShell renders hidden responsive twins); set React inputs via the native value setter + `input` event; binary fixtures need `'x.mp4,null'`; never `cy.clock()` on React Query pages. Mock APIs with the shared helpers (`cypress/support/prompt-mocks.ts`).
- CI Cypress runs against a throwaway local Supabase (`.github/actions/local-supabase`, seeded by `apps/web/cypress/supabase/seed-e2e.sh`), never production: a spec that needs a row gets it from the seed script.

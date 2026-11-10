# Repository Layout (Nx monorepo, pnpm)

- `apps/web/` — Next.js 15 dashboard + API routes (`pnpm dev:web`, `http://localhost:3434`)
- `apps/engine/` — Python/FastAPI video-generation engine (`pnpm dev:engine`, `http://127.0.0.1:8080`)
- `apps/mcp/` — MCP server (npm `post-engineer-mcp`, stdio; tests via `pnpm exec nx test mcp`)
- Root commands: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`

## Workflow

- Never push to `main` — always open a PR. Small, focused PRs; CI green and review threads resolved before merge.
- **Beta: breaking changes are acceptable and preferred over backward-compat dual paths.** The product is in beta with zero real users (only the owner and a test account), so delete the old path instead of deprecating it or maintaining both paths — a deprecation window or dual-path shim is tech debt until real users exist. DB migrations still need care. When the first paying user arrives, this rule flips explicitly (a user decision): deprecation + migration window become mandatory.
- TDD by default: every change ships with new/updated tests; the relevant suite is green before committing.
- **File-size ratchet (CI `file-size`): files already over the 500-line cap are grandfathered and may not grow by a single line** — a feature that adds lines to one must extract existing code into a new small module in the same change so the file ends at or below its base size (precedents: `apps/mcp/src/schedule-shapes.ts`, engine `app/services/` helpers, route-sibling modules like `app/api/persona/form-parsing.ts`). Check before pushing: `node .github/scripts/file-size/check.mjs --base <merge-base> --head HEAD`. Generated `*.gen.<ext>` files are exempt from the file-size check; each must be pinned by a drift test against its generator.
- **Verify a branch still merges with `git merge-tree --write-tree`, not plain `git merge-tree`.** Plain output carries no `<<<<<<<` markers, so grepping for them reports a false clean while real conflicts exist (PR #497 sync: 8 conflicts missed). Use `git merge-tree --write-tree --merge-base=$(git merge-base HEAD origin/main) HEAD origin/main` and grep `^CONFLICT`.
- **MCP parity gate — never weaken it.** Every `apps/web/app/api/**/route.ts` endpoint must have an MCP tool that calls it (mapped in `apps/mcp/src/__tests__/parity-endpoint-tools.json`, proven by the parity test) or a typed exclusion in `apps/mcp/src/__tests__/parity-exclusions.json`, verified per handler from the syntax tree and by a behavioural bearer test. Never add, edit, or re-label an exclusion, or edit the parity test, its `parity/` verifier, the bearer test, the guard or CODEOWNERS, to make a failure go away — the fix for a parity failure is a tool (registered in `index.ts`, mapped, documented and tested). Such a PR fails `parity-exclusion-guard` until the code owner approves the current head and applies the `parity-exclusion-approved` label; never apply that label yourself.
- **Extracted engine helpers need direct unit tests or their mutmut shard fails** — mutmut attributes endpoint/TestClient tests to the file they were written against; a helper moved into its own module (e.g. `app/services/upload_filenames.py` out of `controllers/v1/video.py`) can end up with zero attributed tests, and the per-file `mutation (engine shard)` job exits 1 with "could not find any test case for any mutant" even though the suite passes. Give the new module a direct test file (`test/services/test_<module>.py`) in the same change.
- **Look at the UI you changed.** After editing `apps/web`, load the `preview-ui` skill (`.opencode/skills/preview-ui/SKILL.md`) and check the running dev server — screenshots, both locales (PT is default), console. Never schedule a real post or spend tokens for a screenshot.
- **UI PRs are not merge-ready without before/after screenshots in the PR body.** Any change to what the user sees — layout, styling, or copy — fills the `UI changes` section of `.github/pull_request_template.md`: before and after shots of the same screen, same locale, same viewport, plus mobile shots when the layout changes and both locales when copy changes. A PR that only changes copy still needs the shots; a green test suite says nothing about layout.
- **Every PR body includes an Excalidraw before/after diagram.** It explains the change, not the UI: left = problem before, right = solution after. Excalidraw style — white background, sketchy stroke, in English, with colors — and it is uploaded as a GitHub attachment, not committed as a file in the repo. This is distinct from, and in addition to, the UI screenshots above.
- **Versioning is generated at deploy time; never bump by hand.** `VERSION` holds only MAJOR.MINOR (edited when cutting a release line). Deployed version = `MAJOR.MINOR.PR_NUMBER`, resolved on the VPS from the merged PR of the deployed commit (deploy fails if unresolvable). No version commits/PRs. `package.json`/`pyproject.toml`/MCP versions are hand-maintained and independent. MCP releases are automatic: `release-mcp-auto.yml` tags the `package.json` version on MCP-code merges, opens a minor auto-bump PR (with auto-merge) when that tag already exists instead of skipping, and tags bump-only merges directly — a version is never silently forgotten because its tag already existed. All pushes and PRs in that workflow use the `MCP_RELEASE_TOKEN` PAT secret, never `GITHUB_TOKEN`: GitHub does not start workflow runs for `GITHUB_TOKEN`-created events, so a tag pushed with it would never publish and a PR opened with it would never get CI; a missing secret fails the job loudly instead. Build metadata (`VERSION`/`PR_NUMBER`/`BUILD`/`COMMIT`) is reported by engine `/version` + `/health` and web `/api/version`.
- After a rebase touching any `package.json`, run `pnpm install --frozen-lockfile` locally before pushing and diff the dependency blocks (conflict resolution has silently dropped deps and duplicated `"version"` keys).
- After merging/cherry-picking commits made in the GitHub web editor, run the affected tests + typecheck locally.
- Commit messages describe the implementation, not the process ("redact encoded app password", never "review 11 findings").

## Language

- All code comments are in English. Convert non-English comments in any file you touch. Test names too.
- Everything public on GitHub (PR/issue titles and bodies, review comments) is in English.

## Env files (never commit secrets)

- Only three env files: `apps/web/.env` (incl. Cypress `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD`), `apps/engine/.env`, `apps/engine/config.toml`. All gitignored; created from `*.example`. No new env files, no `.env.local`.
- Never remove `.env` ignore rules, stage secret files, or print secret values.
- **No fallback values for env vars** — fail explicitly when missing (`process.env.X!`, never `|| 'default'`).
  - Exception: PostHog keys (`POSTHOG_API_KEY` / `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST`) are warn-and-continue — telemetry must never break the app.

## Code standards

- No `any`; use `unknown` + type guards. Explicit function types. Avoid type assertions.
- Strict null checks: spell out `=== null || === undefined`; `== null` is banned. Falsy is not absent (`''` is a provided value).
- Server actions use `'use server'`.
- Never fail silently: log errors, surface explicit messages, never catch-and-suppress. Mutations treat non-2xx, non-JSON, and `success:false` as failures; invalidate caches only on real success.
- When a flow is removed, delete the whole path (route, client fns, MCP tool, docs, i18n keys, tests, stale comments). Unused code shouldn't exist.
- When fixing a flagged pattern, grep the whole repo for siblings (callers and callees) before calling it fixed.
- Comments, test names, and docs must describe what the code actually does — update them in the same change.
- Pin the same literal everywhere it lives: values duplicated across files/apps (SQL limits vs TS constants, pricing tables, cross-app copy, `SAFE_TASK_ID`) get a file-parsing sync test. No dynamic `new RegExp(interpolated)` even in tests (CodeQL) — use `includes`.
- A new gate or check on stored data must accept every form the product already stores, not just the current canonical one: personas store language as a code (`en-US`) or a full name (`English`, see the edge-tts name map), and the English-only gates in engine/web/MCP initially rejected the name form (PR #252 review). Before adding a validator, grep the other subsystems for the forms they already accept.
- This repo pins a specific Next.js version: check `apps/web/package.json` and `node_modules/next/dist/docs/` before framework-level code.

## Web UI

- `apps/web/components/ui/` = presentational components (props + callbacks); keep fetching/OAuth/state outside.
- **Reuse before you build (strict).** Look in order: `components/ui/` (shadcn; add primitives with `pnpm dlx shadcn@latest add <x>`), `components/` (`account-card.tsx`, `provider-icon.tsx`, `ui/social-accounts-section.tsx`, `ui/insufficient-tokens-dialog.tsx`, `ui/version-badge.tsx`, `ui/token-pack-cards.tsx`), `lib/ui.tsx` (icons, `INPUT_CLASS`, `SECTION_LABEL_CLASS`; compose with `cn()`), `lib/publish-links.ts` (network maps). A second differently-styled version of an existing component is a bug. Justify any new component in the PR.
- Social accounts: React Query via `useSocialAccountsQuery` / `useYouTubeAccountsQuery` / `useInstagramAccountsQuery` / `useBlueskyAccountsQuery` / `useLinkedinAccountsQuery` (`lib/api.ts`), all sharing the single `social-accounts` key (one `GET /api/account`, provider hooks filter via `select`); no parallel `useState`/`useEffect` fetchers.
- Never render raw server/English errors or internal codes in the localized UI — map to i18n keys with a localized generic fallback. User-facing numbers interpolate shared constants.
- Client fetch helpers never throw on HTTP errors: check `response.ok`, guard `response.json()` (proxy HTML bodies), return `{ success: false, error }`. Every promise chain has a `.catch`.
- Image anti-repeat rotation: explicit user overrides never enter rotation history; selection is a pure function (no side effects).
- UI gates derive from persisted/loaded data, not create-flow (zustand) stores. Disable every control while a mutation is pending. No side effects inside setState updaters. Effect deps key on ids, not objects.
- Destructive dialogs: initial focus, Escape, focus trap, reset on close.
- Overridable base classes go through `twMerge`. `next/image` `priority` only for real LCP images.
- Metadata icons: config `icons` disables file-convention icons in this Next version — declare every role; keep icon files small.
- A dynamic `import()` doesn't keep Node-only packages out of the client bundle — use `/* webpackIgnore: true */`. CI doesn't run `next build`; reproduce with `npx nx build web --skip-nx-cache`.

## Web API

- Validate strictly: 400 on over-length, malformed, conflicting, or coerced input — never silently truncate/coerce/drop. Validate shared params before branch splits; cheap checks before expensive reads.
- Unknown ids → 404. At `.single()`: PGRST116 → 404, any other error → logged 500. Never discard a query error on an auth/security branch.
- Classify failures: 404 = truly gone; 401/403 = config error (log at error, never retry); 5xx/429/aborts/unparseable-200 = transient (retry with backoff).
- History/timing writes go after the external accept (engine accepts/creates the job), never after the token gate — a failed engine call leaves no history.
- Service-role bypasses RLS: re-check ownership explicitly (comment at each site). API-key **and** OAuth callers take the service-client branch (`isApiKey === true || isOAuth === true`).
- supabase-js `rpc()` never throws — always destructure and check `error`.
- Multi-step DB mutations go in one SQL function with locks; check-then-act re-checks in the UPDATE predicate (zero rows → 409).
- A committed mutation is never a bare 500: return what committed plus stable warning codes. Warnings are stable codes (`PERSONA_IMAGE_WARNING_CODES`) rendered amber, not red — symmetric across producers.
- Coerce derived state at the write boundary on every branch, including legacy data (e.g. legacy `NULL` `face_mix_percent` coerces unconditionally on every write path).
- Deletes: collect storage paths before cascade; delete rows first, storage after (best-effort, one retry, loud logs).
- Bound fan-out and reads: caps + time budgets, deterministic `.order().limit()`, expose `truncated`. Post-commit cleanup goes in `after()` with its own budget.
- Rate-limit every upload, destructive, or fan-out route (`applyRateLimit`); mock the limiter in other suites.
- Insert keys must exist in the schema; NOT NULL-without-default columns must be supplied (schema-sync tests pin both).
- Route files export only handlers. Decode percent-encoded route params before pattern-matching.
- **Engine contract types are generated, never hand-copied.** `apps/engine/openapi.json` is the committed snapshot of the engine's FastAPI contract (`uv run python -m scripts.export_openapi --out openapi.json` from `apps/engine`); `apps/web/lib/engine/schema.gen.ts` is generated from it (`node apps/web/scripts/generate-engine-types.mjs`). Both are committed and drift-tested (engine `test/scripts/test_export_openapi.py`, web `lib/engine/__tests__/schema-gen.test.ts`): after changing an engine Pydantic model or route, regenerate both. Web code imports engine shapes from `lib/engine/types.ts`. Generated types are compile-time only — runtime guards on engine responses stay.
- Engine responses use the `BaseResponse` envelope `{ status, message, body }` — payload is `body`, never `data`. Mocks must use the real envelope.
- One engine task record per view: when a page needs several fields from the same task record (publish results, script angle, progress), read it once via a combined helper (`fetchEnginePostMetricsSource` pattern), never one GET per field on a rate-limited user-facing endpoint.
- SSRF: server fetches of user URLs resolve DNS and reject any non-public address, fail closed, `redirect: 'error'`, https + timeout; inject the lookup for tests.

## Billing

- Engine task 200 ≠ alive: parse `state` (-1 failed, 1 complete, 3 queued, 4 processing); only -1/1 are terminal.
- Stuck jobs auto-refund after N days (default 3), emitting `refund_issued`. A published slot = delivered (`completed`, never `failed`).
- Whoever charges owns the refund. A refund returning False/`error` is a real failure — log loudly. Write `tokens_refunded=true` only when the refund landed; never write a flag false over an unknown value.
- Replays never charge; idempotency pre-checks that gate a charge fail closed (500 on DB error).
- Faceless is a per-slot flag (`scheduled_posts.faceless`); only literal `true` counts. Pricing lives only in web `computeVideoTokens` (faceless→1, ok→2, very_good→3, full lip-sync ok→8, full lip-sync very_good→15). The charged amount is stored per slot in `scheduled_posts.charged_tokens` (migration 045), and every refund path (engine generate/reconcile/publish, web cancel) refunds that stored amount — never recompute a price at refund time. A slot charged 0 makes no refund call (`refund_batch_tokens` rejects amounts ≤ 0).
- Batch discount (issue #487, `lib/billing/batch-discount.ts`): every 6 face videos of one MCP batch (`scheduled_posts.batch_id`), the cheapest is free. It is a credit after the normal charge (`POST /api/videos/batch-discount`: `charged_tokens` → 0, `discount_tokens` = the credit), never a lower price at charge time. Faceless never counts and is never free; a failed slot keeps counting but is never made free. Any path that refunds a slot of a batch on cancel must run the clawback (`app/api/schedule/batch-clawback.ts` → `settle_batch_clawback`, migration 046), or cancelling the paid videos leaves a free one behind. The clawback refunds the cancelled slots in full and pulls the discount back out of that free slot's discount refund row in the same transaction, so the charge cap still has room when the re-charged video is refunded later. A failed slot is never clawed back. When the batch earns that free video again, `restore_batch_discount_credit` (migration 047) tops the same discount row back up before the slot is marked free; `already_refunded` alone is not a credit, because the clawback leaves the row in place at amount 0.

## Engine

- An exception message built next to a log line carries the same scrubbed form as the log (e.g. `os.path.basename(src)`, never the full path): callers re-log `str(exc)` verbatim, so a raw path in the raised message leaks on surfaces the log line was careful about. `str()` of a subprocess error echoes the whole command line (absolute src/out paths) — pass it through `scrub_error_text` before it reaches any log line, raised message, or stored reason, and pin it with a production-shaped command in the test fixture, not a pathless stand-in.
- Scrub secrets before truncating, on every surface (telemetry, logs, stored/client-visible errors). Redact known credentials (e.g. webhook URLs) by exact replacement including transport-encoded variants; use the pattern scrubber only for unknown text. Don't scrub typed ints.
- Funnel: `video_generation_requested` fires only on acceptance (`on_accepted`). Dedup terminal events per incident family. Degraded identity props use `"unknown"` (`task.get(x) or "unknown"` — `.get` default doesn't fire on explicit None).
- Data-dependent failures fail the item once, not the whole stage every tick. Bound boot-time loops. The engine assumes a single writer (stop-then-start deploys, never rolling).
- No import-time side effects; warm clients in the startup hook.
- Storage backends share `STORAGE_BUCKET = "videos"` as the literal bucket name.
- A trim/limit helper that exists to preserve a trailing element (the CTA) must preserve it on EVERY path, fallbacks included: when no body fits next to it, the element ships alone — a plain-cut fallback that ends before it silently drops exactly what the helper protects. Pin the fallback paths, not just the length cap.
- A persona field the engine consumes (e.g. `niche` for the script angle) must be forwarded on EVERY dispatch path — web direct payload (`buildJobPayload`), engine batch (`build_persona_params`), MCP — a field populated on only one path is silently dead on the others. Pin each path with a dispatch test, not a hand-built params object.

## MCP

- Secrets (bearer tokens, app passwords, URL userinfo, engine errors) never reach output/logs — redact raw, encoded, and JSON forms; cap upstream bodies.
- HTTPS or loopback-only URLs, normalized; OAuth `auth_url` must be https.
- Empty 2xx → `{ ok: true }`; non-JSON 2xx → error. Every fetch has an `AbortSignal` timeout (files: 120s).
- Tool schemas defined once in `tools.ts`, registered in `index.ts`, pinned by tests; re-parse inside the handler when a `.refine` matters. Shared limits exported from one module.
- Bounded memory: `stat()` before reading files, read sequentially; argument checks before any file read.
- No test-only seams on production interfaces — inject via options (`now: () => Date`).

## Supabase migrations

- Numbered, append-only in `supabase/migrations/` (prefix = apply order); never edit a shipped file. Everything idempotent.
- `create table if not exists` with inline FK never adds the FK to an existing table — add FKs in a `pg_constraint`-guarded do-block.
- Update `supabase/README.md` with each migration — it is the single migration list; `docs/SELF_HOSTING.md` only links to it, never duplicate the list there. Moving a migration file: grep the tests that read it.
- CI checks numbering and applies the chain to an ephemeral Postgres (stubs only `auth`/`storage` — extend stubs if needed). BETA: there is no destructive-DDL label gate — destructive migrations are approved by the owner's merge tap, no separate label step; reintroduce the `db:destructive-approved` label gate explicitly when the first paying user arrives (the BETA flip rule). CD runs `supabase db push --linked --include-all` on merge (or via workflow_dispatch, always from `main`), before redeploying the VPS: `--include-all` also applies an older-numbered migration whose PR merged after a newer one, which plain `db push` refuses — without it an out-of-order merge leaves that migration unapplied forever.
- **A provider list lives in every table's check, not just the one the feature touches.** 034 added `'threads'` to the `post_metrics` check but not to `social_accounts`, whose `social_accounts_provider_check` (created by versioned migrations 0015/0016, deleted in the b4037cff consolidation, so the current chain never creates it) still held the four pre-Threads providers, so the Threads OAuth callback upsert failed in production with a check violation. When adding a value to a provider list, check the live database's constraints too — objects the chain no longer defines can linger in prod — update every table's check in the same migration, and pin each list to its TS source of truth with a file-parsing sync test.

## Prompts — every prompt comes from shared, never a hand copy

- `shared/prompt-base/prompt-base.ts` is the single source for every prompt served anywhere: the web hub reads it through the symlink `apps/web/lib/generation/prompt-base.ts` (never a real file, never a direct import — tsc rootDir and the Stryker sandbox both break on those), the MCP fetches prompts from the web API (`GET /api/prompts`, `GET /api/prompts/[slug]`), and recipe docs link to the hub page, never retype prompt steps.
- Never add a prompt, a prompt step, a tool name, or a provider-status claim in a second place — not in the hub data, not in the MCP, not in a doc. A second copy drifts the moment the first one is fixed (the stale "Bluesky is broken" warning, cited from issue #327 long after PR #332 fixed publishing, is the case that made this rule).
- Enforced by tests, not by convention alone: `prompt-base-shared` (the web file is a symlink, byte-identical to shared), `prompt-status-claims` (no `issue #` references or stale provider-status phrases in served prompts, every tool name mentioned is a registered MCP tool, and every hub entry's prompt text is exactly a shared export).

## Testing gotchas

- Tests must not pass vacuously: assert the path under test was actually taken; mutation-verify new pins (revert the fix, the test must fail). Test names match their assertions.
- Mocks mirror production (real query chains, real envelopes, echoed payloads).
- Env in tests: `vi.stubEnv(key, undefined)`, never `delete process.env.X`; stub/clear every related var (CI injects ambient ones like `BUILD`). Don't `mockReset()` a `vi.stubGlobal`'d fetch in `beforeEach`.
- Multipart route tests need `// @vitest-environment node`.
- Logger migrations preserve the exact console call shape (`msg, obj`).
- Web tests resolve repo files via `findRepoRoot(import.meta.url)` (`apps/web/test/repo-root.ts`), never `process.cwd()` (Stryker runs from `.stryker-tmp`).
- Stryker mutates the PR's changed LINE RANGES on web/mcp (`path:startLine-endLine` — `.github/scripts/ui-gates/changed-ranges.mjs` parses the `-U0` diff and emits the escaped patterns; new files and fallbacks mutate whole, so the scope only widens). Bracketed paths still need `[[]`/`[]]` escaping — done inside changed-ranges.mjs; the engine's mutmut mutates only the changed functions (`apps/engine/scripts/changed_functions.py`). mutmut runs a subset in random order — don't assert counts over global state.
- JWT tamper tests flip the first signature char, not the last.
- Cypress: specs end with `export {};`; log in via `cy.loginE2EUser()`; only `cy.wait()` on requests the app actually fires; the AppShell renders hidden responsive twins — scope selectors to a visible container and exact hrefs; set React inputs via the native value setter + `input` event; binary fixtures need `'x.mp4,null'`; never fake `setTimeout` with `cy.clock()` on React Query pages.

## CI / review

- Don't pass flags via `pnpm <script> -- <flags>` in workflows (pnpm forwards a literal `--`); use `pnpm exec <bin>`.
- API naming lint (`.github/workflows/api-naming.yml`) checks only new names in the contract surface; never rename shipped fields to satisfy it.
- Local review is `opencode run --agent reviewer` (or the reviewer agent in the TUI) with glm-5.3. The default/build agent does not review.
- The AI reviewer often cites stale or nonexistent lines and invents contracts: verify every finding (grep the cited code) before changing anything; decline false positives. A red review job with no findings is usually provider throttling — re-run.
- **Publish handlers must report dead accounts (2026-11-08, PR #505 OpenCode MAJOR).** Every `lib/upload/*-handler.ts` catch reports provider 401s via `reportAccountUnauthorized(provider, accountId, ownerUserId, error)` so PostHog `publish_account_unauthorized` names the broken account — a handler that only pushes the error string leaves a revoked token invisible. Bluesky never carries a numeric 401: a dead app password surfaces as `BlueskyError` code `invalid_credentials`, which `isUnauthorizedError` treats as unauthorized.
- **Guard every `.get` on remote-controlled JSON (2026-11-09, PR #504 OpenCode MINOR).** A non-dict item in the upload API's `results[]` crashed `_targets_from_body`'s synthetic-target fast path (`result.get` on a string) while the sibling branches guarded with `isinstance(item, dict)` — the fast path that skips the guard is the one that crashes.
- **Rename a test when its behavior flips (2026-11-09, PR #504 OpenCode MINOR).** `test_publish_failure_after_claim_returns_slot_to_ready` kept its name after the behavior flipped to staying `publishing`; the name described the exact opposite of the assertions.
- **A scoped API key must see only its personas' data in every new response field (2026-11-10, PR #528 OpenCode MAJOR).** `GET /api/metrics`'s new `coverage` array was computed from `auth.userId` + the URL `persona` param alone, so a persona-scoped key called without `persona=` got coverage items (post ids, persona ids, script angles, account ids, external video ids) for personas outside its scope — while the route's own rows query enforces the scope. Any new field on a scoped route must apply the same scope the route applies to rows (`isScopedApiKey(auth)` + UUID-validated `auth.personaIds`); persona-less (faceless) posts belong to no scope and stay visible.
- **Dedupe identical list items at the source so React keys cannot collide (2026-11-10, PR #528 OpenCode MINOR).** Two videos of one slot failing on the same account produce identical `publish-failed` coverage items (both carry no video id), and the card key `${postId}:${provider}:${accountId}:${externalId ?? 'failed'}` collides. Keep one item per (provider, account) in the failed-outcomes loop — published entries are keyed by (provider, accountId, video) in the engine, so only failed entries can collide.
- **A capped read must never feed a scope decision (2026-11-10, PR #528 OpenCode MAJOR).** `fetchCoverage` read personas from the whole `schedules` table capped at 1000 with no filter to the referenced ids, so for a user with more schedules than the cap a post's schedule was missing from the map and degraded to "no persona" — which the scope guard lets through, leaking out-of-scope coverage items to a persona-scoped API key. Read only the ids the posts reference (`.in('id', scheduleIds)`, bounded by `METRICS_ROW_LIMIT`). A schedule that still resolves to nothing is a deleted schedule — and its posts are NOT faceless by default (see the orphan rule below).
- **A deleted schedule does not make its posts faceless (2026-11-10, PR #528 OpenCode MAJOR).** `DELETE /api/schedule` deletes only pending/generating/ready slots and then the schedule row, so a published post survives orphaned with `faceless = false` while its `post_metrics.persona_id` (filled by the 026 trigger at insert, never rewritten) still names its persona. Deriving the coverage persona from the live schedule maps the orphan to null, and a null persona shown as "faceless" leaks the post to a persona-scoped key the rows query hides it from. The scope guard must use the post's own `faceless` flag: null persona + not faceless = hidden from scoped callers.
- **A locale test must assert the formatted value, not the key (2026-11-10, PR #528 OpenCode MINOR).** The pt-BR date test asserted only translation keys (`/metrics\.asOf/`), which the mocked `t()` returns verbatim, so it passed with the en-US branch too and never exercised the pt-BR branch of `formatDate`/`formatDateTime`. Assert the formatted string itself (`/21 de out\. de 2026/`, once per rendered line).
- **A sync-test comment must name the test that pins the constant, not the one that pins the SQL (2026-11-10, PR #528 OpenCode MINOR).** The window-hours comment pointed at `post-metrics.test.ts`, which hard-codes the SQL literal but never imports `METRICS_WINDOW_START_HOURS` — it would stay green if the constant drifted. The test that builds the expected `values ...` string from the constants lives in `metrics-coverage.test.ts`. A comment that names the wrong file tells the next editor to trust a test that cannot catch the drift.
- **A call-site comment must state the deliberate exception, not claim sameness (2026-11-10, PR #528 OpenCode MINOR).** The route's `fetchCoverage` call said "same policy as the rows query", but coverage hides orphaned persona posts (null persona + not faceless) while the rows query serves their null-persona snapshots (a snapshot inserted after the schedule was deleted resolves no persona in the 026 trigger). The accurate policy lives in `computeCoverage`'s scope guard; the call-site comment must name the exception instead of claiming the policies match.

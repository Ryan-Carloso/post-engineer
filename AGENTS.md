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
- **Every PR bumps the repo-root `VERSION` file** (minor for features,
  patch for fixes) via `scripts/bump-version.sh [patch|minor|major]` — it
  updates `VERSION`, the repo-root `package.json`, `apps/mcp/package.json`,
  `apps/web/package.json`, `apps/engine/pyproject.toml` and
  `apps/engine/uv.lock` in one go. CI (`version-check` workflow)
  fails the PR if the locations diverge or if `VERSION` was not bumped —
  this is the enforcement, not agent memory. The MCP already advertises
  its package.json version in the protocol handshake, so it stays unified
  automatically.

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

### Exception: PostHog telemetry keys
PostHog (`POSTHOG_API_KEY` / `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST`)
is intentionally warn-and-continue, not fail-fast. Rationale: telemetry must
never break the app — if the key is missing or PostHog is down, the app keeps
serving requests and logs to console only. The `??` chain across the two
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

## Next.js version note

This repo pins a specific Next.js version whose APIs and conventions may differ
from generic Next.js knowledge. Before writing framework-level code, check the
version in `apps/web/package.json` and the docs in
`node_modules/next/dist/docs/` (resolved from `apps/web/`). Heed deprecation
notices.

## Code review

- The per-PR OpenCode review was removed by user decision (2026-10-04) —
  too noisy, high hallucination rate. CodeQL, CI checks, and human review
  remain. Do not re-add a per-PR LLM review without the user's explicit ask.
- Reviewer findings (from any source) are claims: verify against current code
  before acting. Check that cited files and lines exist (grep the file —
  cited line numbers landing past EOF are the classic hallucination tell),
  and that the flagged code is still present on the current head (reviews
  analyze the accumulated diff, including superseded commits).
- Only durable, actionable rules go in this file — never hallucination
  incidents or round-by-round review logs.

## Codecov

- The `header`/`flags` comment sections only render when the PR diff touches
  coverable lines. A docs/config-only PR showing Codecov's condensed "All
  modified and coverable lines are covered by tests" comment is expected
  behavior, not a broken layout; the percentage header and per-flag table
  appear on PRs that actually change covered code.

## Billing reconciliation

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

## Billing hardening

- A replay must never charge: when the spend is not idempotent at the DB
  level, the app must undo its own redundant spend.
- Fail closed on idempotency pre-checks: any lookup that gates a charge
  must 500 on error, never charge blind.
- Zombie schedules (0 slots) get age-gated cleanup (>10 min), not an empty
  replay.
- supabase-js `rpc()` never throws on Postgres errors — it returns
  `{ data, error }`. Destructure and handle `error` explicitly.
- A test that never reaches the code path it names is worse than no test:
  when a test configures an error, assert the error path was actually taken.

## API naming lint

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

## Web/API standing rules

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
- **Fixing a banned pattern? grep the whole diff.** When a pattern is banned,
  search every touched file for siblings before declaring it fixed.
- **Every mutation needs visible error state.** Audit every mutation call
  site in a component, not just the ones quoted.

## Supabase migrations

- **Numbered, append-only, in `supabase/migrations/`.** The numeric prefix
  IS the apply order (`supabase db push` reads that directory and applies
  only pending migrations, tracked in
  `supabase_migrations.schema_migrations`). New migrations always append a
  new number; never edit a shipped number.
- **Everything idempotent.** `create table/index if not exists`,
  `add column if not exists`, `create or replace`, `drop ... if exists`
  before recreating an incompatible object.
- **Inline `references` never fires on an existing table.**
  `create table if not exists` with an inline FK is a no-op when an
  earlier migration already created the table — the FK silently never
  exists on that DB. Declare FKs on existing tables in an explicit
  do-block guarded on `pg_constraint`.
- **Pin app-coupled SQL with a static sync test.** When the app depends on
  SQL behavior, a test parses the migration file and asserts the literals.
- **Update `supabase/README.md` and `docs/SELF_HOSTING.md`** when adding a
  migration.
- **CI validates every migration PR** (`supabase-migrations` job in
  `ci.yml`): filename numbering unique + strictly increasing, destructive
  DDL blocked unless the PR has the `db:destructive-approved` label, and
  the full chain must apply cleanly to an ephemeral Postgres.
- **CD applies migrations after CI on `main`** (`deploy.yml`): `supabase db
  push --linked` (pending only). If migrations fail, the workflow fails
  loudly and nothing else runs.
- **Moving a migration file breaks its readers.** Grep every test for the
  old path in the same PR; migration files stay byte-identical across
  moves so `db push` checksums keep matching.

## MCP standing rules

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
  to agents.
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
  alive; use ephemeral ports and `mkdtempSync`, never fixed ports/paths.
- **Engines must cover the newest syntax used.** Import attributes
  (`with: { type: 'json' }`) need Node >= 20.10, not just >= 20.
- **Commit messages describe the implementation**, not the process
  ("redact encoded app password, inject clock via options", never
  "review 11 findings").

## SSRF guard

Server-side fetches of attacker-controlled URLs must: DNS-resolve the host
(`node:dns/promises` `lookup` with `{all:true}`), refuse when ANY resolved
address is non-public (loopback/private/link-local incl. 169.254.169.254,
CGNAT, multicast, reserved, IPv4-mapped IPv6), fail closed on DNS errors,
and fetch with `redirect: 'error'` so a 3xx to an internal URL is never
followed. Keep existing https-only + timeout guards. Name the DNS-rebinding
residual in a comment at the check site. Make the DNS lookup injectable
for tests (unit tests inject a fake lookup, no network in tests).

## CI lessons

- After ANY rebase that touches a `package.json`, run
  `pnpm install --frozen-lockfile` before pushing — a rebase can silently
  drop a dependency from `package.json` while the lockfile keeps it
  (`ERR_PNPM_OUTDATED_LOCKFILE`). When taking `--theirs`/`--ours` on a
  `package.json`, diff the dependencies blocks explicitly instead of
  trusting the merge.
- Never pass CLI flags through `pnpm <script> -- <flags>` in workflows:
  pnpm v10 forwards a literal `--`, so `pnpm test -- --coverage` runs
  `vitest run -- --coverage` and vitest silently skips coverage generation
  (tests still pass, no report files are written). Invoke the binary
  directly: `pnpm exec vitest run --coverage ...`.
- A coverage-generation step must actually produce the report file —
  `actions/upload-code-coverage` fails closed on a missing file even with
  `fail-on-error: 'false'`.

## Cypress lessons

- `cy.wait()` on an intercept the client never hits fails with "No request
  ever occurred" — grep the app for the real request first; unused
  intercepts are dead code, delete the whole path. Log in for real
  (`cy.loginE2EUser()`) in every app-page spec.
- React datetime-local: set the value through the native prototype setter
  (the AUT's `defaultView`) and dispatch a native `input` event (React's
  onChange listens to `input`) — never `.invoke('val')` + `.trigger('change')`.
- `<video>` fixtures must be real playable files: generate with ffmpeg
  `-movflags +faststart` and verify with ffprobe before committing
  (an mp4 without a moov box fails with MEDIA_ERR_SRC_NOT_SUPPORTED).
  `cy.intercept` corrupts binary fixtures (`.mp4` is not in Cypress's binary
  fixture extension list) — use `{ fixture: 'x.mp4,null' }` for a
  byte-identical Buffer.
- Diagnosis specs with hardcoded real incident ids don't belong in CI —
  delete them; pin the behavior with unit tests.
- Scope post-card selectors by exact `a[href="/posts/${id}"]` because
  `a[href^="/posts/"]` also matches `/posts/new`.

## Test quirks (vitest 4.1)

- **Don't `mockReset()`/`mockClear()` a `vi.stubGlobal`'d fetch in
  `beforeEach` when a test makes it throw.** With the reset in place, a
  throwing fetch mock surfaces as a phantom `Error` attributed to the test
  even though the code under test catches it and behaves correctly.
  Arm the mock explicitly in each test instead of resetting the stubbed global.

## Simplify always

- When a flow is removed, delete the ENTIRE path: API route + client
  functions + MCP tool + docs + i18n keys + tests. A half-deleted flow
  is worse than the old code — it breaks loudly at runtime instead of
  failing at build time.
- Never silently ignore invalid states. Fail fast with a loud error so a
  resurrected dead path surfaces immediately instead of hiding as dead
  rows in the DB.
- If an endpoint/tool isn't used, it shouldn't exist.

## Verify web-edited commits before merging

- A GitHub web edit can leave a file unparseable while CI stays green on
  the older head. After cherry-picking or merging a branch that contains
  web-made commits, run the affected test suite + typecheck locally before
  pushing. A green CI badge on an older head means nothing for a newer edit.

## Build learnings

- **A dynamic `import()` does NOT keep a Node-only package out of the client
  bundle.** Webpack statically analyzes `import('posthog-node')` and bundles
  it into the client chunk; posthog-node ships no browser export condition,
  so the client build dies on `node:fs` / `node:os` / `node:path`. Mark the
  import `/* webpackIgnore: true */` so webpack emits it untouched (Node
  resolves it natively at runtime on the server). A client-reachable module
  must never give webpack a statically resolvable path to a Node-only package.
- **CI never runs `next build` for web.** Webpack client-bundle breakage
  slips through a green CI; treat the deploy preview build as the web build
  gate, and reproduce locally with `npx nx build web --skip-nx-cache`
  (local env needs the build-time `NEXT_PUBLIC_*` vars; a dummy `.env`
  suffices for verification — never commit it).

## Git collaboration

- **Check PR merge state before touching its branch.** Pushing to a PR
  branch AFTER the user merged it silently orphans the commits: the merge
  went in without them and the push lands on a dead branch. Before
  committing or pushing to any PR branch, run
  `gh pr view <n> --json state,mergedAt` — if MERGED, cut a new branch
  from origin/main and open a follow-up PR instead.
- **Two agents, one git tree.** Prefer separate git worktrees per agent —
  branch checkouts are repo-global. Before committing in a shared tree,
  pause the other agent and confirm it acknowledged; only then commit.
  Commit (or WIP-commit) before turning to anything else when another
  agent shares the tree — uncommitted work does not survive a second
  agent's git ops. A rebase can silently drop your commit when someone
  else rebases the same branch concurrently — re-verify
  `git log origin/<branch>` after concurrent work.
- **Resolving version-file conflicts after a rebase.** `sed` on a
  conflicted package.json/pyproject.toml replaces the value on BOTH sides
  but leaves `<<<<<<<`/`=======`/`>>>>>>>` markers — and creates a
  DUPLICATE key in TOML and in JSON (`JSON.parse` silently keeps the
  last, so version-check stays green while the files are malformed).
  After resolving, ALWAYS: `git grep -n "^<<<<<<<"` for markers,
  `grep -c '"version"'` on each package.json for duplicate keys, validate
  with `./scripts/bump-version.sh check`, `python3 -c "import json..."` /
  `uv lock --check`, and `git diff --check`. Never trust sed alone on a
  conflicted file.
- **pnpm chown EPERM on worktree files.** Files in fresh git worktrees get
  group `nogroup` (gid 65534); pnpm's lockfile write preserves ownership
  via chown, and chown *to* gid 65534 fails with EPERM in this sandbox
  (chown to 0:0 works fine). Fix: `chown root:root pnpm-lock.yaml` in the
  worktree before running `pnpm install`.
- **Fresh worktrees lack node_modules** — symlink from the main checkout
  for vitest/tsc/eslint, and DELETE the symlink before committing.
- **Pre-commit hook** runs `lint:fix` (full web eslint --fix) + full
  `lint`/`typecheck` across web/mcp/engine — ~2 min per commit, including
  cherry-picks and amends. `eslint --fix` can reformat staged files into
  UNSTAGED working-tree changes that survive the commit: after any commit,
  run `git status` and fold leftover formatting into a follow-up commit.
  For pure history surgery (reset/amend/reorder) use `--no-verify`; verify
  lint/tests separately instead.
- **msend quoting.** NEVER use backticks in an `msend` message: the shell
  eats them as command substitution and they vanish from the delivered
  text. Write code identifiers in plain text without backticks, or escape them.

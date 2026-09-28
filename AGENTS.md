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

- PRs are reviewed by CI workflows in `.github/workflows/` (including an AI
  reviewer). Read reviewer feedback before requesting merge; address findings
  in focused follow-up commits.

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
- **Keep SQL literals coupled.** The `10` in `persona-images.sql` mirrors
  `MAX_PERSONA_IMAGES`; the coupling is documented in both places.
- **Sync editor state with refetches.** Local editor copies re-sync from
  props when not editing; in-progress edits are never clobbered.

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

## Web/API review learnings, round 2 (2026-09-28)
- **Fixing a banned pattern? grep the whole diff.** The `instanceof File` ban
  was applied to `images/route.ts` but the same PR added a new call site in
  `persona/route.ts`. When a reviewer flags a pattern, search every touched
  file for siblings before declaring it fixed.
- **Every mutation needs visible error state.** The "set as primary" toggle
  used fire-and-forget `mutate()` while save/remove had error handling —
  audit every mutation call site in a component, not just the ones the
  reviewer quoted.
- **Validate shared params before branch splits.** `image_id` validation
  lived only in the persona branch; faceless callers got silent ignores.
  Validate before the faceless/persona split.
- **Reject over-length input, don't truncate.** PATCH silently `.slice()`d
  over-length tag/description; direct API callers got silent data loss.
  Strict type checks + silent truncation is inconsistent — 400 instead.
- **Multi-step DB mutations go in one SQL function.** The primary swap was
  two app-side UPDATEs that concurrent calls could interleave; the
  `set_primary_persona_image` function locks the parent row and does
  demote-then-promote back-to-back. Same class as the history RPC.
- **Verify the reviewer's arithmetic.** OCR claimed the AFTER INSERT
  `count(*) > 10` trigger allows an 11th row — wrong: after inserting row
  11, count is 11 > 10, so it raises. Don't apply a fix for a broken proof.
- **MCP client hygiene:** derive display values from constants (never
  hardcode "10MB" next to `MAX_LIBRARY_IMAGE_BYTES`); one `readFile`
  instead of stat/read (TOCTOU + consistent errors); file-carrying
  requests get a longer timeout (120s vs 30s); independent reads go
  through `Promise.all`; fail fast client-side on no-op calls.

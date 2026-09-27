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

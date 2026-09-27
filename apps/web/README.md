# apps/web — Dashboard + API

Next.js 15 app (TypeScript, strict mode): the Post Engineer dashboard and all
API routes (`app/**/route.ts`). Owns authentication (Supabase), personas,
scheduling, OAuth for social accounts (YouTube, Instagram, LinkedIn, Bluesky),
token billing (Stripe), API keys, and the MCP OAuth server.

## Develop

```bash
pnpm dev:web        # from repo root → next dev on http://localhost:3434
```

Or directly in this directory:

```bash
pnpm dev           # next dev -p 3434
```

Requires `apps/web/.env` (copy from `.env.example`) and a Supabase project
with the database schema provisioned. See the root
[README](../../README.md) for the full setup.

## Test / lint / typecheck

```bash
pnpm test          # vitest run (unit + integration)
pnpm test:watch    # vitest watch mode
pnpm test:e2e      # Cypress end-to-end (needs the dev server + E2E_TEST_EMAIL/_PASSWORD)
pnpm lint          # eslint lib/ app/
pnpm lint:fix      # eslint --fix
pnpm typecheck     # next typegen + tsc --noEmit (strict, no `any`)
pnpm build         # production build
```

From the repo root these run via Nx: `pnpm test`, `pnpm lint`, `pnpm typecheck`.

## Conventions

- No `any` types; env vars fail explicitly when missing (no fallbacks).
- All comments in English.
- Presentational components live in `components/ui/` — no fetching or OAuth
  logic there.
- Server actions use the `"use server"` directive.
- API routes authenticate themselves; see `lib/request-auth.ts`.

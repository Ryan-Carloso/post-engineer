# apps/web — Dashboard + API

Next.js 15 app (TypeScript, strict mode): the Post Engineer dashboard and all
API routes (`app/**/route.ts`). Owns authentication (Supabase), personas,
scheduling, OAuth for social accounts (YouTube, Instagram, LinkedIn, Threads, Facebook Pages, Bluesky, 3Speak) and manual-token connect (Rumble, Telegram),
publish access (closed beta + subscription), API keys, and the MCP OAuth server.

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

## Publish access

Publishing needs an active account: `user_profiles.access_until` is the
instant it stops, and `user_profiles.subscription_status` says whether the
account is admitted to the closed beta (`beta`), awaiting it (`null`), on a paid subscription, or a lapsed one. A new account starts with `access_until = now()`, so it cannot publish until an operator admits it:

```sql
update public.user_profiles set access_until = '2099-01-01T00:00:00Z', subscription_status = 'beta' where id = '<uuid>';
update public.user_profiles set access_until = now() where id = '<uuid>';
```

The second statement revokes. A blocked account gets `402 BETA_ACCESS_REQUIRED`, naming the Discord invite.
Cancellations, refunds and exhausted dunning all move `access_until`, so one
column covers every reason.

Billing is manual while the Stripe account is not wired. From the repo root:

```bash
pnpm access grant --email user@example.com --until 2027-01-01T00:00:00Z
pnpm access revoke --email user@example.com
```

Once `STRIPE_SECRET_KEY` is set, `pnpm access sync` pulls every subscription
and applies its state through `apply_subscription_access` (the same function a
webhook would call): `active`/`trialing` → the paid-through date, `past_due` →
that date plus the 3-day grace, `canceled`/`unpaid`/`incomplete`/
`incomplete_expired`/`paused` → now. A subscription with no billing link and
no `metadata.userId` is skipped, never guessed.

### E2E against a local Supabase

CI runs the Cypress suite against a throwaway local Supabase stack, never the
production project (`.github/actions/local-supabase`). Reproduce it locally
(Docker required):

```bash
supabase start --workdir apps/web/cypress \
  -x realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
supabase db push --yes --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable"
supabase status -o env --workdir apps/web/cypress   # API_URL, ANON_KEY, SERVICE_ROLE_KEY
```

Point `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` at those values, pick any `E2E_TEST_EMAIL` /
`E2E_TEST_PASSWORD`, run `apps/web/cypress/supabase/seed-e2e.sh` (it refuses a
non-local URL), then build, `next start -p 3434` and `pnpm test:e2e`.
`supabase stop --no-backup --workdir apps/web/cypress` throws the stack away.

## Conventions

- No `any` types; env vars fail explicitly when missing (no fallbacks).
- All comments in English.
- Presentational components live in `components/ui/` — no fetching or OAuth
  logic there.
- Server actions use the `"use server"` directive.
- API routes authenticate themselves; see `lib/request-auth.ts`.

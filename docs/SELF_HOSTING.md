# Self-hosting Post Engineer

This guide covers running Post Engineer on your own infrastructure (a VPS or
any host you control) with Docker for the engine. It replaces any
machine-specific deploy scripts: everything here uses placeholders you replace
with your own values.

## Architecture on one host

```text
                    ┌─────────────────────────────┐
Internet ──HTTPS──▶ │ Caddy (reverse proxy, :443) │
                    └──────┬──────────┬───────────┘
                           │          │
              ┌────────────▼──┐  ┌────▼────────────────┐
              │ apps/web      │  │ apps/engine         │
              │ (Next.js)     │  │ (FastAPI, Docker)   │
              └───────────────┘  └─────────────────────┘
```

The web app can run on a platform like Vercel or as a Node process behind the
same proxy; the engine runs in Docker via `apps/engine/docker-compose.yml`
(service name `engine`, container `mpt-engine-cpu`, listening on
`127.0.0.1:8080` inside the host network namespace).

## 1. Prerequisites on the host

- Docker Engine + the Compose plugin
- Node.js 20+ and pnpm 10 (only needed if you build/run the web app on this host)
- A domain pointing at the host (used as `APP_DOMAIN` below)
- A Supabase Postgres: hosted at supabase.com, or self-hosted (see
  [Supabase self-hosting docs](https://supabase.com/docs/guides/self-hosting))

## 2. Environment setup

On the host, create the same three env files documented in the
[README](../README.md#3-create-the-three-env-files-never-commit-these):

- `apps/web/.env`
- `apps/engine/.env`
- `apps/engine/config.toml` (copied from `apps/engine/config.example.toml`)

Generate fresh secrets on the host — never copy them from another machine:

```bash
openssl rand -hex 32     # MONEYPRINT_API_SECRET (identical in both .env files)
openssl rand -base64 32  # TOKEN_ENCRYPTION_KEY
```

Provision the database schema in your Supabase project:

1. `supabase/migrations/001_schema.sql` — tables, types and defaults
   (idempotent snapshot; see its header for what it covers and what to
   finish in the dashboard: RLS policies, FK constraints, RPC function
   bodies, the `personas` storage bucket).
2. `supabase/migrations/002_persona-images.sql` — persona image library
   constraints.
3. `supabase/migrations/003_engine-task-state.sql` — engine task state
   (only needed when running the engine with `MPT_STATE_BACKEND=supabase`).

Paste each file into the Supabase Dashboard > SQL Editor and run, in order
(the `001_`, `002_`, `003_` prefixes encode the order — always apply the
lowest number first), or apply them with the Supabase CLI from the repo
root: `supabase db push --db-url "<connection-string>"` (reads
`supabase/migrations/`). When the project adds new migrations they arrive
as new numbered files (`004_...`, ...); you only need to run the ones newer
than what you already applied. All files are idempotent, so re-running the
whole sequence is safe.

## 3. Run the engine with Docker Compose

```bash
cd apps/engine
docker compose up -d --build
docker compose logs -f engine
```

The compose file mounts `./config.toml` read-only into the container and reads
secrets from the adjacent `.env` file (never baked into the image). The API is
available at `http://127.0.0.1:8080` (see `/docs`); keep that port bound to
localhost and expose it only through the reverse proxy.

To update:

```bash
cd apps/engine
docker compose pull   # no-op unless you publish your own image
docker compose up -d --build
```

## 4. Reverse proxy with Caddy (example)

Replace `APP_DOMAIN` with your domain. This example terminates TLS
automatically and forwards to the two apps:

```caddy
APP_DOMAIN {
    # Web dashboard (Next.js). If you host the web app on Vercel instead,
    # point your DNS there and keep only the /engine/* block below.
    reverse_proxy 127.0.0.1:3434

    # Engine API — keep the engine itself on localhost; Caddy is the only
    # public entry point.
    handle /engine/* {
        uri strip_prefix /engine
        reverse_proxy 127.0.0.1:8080
    }
}
```

Set `MONEYPRINT_API_URL` in `apps/web/.env` to the public engine URL
(e.g. `https://APP_DOMAIN/engine`) so the web app can reach it.

> **Note on `NEXT_PUBLIC_*` vars:** Next.js inlines `NEXT_PUBLIC_*`
> variables (e.g. `NEXT_PUBLIC_WHATSAPP_NUMBER`) **at build time**. Setting
> them only at runtime has no effect — set them in `.env` and rebuild the
> web app (`pnpm build` / rebuild the container), otherwise the affected
> UI elements are silently absent.

### Rate-limit IP resolution

The web app's rate limiter buckets clients by IP. Off Vercel, the
`x-vercel-forwarded-for` header is ignored automatically (it is only
trusted when `VERCEL=1`, set by the Vercel platform), and the limiter
reads the **last** entry of `X-Forwarded-For`. Make sure your reverse
proxy **overwrites** (not appends to) `X-Forwarded-For` with the real
client IP — with Caddy this is the default. If the proxy instead appends,
all clients collapse into the proxy's IP bucket and the limiter will
block legitimate traffic.

Security notes:

- Never publish the engine's port directly; it authenticates with a single
  shared secret (see [SECURITY.md](../SECURITY.md)).
- Restrict SSH, keep the host patched, and put the database behind a firewall
  or private network.

## 5. Backups

Back up regularly:

- **Postgres** — Supabase hosted projects include point-in-time recovery;
  for self-hosted Postgres, schedule `pg_dump` (daily at minimum) and store
  dumps off-host.
- **`apps/engine/storage`** (Docker volume `engine_storage`) — rendered videos
  and task artifacts. Snapshot the volume or sync it to object storage.
- **Env files** (`apps/web/.env`, `apps/engine/.env`, `apps/engine/config.toml`)
  — keep an encrypted copy somewhere safe; they contain the keys needed to
  decrypt OAuth tokens (`TOKEN_ENCRYPTION_KEY`).

## 6. Updating

1. `git pull` the latest `main`.
2. Check the release notes for schema changes and apply them to your database.
3. Rebuild and restart: `docker compose up -d --build` (engine) and redeploy
   the web app.
4. Check the release notes for breaking config changes (new required env vars
   are documented in the `.env.example` files).

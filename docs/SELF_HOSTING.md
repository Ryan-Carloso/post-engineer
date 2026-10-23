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

Provision the database schema in your Supabase project: apply every file
in `supabase/migrations/` in numeric order. The full migration list —
what each file does, its prerequisites and its one-time setup steps
(some live in the file headers, e.g. the `app.cron_base_url` /
`app.cron_secret` database settings in 004 and the
`select public.schedule_post_metrics();` step in 025) — lives in the
[Supabase migrations README](../supabase/README.md); this guide does not
duplicate it.

Apply them from the repo root with the Supabase CLI:

```bash
supabase db push --db-url "<connection-string>"
```

or paste each file into the Supabase Dashboard > SQL Editor and run it,
lowest number first. When the project adds new migrations they arrive as
new numbered files; you only need to run the ones newer than what you
already applied. All files are idempotent, so re-running the whole
sequence is safe.

### Voices and cloning (local CPU TTS server)

All voices run on CPU in the `tts` service next to the engine
(`apps/engine/local_tts/server.py`, built from `apps/engine/Dockerfile.tts`):

- **House voices** — 65 English presets listed in
  `apps/engine/app/services/voice_catalog.json`: Phonon-31m-en (25 US/UK
  voices + 12 characters, Apache 2.0) and Kokoro-82M (28 US/UK voices,
  Apache 2.0).
- **Per-user clones** — Chatterbox Nano (MIT), zero-shot from the user's
  reference WAV, registered through `POST/DELETE /v1/voices` on the same
  server. Users can clean (denoise) the recording before cloning.

Setup:

1. Set `CHATTERBOX_HTTP_SECRET` in `apps/engine/.env` (the `tts` service reads
   it; the engine sends the same value).
2. In `apps/engine/config.toml`:
   - `[chatterbox] base_url = "http://tts:4123/v1"`, `api_key` = the secret
   - `[cloned_voices] registry_base_url = "http://tts:4123"`,
     `registry_api_key` = the secret
3. `docker compose up -d --build` in `apps/engine`. Models download to the
   `tts_models` volume on first use (Chatterbox Nano is a gated Hugging Face
   repo: accept its terms and set `HF_TOKEN` in `.env` if the download is
   refused). Clone references persist on the `tts_voices` volume.
4. Set web `MONEYPRINT_API_URL` / `MONEYPRINT_API_SECRET` as usual so
   `/api/persona/cloned-voices` proxies to the engine.

Picker samples live in `apps/web/public/voice-samples/<name>.mp3`; re-render
them with `python -m local_tts.render_samples ../web/public/voice-samples`
whenever the catalog changes.

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

Build metadata (`GET /version`, `/health`): the engine reports the
`VERSION` / `PR_NUMBER` / `BUILD` / `COMMIT` env vars when they are set at
deploy time. The deployed version is `MAJOR.MINOR.PR_NUMBER` (e.g. PR #152
-> `1.28.152`), where MAJOR.MINOR comes from the repo-root `VERSION` file
and the PR number is the merged PR that introduced the commit being
deployed. A self-hosted manual deploy can pass the same values:

```bash
cd apps/engine
VERSION=1.28.152 PR_NUMBER=152 BUILD=152 COMMIT=$(git rev-parse HEAD) \
  docker compose up -d --build
```

Unset, the engine falls back to the mounted `VERSION` file for the version
and reports `null` pr/build/commit.

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
- **The `personas` storage bucket (private, Supabase)** — persona photos and
  image libraries, under `personas/{userId}/{personaId}/…`. Back it up together
  with Postgres: the rows store the *path*, so a bucket restored under a
  different layout loses its files. The `personas_storage_own_all` policy only
  reads the FIRST path segment (`foldername(name)[1] = auth.uid()`) — keep it
  that way, or the objects written before the per-persona folders become
  unreachable for their owner. See `supabase/README.md` for the full layout.
- **Env files** (`apps/web/.env`, `apps/engine/.env`, `apps/engine/config.toml`)
  — keep an encrypted copy somewhere safe; they contain the keys needed to
  decrypt OAuth tokens (`TOKEN_ENCRYPTION_KEY`).

## 6. Updating

1. `git pull` the latest `main`.
2. Check the release notes for schema changes and apply them to your database.
3. Rebuild and restart, exporting the build metadata first so
   `GET /version` and `/health` identify the live build (see section 3 for
   the engine; the web takes the same vars as Docker build args):
   `VERSION=<major.minor>.<pr> PR_NUMBER=<pr> BUILD=<pr> COMMIT=$(git rev-parse HEAD)`
   before `docker compose up -d --build`.
4. Check the release notes for breaking config changes (new required env vars
   are documented in the `.env.example` files).

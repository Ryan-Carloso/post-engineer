# Post Engineer

[![CI](https://github.com/Ryan-Carloso/post-engineer/actions/workflows/ci.yml/badge.svg)](https://github.com/Ryan-Carloso/post-engineer/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/post-engineer-mcp.svg)](https://www.npmjs.com/package/post-engineer-mcp)

[🇧🇷🇵🇹 Leia em Português](README.pt-BR.md)

Create AI video personas that generate and publish short videos on autopilot.

Give a persona a niche and a voice; Post Engineer writes the script, generates the
voiceover, assembles the video, and publishes it to your social accounts on a
schedule. Manage everything from the web dashboard, drive it programmatically
through the API, or let your AI agent run it through the MCP server — all from
this one monorepo.

> Prefer the hosted version? The same platform runs at
> [post-engineer.com](https://post-engineer.com) — you can skip the local
> setup and connect the MCP server straight to your account (see
> [MCP server](#mcp-server)).

## What it does

- **AI personas** — persistent characters with a voice, face, language, and niche.
  Optional lip-synced intro clips for a human-like presenter, plus a persona
  image library for face consistency across videos.
- **Automatic video generation** — topic in, HD short video out: script (LLM),
  voiceover (TTS), subtitles, stock footage, and background music, assembled
  into a finished video.
- **Scheduling & publishing** — queue posts for YouTube, Instagram, LinkedIn,
  and Bluesky; track upcoming and past posts with per-account status.
- **Dashboard** — personas, posts history, connected social accounts, API keys,
  and token billing in one Next.js app.
- **Agent control** — an MCP server ([`apps/mcp/`](apps/mcp/)) exposes the same
  capabilities to AI agents (Claude, Cursor, Codex, OpenCode): create personas,
  generate videos, check status, and schedule posts.

## Repository layout

This is a pnpm/Nx monorepo — web, engine, and MCP live together:

```text
apps/web/       Next.js 15 dashboard + API routes (TypeScript)
apps/engine/    Python/FastAPI video-generation engine
apps/mcp/       MCP server for AI agents (npm package: post-engineer-mcp)
```

The web app owns authentication, personas, scheduling, OAuth, billing, and the
API. It calls the engine over HTTP (authenticated with a shared secret,
`MONEYPRINT_API_SECRET`) for video generation, TTS, and publishing. The MCP
server talks to the web API with a user API key. Postgres (via Supabase) is
the system of record: personas, schedules, OAuth tokens (encrypted at rest),
API keys, and token balances.

## Prerequisites

- **Node.js** 20+ and **pnpm** 10 (`npm install -g pnpm` or via corepack)
- **Python** 3.11–3.12 and **uv** (`curl -LsSf astral.sh/uv/install.sh | sh`)
- **ffmpeg** on `PATH` (the engine shells out to it via moviepy)
- A **Supabase** project (hosted at [supabase.com](https://supabase.com), or
  self-hosted) with a Postgres database
- API keys for the external services you plan to use (see the table below)

## Local setup from scratch

### 1. Install dependencies

```bash
git clone https://github.com/Ryan-Carloso/post-engineer.git
cd post-engineer
pnpm install
```

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com) (or point at your
   self-hosted instance).
2. In the Supabase SQL editor, apply the database scripts. The persona image
   library script lives in this repo: [`supabase/persona-images.sql`](supabase/persona-images.sql)
   (manual-apply by design).

   > **Need help?** If you are setting up a fresh project and need the current
   > schema snapshot, reach out:
   > **Email:** [ryan@post-engineer.com](mailto:ryan@post-engineer.com) ·
   > **WhatsApp:** [+351 962 248 268](https://wa.me/351962248268)

### 3. Create the three env files (never commit these)

There are exactly three env files by design — copy each from its example and
fill in your own values:

```bash
cp apps/web/.env.example apps/web/.env
cp apps/engine/.env.example apps/engine/.env
cp apps/engine/config.example.toml apps/engine/config.toml
```

| File | Purpose | Key variables |
|---|---|---|
| `apps/web/.env` | Web app + API routes | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only), `TOKEN_ENCRYPTION_KEY` (generate: `openssl rand -base64 32`), `MONEYPRINT_API_SECRET`, `MONEYPRINT_API_URL`, OAuth client ids/secrets + redirect URIs, Stripe keys, `MCP_OAUTH_PRIVATE_KEY_PEM` |
| `apps/engine/.env` | Engine runtime | `MONEYPRINT_API_SECRET` (must be **identical** to the web value), `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (for the in-process fill scheduler), optional `DISCORD_WEBHOOK_URL`, `BUGSINK_DSN` |
| `apps/engine/config.toml` | Engine behavior config | LLM/TTS/stock-footage provider keys (OpenAI-compatible, Pexels, Pixabay, …), `listen_port` (default `8080`) |

The app fails fast on missing variables (no silent fallbacks) — see
`apps/web/.env.example` for the full documented list.

### 4. Register OAuth apps (for social publishing)

To connect YouTube, Instagram, or LinkedIn accounts you need OAuth apps whose
**redirect URIs exactly match** the values in `apps/web/.env`:

- **Google / YouTube** — [Google Cloud Console](https://console.cloud.google.com):
  create an OAuth 2.0 Client ID, add the authorized redirect URIs from
  `GOOGLE_REDIRECT_URI` / `GOOGLE_REDIRECT_URI_LOCAL`, and fill in
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
- **Instagram** — [Meta for Developers](https://developers.facebook.com): a
  Business app with the Instagram product (`instagram_business_basic` and
  `instagram_business_content_publish` permissions); set `INSTAGRAM_CLIENT_ID` /
  `INSTAGRAM_CLIENT_SECRET` and register `INSTAGRAM_REDIRECT_URI`.
- **LinkedIn** — [LinkedIn Developers](https://developer.linkedin.com): create
  an app, register `LINKEDIN_REDIRECT_URI`, and set `LINKEDIN_CLIENT_ID` /
  `LINKEDIN_CLIENT_SECRET`.
- **Bluesky** uses an app password entered in the dashboard (encrypted at
  rest) — no OAuth app registration needed.

### 5. Stripe setup (token billing)

1. Create a [Stripe](https://stripe.com) account and get the secret +
   publishable keys (`STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`).
2. Create the token-pack products and put the price IDs in
   `STRIPE_PRICE_PACK_10` / `_50` / `_100`.
3. Add a webhook endpoint pointing at `/api/billing/webhook` and store the
   signing secret in `STRIPE_WEBHOOK_SECRET`. The webhook handler verifies the
   signature and is idempotent.

### 6. Generate the self-managed secrets

These are yours to create — nothing to register:

```bash
# Web <-> engine shared secret (identical in both .env files)
openssl rand -hex 32

# OAuth token encryption key (AES-256-GCM)
openssl rand -base64 32

# MCP OAuth signing key (PEM, \n-escaped into MCP_OAUTH_PRIVATE_KEY_PEM)
openssl ecparam -genkey -name prime256v1 -noout | openssl pkcs8 -topk8 -nocrypt
```

## Running

```bash
pnpm dev:web      # dashboard at http://localhost:3434
pnpm dev:engine   # video engine API at http://127.0.0.1:8080 (see /docs there)
```

Useful commands (all verified against `package.json` / `project.json`):

```bash
pnpm test        # all tests (web + engine + MCP, via Nx)
pnpm lint        # ESLint (web + MCP) + ruff (engine)
pnpm typecheck   # tsc --noEmit (web + MCP) + engine checks
pnpm build       # production build of the web app
pnpm graph       # Nx project graph
```

Per-app details: [apps/web/README.md](apps/web/README.md),
[apps/engine/README.md](apps/engine/README.md),
[apps/mcp/README.md](apps/mcp/README.md).

## MCP server

The MCP server ([`apps/mcp/`](apps/mcp/), npm package
[`post-engineer-mcp`](https://www.npmjs.com/package/post-engineer-mcp)) lets AI
agents create personas, generate videos, check generation status, and schedule
posts on your account. You don't need to clone this repo to use it against the
hosted platform:

```json
{
  "mcpServers": {
    "post-engineer": {
      "type": "local",
      "command": ["npx", "-y", "post-engineer-mcp"],
      "environment": {
        "POST_ENGINEER_API_KEY": "<MY_API_KEY>"
      }
    }
  }
}
```

Generate `<MY_API_KEY>` at
[post-engineer.com/api-keys](https://post-engineer.com/api-keys). To point the
server at your own self-hosted instance instead, set
`POST_ENGINEER_API_URL` (see [apps/mcp/README.md](apps/mcp/README.md) for the
full tool list, OpenCode timeout tips, and local development).

## External services you must key yourself

| Service | Required? | What for | Where to get it |
|---|---|---|---|
| Supabase | **Yes** | Postgres, auth, storage | [supabase.com](https://supabase.com) or self-hosted |
| Google OAuth app | For YouTube publishing | OAuth client id/secret | Google Cloud Console |
| Instagram (Meta) app | For Instagram publishing | OAuth client id/secret | developers.facebook.com |
| LinkedIn app | For LinkedIn publishing | OAuth client id/secret | developer.linkedin.com |
| Stripe | For token billing | Secret/publishable keys, price IDs, webhook secret | stripe.com |
| LLM provider key **or** Ollama | For script generation | OpenAI-compatible key, or run Ollama locally | Your provider / ollama.com |
| Pexels / Pixabay / Coverr / TwelveLabs | For stock footage | API keys | Respective developer portals |
| `MONEYPRINT_API_SECRET` | **Yes** | Web ↔ engine auth | Generate yourself (`openssl rand -hex 32`) |
| `TOKEN_ENCRYPTION_KEY` | **Yes** | Encrypts OAuth tokens at rest | Generate yourself (`openssl rand -base64 32`) |
| `MCP_OAUTH_PRIVATE_KEY_PEM` | For MCP server OAuth | Signs MCP tokens | Generate yourself (EC key, see above) |
| Sentry / Bugsink DSN | Optional | Error tracking | sentry.io or self-hosted Bugsink |
| Discord webhook | Optional | Fill-schedule notifications | Discord channel settings |
| `ZAI_API_KEY` | CI only | AI code-review workflow | Not a runtime dependency |

## Support & Contact

Questions, get in touch:

- **Email:** [ryan@post-engineer.com](mailto:ryan@post-engineer.com)
- **WhatsApp:** [+351 962 248 268](https://wa.me/351962248268)

## License

Licensed under the [Apache License, Version 2.0](LICENSE) — see
[CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Credits

Video engine derived from [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo)
(MIT © 2024 Harry), extended with persona lip-sync, background-music catalog,
batch queue, scheduling, and publishing.

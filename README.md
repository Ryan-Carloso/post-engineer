# Post Engineer

[![CI](https://github.com/Ryan-Carloso/post-engineer/actions/workflows/ci.yml/badge.svg)](https://github.com/Ryan-Carloso/post-engineer/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/post-engineer-mcp.svg)](https://www.npmjs.com/package/post-engineer-mcp)

[🇧🇷🇵🇹 Leia em Português](README.pt-BR.md)

Schedule and auto-publish the videos and images you make, to every network at
once.

Make the media with your own tools, upload it once, and Post Engineer
publishes it to your social accounts now or at the time you pick, retries a
failed account, and measures how each post performs. Personas group the
publishing accounts of one brand or character. Manage everything from the web
dashboard, drive it programmatically through the API, or let your AI agent run
it through the MCP server — all from this one monorepo. Post Engineer does not
generate media.

Post Engineer is open source under the [Apache License, Version 2.0](LICENSE).
Self-host the whole platform on your own VPS following
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md), or use the hosted version: it is
in a free closed beta, with access granted through Discord.

> Prefer the hosted version? The same platform runs at
> [post-engineer.com](https://post-engineer.com) — you can skip the local
> setup and connect the MCP server straight to your account (see
> [MCP server](#mcp-server)).

## What it does

- **Personas** — group the publishing accounts of one brand or character, with
  an optional identity card that renders image prompts for your own image tool.
- **Scheduling & publishing** — queue posts for YouTube, Instagram, LinkedIn,
  Bluesky, Threads, Facebook, Pinterest, 3Speak, Rumble, Fanvue, and Telegram
  (channels and groups); track
  upcoming and past posts with per-account status.
- **Metrics and experiments** — per-post views and engagement, YouTube
  retention, and prompt comparisons per account.
- **Dashboard** — personas, posts calendar and history, connected social
  accounts, metrics and API keys in one Next.js app.
- **Agent control** — an MCP server ([`apps/mcp/`](apps/mcp/)) exposes the same
  capabilities to AI agents (Claude, Cursor, Codex, OpenCode): upload and
  publish media, schedule posts, manage personas and read metrics.

## Repository layout

This is a pnpm/Nx monorepo — the web app and the MCP server live together:

```text
apps/web/       Next.js 15 dashboard, API routes and the publish scheduler (TypeScript)
apps/mcp/       MCP server for AI agents (npm package: post-engineer-mcp)
```

The web app owns authentication, personas, scheduling, uploads, OAuth, the
beta access gate, the API and publishing: an in-process scheduler claims each due
slot in Postgres and publishes it through the same upload core the API uses.
The MCP server talks to the web API with a user API key. Postgres (via
Supabase) is the system of record: personas, schedules, uploads, OAuth tokens
(encrypted at rest) and API keys.

## Prerequisites

- **Node.js** 20+ and **pnpm** 10 (`npm install -g pnpm` or via corepack)
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
   library script lives in this repo: [`supabase/migrations/002_persona-images.sql`](supabase/migrations/002_persona-images.sql)
   (manual-apply by design).

   > **Need help?** If you are setting up a fresh project and need the current
   > schema snapshot, reach out:
   > **Email:** [madebyryandev@gmail.com](mailto:madebyryandev@gmail.com) ·
   > **WhatsApp:** [+351 962 248 268](https://wa.me/351962248268)

### 3. Create the env file (never commit it)

There is exactly one env file by design — copy it from its example and fill in
your own values:

```bash
cp apps/web/.env.example apps/web/.env
```

| File | Purpose | Key variables |
|---|---|---|
| `apps/web/.env` | Web app, API routes and scheduler | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only), `R2_ACCOUNT_ID` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` (Instagram/Threads/Facebook fetch the video from a presigned R2 URL), `TOKEN_ENCRYPTION_KEY` (generate: `openssl rand -base64 32`), OAuth client ids/secrets + redirect URIs, Stripe keys, `MCP_OAUTH_PRIVATE_KEY_PEM`, optional `DISCORD_WEBHOOK_URL`, optional `RESEND_API_KEY` + `ACCOUNT_BREAK_FROM` (owner failure email), optional `POSTHOG_API_KEY` |

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
- **Threads** — ([Threads API](https://developers.facebook.com/docs/threads)).
  The "Access the Threads API" use case of the Meta app has its own App ID and
  App Secret (`THREADS_CLIENT_ID` / `THREADS_CLIENT_SECRET`), different from
  Instagram's. Add the Threads product (`threads_basic`,
  `threads_content_publish`, `threads_manage_insights` and
  `threads_manage_replies` permissions) and
  register `THREADS_REDIRECT_URI`.
- **Facebook Pages** — [Meta for Developers](https://developers.facebook.com):
  add Facebook Login for Business with the `pages_show_list`,
  `pages_read_engagement`, `pages_manage_posts` and
  `pages_manage_engagement` permissions, set
  `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` and register
  `FACEBOOK_REDIRECT_URI`. Connecting once adds every Page the user manages.
- **Fanvue** — [Fanvue Developer Area](https://www.fanvue.com/dev): create an
  **API only** app from a creator account, add the redirect URIs from
  `FANVUE_REDIRECT_URI` / `FANVUE_REDIRECT_URI_LOCAL`, and select the scopes
  `read:self`, `read:post`, `write:post`, `read:media` and `write:media` (the
  system scopes `openid`, `offline_access` and `offline` are added
  automatically). Set `FANVUE_CLIENT_ID` / `FANVUE_CLIENT_SECRET`. There is no
  API key: the creator authorizes the app over OAuth 2.0 + PKCE. Every post is
  subscribers-only.
- **Bluesky** uses an app password entered in the dashboard (encrypted at
  rest) — no OAuth app registration needed.
- **3Speak** uses a Hive posting key entered in the dashboard (encrypted at
  rest) — no OAuth app registration needed. The posting key only authorizes
  posts; never paste an owner, active, or master password.
- **Rumble** uses a manually issued 40-character Simple Upload API access
  token (request it by emailing bd@rumble.com), entered in the dashboard
  with the channel ID — no OAuth, no app registration, no env vars.
- **Telegram** publishes through the user's own bot: create it with
  @BotFather, add it to a channel (as an administrator who can post) or a
  group (as a member allowed to send), then paste the bot token and the chat
  ID or @username in the dashboard (encrypted at rest). The connect checks the
  bot's permission in that chat. No OAuth, no env vars. The cloud Bot API
  caps uploads at 50 MB and captions at 1,024 characters.

### 5. Generate the self-managed secrets

These are yours to create — nothing to register:

```bash
# OAuth token encryption key (AES-256-GCM)
openssl rand -base64 32

# MCP OAuth signing key (PEM, \n-escaped into MCP_OAUTH_PRIVATE_KEY_PEM)
openssl ecparam -genkey -name prime256v1 -noout | openssl pkcs8 -topk8 -nocrypt
```

## Running

```bash
pnpm dev:web      # dashboard at http://localhost:3434
```

Useful commands (all verified against `package.json` / `project.json`):

```bash
pnpm test        # all tests (web + MCP, via Nx)
pnpm lint        # ESLint (web + MCP)
pnpm typecheck   # tsc --noEmit (web + MCP)
pnpm build       # production build of the web app
pnpm graph       # Nx project graph
```

Per-app details: [apps/web/README.md](apps/web/README.md),
[apps/mcp/README.md](apps/mcp/README.md).

## MCP server

The MCP server ([`apps/mcp/`](apps/mcp/), npm package
[`post-engineer-mcp`](https://www.npmjs.com/package/post-engineer-mcp)) lets AI
agents upload and publish media, schedule posts, manage personas and read
metrics on your account. You don't need to clone this repo to use it against the
hosted platform:

```json
{
  "mcpServers": {
    "post-engineer": {
      "type": "local",
      "command": ["npx", "-y", "post-engineer-mcp@latest"],
      "environment": {
        "POST_ENGINEER_API_KEY": "<MY_API_KEY>"
      }
    }
  }
}
```

Generate `<MY_API_KEY>` at
[post-engineer.com/recipes](https://post-engineer.com/recipes). The
`@latest` tag matters: `npx` reuses its cached copy without checking for
updates. To point the
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
| `TOKEN_ENCRYPTION_KEY` | **Yes** | Encrypts OAuth tokens at rest | Generate yourself (`openssl rand -base64 32`) |
| `MCP_OAUTH_PRIVATE_KEY_PEM` | For MCP server OAuth | Signs MCP tokens | Generate yourself (EC key, see above) |
| PostHog | Optional | Error tracking + product analytics | `NEXT_PUBLIC_POSTHOG_KEY` (browser), `POSTHOG_API_KEY` (server), `NEXT_PUBLIC_POSTHOG_HOST` — see `apps/web/.env.example` |
| Discord webhook | Optional | Publish scheduler notifications | Discord channel settings |
| `ZAI_API_KEY` | CI only | AI code-review workflow | Not a runtime dependency |

## Support & Contact

Questions, get in touch:

- **Email:** [madebyryandev@gmail.com](mailto:madebyryandev@gmail.com)
- **WhatsApp:** [+351 962 248 268](https://wa.me/351962248268)

## License

Licensed under the [Apache License, Version 2.0](LICENSE) — see
[CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

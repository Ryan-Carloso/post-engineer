# Post Engineer MCP Server

Public MCP (Model Context Protocol) server for [Post Engineer](https://post-engineer.com/). It lets AI agents (Claude, Cursor, Codex, and OpenCode) create personas, generate videos, check generation status, and schedule posts directly on your Post Engineer account.

Post Engineer is open source under the Apache License, Version 2.0 (see
[LICENSE](../../LICENSE) in the repo root). You can self-host the whole
platform on your own VPS (see
[docs/SELF_HOSTING.md](../../docs/SELF_HOSTING.md)) instead of using the
hosted platform — lip sync (LongCat) runs on Modal.com, whose Starter plan
includes $30/month in compute credits (see
[modal.com/pricing](https://modal.com/pricing)). We are not Modal: this
free-credit offer is theirs and can end at any time; usage beyond the
credits is billed by Modal.

## What is https://post-engineer.com/?

[https://post-engineer.com/](https://post-engineer.com/) is the Post Engineer web platform. You use it to:

- Create an account and log in.
- Create AI personas (avatar, voice, language, niche).
- Generate videos with those personas.
- Connect YouTube / Instagram / LinkedIn / Threads / Facebook Pages / 3Speak accounts.
- Connect YouTube / Instagram / LinkedIn / Threads / Facebook Pages / Bluesky / Rumble accounts.
- Schedule automated posting.
- Generate and manage API keys at [https://post-engineer.com/recipes](https://post-engineer.com/recipes).

## Requirements

- Node.js 20.10+
- API key generated at https://post-engineer.com/recipes

## Remote (HTTP) surface

With `--http-transport` the same server speaks Streamable HTTP, but it
never reads files from the host it runs on: `media (action: upload)`,
`persona_media (action: add_image)` and `publish_video (action: from_file)` are not registered, and
`personas (action: create)`, `personas (action: update)` and `voices (action: create_clone)` accept only
public URLs (`avatarUrl` / `audioUrl`) — no `avatarPath`, `audioPath` or
library image files. Local paths stay available on the default stdio
server, where the disk is the agent's own machine. Signed upload
replaces them on the remote surface: `publish_video (action: create_upload)` mints a
short-lived signed URL, the caller PUTs the video bytes to it directly,
`publish_video (action: complete_upload)` verifies the stored bytes, and
`publish_video (action: publish_upload)` publishes by id (single-use).

### Hosted endpoint and ChatGPT

The hosted remote endpoint is `https://post-engineer.com/mcp`
(Streamable HTTP, OAuth Bearer with the `mcp:tools` scope; discovery at
`https://post-engineer.com/.well-known/oauth-protected-resource`). Point
a remote MCP client — including ChatGPT, which requires a public HTTPS
endpoint, OAuth, and tool annotations — at that URL and sign in; no
local install or API key is needed. Every tool carries MCP annotations
(`readOnlyHint` for `video_tasks`/`posts`/`insights`/`billing`/`prompts`/
`check_script`, `destructiveHint` for `personas`/`persona_media`/`voices`/
`accounts`/`schedules`/`publish_video`/`cancel_video`, `openWorldHint`
throughout) so annotation-aware clients can auto-approve reads and confirm
writes. Annotations are per tool, so a tool with a destructive action is
destructive for all its actions. The stdio package above
remains fully supported for local agents.

### Deployment (remote HTTP service)

The repo ships the deploy unit but does not deploy it:
`apps/mcp/docker-compose.yml` (service `mcp`, container
`post-engineer-mcp`) publishes only `127.0.0.1:8081` on the host behind
the Caddy edge proxy, requires `MCP_OAUTH_ISSUER` and `MCP_RESOURCE`
at startup (compose refuses to start without them, and the server
refuses a non-loopback bind without OAuth), and health-checks
`GET /health`. `apps/mcp/Dockerfile` builds the image from the
monorepo root. The public route is `https://post-engineer.com/mcp`;
see the Caddy example in
[docs/SELF_HOSTING.md](../../docs/SELF_HOSTING.md). Run it with
`MCP_OAUTH_ISSUER=<issuer> MCP_RESOURCE=https://post-engineer.com/mcp docker compose up -d --build`
from `apps/mcp/`.

### Telemetry

Each request to the post-engineer API includes the calling tool's name and
the server version, recorded against your account for product analytics.
No script content, media or credentials are sent. The server itself never
contacts any analytics service.

To measure whether agents use the recipes, the requests of the recipe-aware
tools (`prompts (action: list)`, `prompts (action: get)`, `personas (action: create)`, `personas (action: list)`,
`accounts (action: list)`, `billing (action: balance)`, `check_script (action: validate)`,
`generate_video`) also carry:

| Header | Value |
| --- | --- |
| `X-MCP-Session-Id` | Random id of this server instance (one stdio connection; one request over HTTP, which is stateless) |
| `X-MCP-Transport` | `stdio` or `http` |
| `X-MCP-Nudged-By` | The last tool whose result showed the recipe nudge, or `none` |
| `X-MCP-Recipes-Known` | `true` once the agent listed or fetched a recipe |
| `X-MCP-Recipe-Fetched` | The last recipe slug `prompts (action: get)` returned, or `none` |
| `X-MCP-Script-Rejections` | Scripts the local validator rejected so far in the session |
| `X-MCP-Recipe` | The recipe slug of this call (`prompts (action: get)`'s slug, `generate_video`'s `recipe`) |

The web API records them as `mcp_tool_called` properties; a slug that is not
a hub slug is recorded as `unknown`.

## Use

Configure your agent (`opencode.json`, `claude_desktop_config.json`, `.mcp.json`, or Cursor settings):

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

Replace `<MY_API_KEY>` with the key you generated on https://post-engineer.com/recipes. No repository clone or local build is required.

> The `@latest` tag matters: `npx` caches the package on first run and reuses the cached copy on later runs without checking for updates. Without `@latest` you can stay stuck on an old version (e.g. pre-1.12.0 tools that no longer exist server-side) with no error telling you why.

> **The server accepts exactly one MCP version.** Every release of this package ships together with the server that expects it, and any other version gets HTTP 426 `MCP_VERSION_MISMATCH` on every call, with the exact version to install (for example `npx -y post-engineer-mcp@1.52.560`). A long-running agent keeps the version it started with, so restart the MCP when you see that error; with `@latest` the restart picks up the right version. Versions are `MAJOR.MINOR.PR`: the patch number is the pull request that last changed this package.

### OpenCode

OpenCode uses `mcp` instead of `mcpServers`. Its local MCP tool-discovery timeout defaults to 5 seconds, which can be too short while `npx` downloads the package on the first launch. Set a longer timeout:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "post-engineer": {
      "type": "local",
      "command": ["npx", "-y", "post-engineer-mcp@latest"],
      "environment": {
        "POST_ENGINEER_API_KEY": "<MY_API_KEY>"
      },
      "timeout": 30000,
      "enabled": true
    }
  }
}
```

If the server was already configured, add only `"timeout": 30000` to its existing entry and restart OpenCode.

## Local development

```bash
pnpm install
pnpm build
pnpm start
```

Set your API key locally (defaults to the production API; override with `POST_ENGINEER_API_URL` for staging/self-hosted):

```bash
export POST_ENGINEER_API_KEY="<MY_API_KEY>"
# optional: export POST_ENGINEER_API_URL=https://staging.example.com
```

The `Authorization: Bearer` API key header is sent to the configured base URL, so only point `POST_ENGINEER_API_URL` at a server you trust.

### Measuring the `tools/list` payload

Every session loads all tool schemas into the agent's context. To see how big that is (tool count, bytes, estimated tokens, the largest tools), build and run the measurement script. It needs no API key and makes no network call:

```bash
pnpm build
node scripts/measure-tools-list.mjs                      # stdio tool set
node scripts/measure-tools-list.mjs --transport http     # remote tool set
node scripts/measure-tools-list.mjs --top 15 --json
```

Run it before and after a change to tool schemas and put both outputs in the PR.

## Tools

The server offers **16 intent tools**, not one tool per API endpoint. A tool is a complete abstraction of an intent: it takes what you would say ("the persona Maria", "my YouTube channel"), resolves the ids inside the call, and returns only what the agent needs for the next step. Most tools take an `action`; the schema is one flat object (a required `action` plus the fields of every action), and each tool's description lists the required fields per action. A field of another action, or a missing required field, is rejected before any request is sent, naming the tool, the action and the field.

| Tool | Actions | What it is for |
|---|---|---|
| `generate_video` | — | Generate and schedule one video, or a batch of 2-12 (every 6 face videos, the cheapest is free). `persona` and `accounts` by name or id; the result echoes what was resolved. |
| `video_tasks` | `status`, `list_generations`, `get_generation` | Follow videos: `status` takes up to 12 `taskIds`; `waitSeconds` 0 is a snapshot, more blocks until they finish. |
| `cancel_video` | — | Cancel a video that is still generating. Separate so a client can allow status without cancel. |
| `personas` | `list`, `get`, `create`, `update`, `delete` | Personas. `delete` previews first and needs the `confirmToken` of that preview to delete. |
| `persona_media` | `list_faces`, `list_images`, `add_image`, `update_image`, `remove_image` | Stock faces and a persona's image library. |
| `voices` | `list`, `preview`, `list_clones`, `create_clone`, `get_clone`, `preview_clone`, `delete_clone` | House voices and voice clones. |
| `accounts` | `list`, `connect`, `disconnect`, `get_persona_publishing`, `set_persona_publishing`, `list_boards` | Social accounts and the accounts each persona publishes to. |
| `schedules` | `list`, `cancel`, `get_slot`, `update_slot_title`, `delete_slot` | Future slots. |
| `posts` | `list`, `get` | Published and scheduled posts. |
| `insights` | `post_metrics`, `retention_curve` | How posts performed. |
| `experiments` | `create`, `list`, `add_pair`, `results` | Paired A/B hook experiments. |
| `media` | `upload`, `check` | Images for video segments. |
| `billing` | `balance`, `transactions` | Prepaid tokens. |
| `prompts` | `list`, `get` | The recipe prompts. |
| `check_script` | `validate`, `score` | Check a script before spending tokens. |
| `publish_video` | `from_file`, `create_upload`, `complete_upload`, `publish_upload` | Publish a ready-made video directly. |

Actions that read a file from the disk (`persona_media` `add_image`, `media` `upload`, `publish_video` `from_file`, and a local `audioPath`/`avatarPath`) exist only on the stdio server: a path served over HTTP would resolve on the server's host. Over HTTP use public URLs, or the signed upload of `publish_video`.

### Names instead of ids

`persona` and `accounts` accept a display name or an id. An id wins; otherwise the name must match **exactly** (case-insensitive, trimmed; never a prefix). No match is an error that says how to list the candidates. Several matches is **not** an error and not a guess: the result lists the candidates and says nothing was done, so you call again with the id. In `generate_video` every reference of every video is resolved before the first video is created, and `accounts` omitted means the persona's bound publishing accounts.

```json
{ "videos": [ { "persona": "Maria", "accounts": ["Maria Cooks"], "title": "...", "description": "...", "segments": [ ... ], "mode": "asap", "options": { "videoType": "full_lipsync" } } ] }
```

`mode: "scheduled"` (the default) slots a video 3h-30d ahead (`startAt` and `times`); `mode: "asap"` publishes it when generation finishes.

Batch (2-12 videos) needs a `batchKey` and rejects `idempotencyKey`; one video takes an `idempotencyKey` and rejects `batchKey`. A batch is created video by video: if one fails, the earlier videos stay created; call again with the same `batchKey` and the same videos and the created ones replay without a new charge.

### Measuring the size of `tools/list`

See "Measuring the `tools/list` payload" above. The 16 tools weigh about 59 KB on the stdio server (the 56 tools they replace weighed about 102 KB).

### Breaking change: the 56 old tool names are gone

There is no alias for the old names. Saved prompts, recipes and agent configuration that call them must be updated:

| Old tool | Now |
|---|---|
| `generate_persona_video`, `generate_persona_video_batch` | `generate_video` (`videos` has 1-12 entries) |
| `get_video_status`, `get_video_task_progress`, `wait_for_video_tasks` | `video_tasks` `status` (`taskIds`, `waitSeconds`) |
| `list_video_generations`, `get_video_generation` | `video_tasks` `list_generations`, `get_generation` |
| `cancel_video_task` | `cancel_video` |
| `list_personas`, `create_persona`, `update_persona` | `personas` `list`, `create`, `update` |
| `get_persona_delete_preview`, `delete_persona` | `personas` `delete` (no token = preview, then the token deletes) |
| `list_faces`, `list_persona_images`, `add_persona_image`, `update_persona_image`, `remove_persona_image` | `persona_media` `list_faces`, `list_images`, `add_image`, `update_image`, `remove_image` |
| `list_voices`, `preview_house_voice` | `voices` `list`, `preview` |
| `list_cloned_voices`, `create_cloned_voice`, `get_cloned_voice`, `preview_cloned_voice`, `delete_cloned_voice` | `voices` `list_clones`, `create_clone`, `get_clone`, `preview_clone`, `delete_clone` |
| `list_social_accounts`, `connect_account`, `disconnect_account` | `accounts` `list`, `connect`, `disconnect` |
| `get_persona_publishing_accounts`, `set_persona_publishing_accounts`, `list_pinterest_boards` | `accounts` `get_persona_publishing`, `set_persona_publishing`, `list_boards` |
| `list_schedules`, `cancel_schedule`, `get_slot`, `update_slot_title`, `delete_slot` | `schedules` `list`, `cancel`, `get_slot`, `update_slot_title`, `delete_slot` |
| `list_posts`, `get_post` | `posts` `list`, `get` |
| `get_post_metrics`, `get_youtube_retention_curve` | `insights` `post_metrics`, `retention_curve` |
| `create_experiment`, `list_experiments`, `add_experiment_pair`, `get_experiment_results` | `experiments` `create`, `list`, `add_pair`, `results` |
| `upload_media`, `check_media` | `media` `upload`, `check` |
| `get_token_balance`, `list_token_transactions` | `billing` `balance`, `transactions` |
| `list_prompts`, `get_prompt` | `prompts` `list`, `get` |
| `validate_script`, `score_draft` | `check_script` `validate`, `score` |
| `publish_video_direct`, `create_video_upload`, `complete_video_upload`, `publish_uploaded_video` | `publish_video` `from_file`, `create_upload`, `complete_upload`, `publish_upload` |

## Prompts (slash commands)

The server serves the prompts hub from the Post Engineer web platform over
the MCP [prompts capability](https://modelcontextprotocol.io/docs/concepts/prompts),
so MCP clients (Cursor, Claude) list them as slash commands. Each prompt is
zero-arg: the agent asks you for the persona, accounts, and timing when you
run it. The list and the text are fetched from the web API on demand
(`GET /api/prompts`, `GET /api/prompts/{slug}`), so a recipe edit on the
web reaches every install without a package update.

- `/daily-news`: Daily news becomes a video — turn one top GNews story of the day into one persona video, validated before any token is spent.
- `/place-spotlight`: Place spotlight becomes a video — turn one real place into one persona video with the place's own photos checked and attached as segment media, validated before any token is spent.
- `/subject-spotlight`: Subject spotlight becomes a video — turn one concrete subject (a car, a product, a gadget) into one persona video with its own photos and its real price on screen, validated before any token is spent.
- `/github-prs`: GitHub PRs become videos — turn a GitHub pull request into one persona video.
- `/last-30-days`: Last 30 days become a video — turn what happened in your niche in the last 30 days into one persona video, validated before any token is spent.
- `/multi-rede`: One week, one video per network — publish one video per network this week: LinkedIn, YouTube, Instagram, Bluesky, each scored for its own network.
- `/viral-shorts`: A viral video becomes your Short — learn from the most-viewed video in your niche and write a fresh Shorts script in your own voice, hook, content, CTA.
- `/full-setup`: Full setup becomes videos — connect accounts, create a persona, validate the script, and publish your first video without skipping a step.

An agent that arrives without a human typing a slash command can still self-serve
the same hub through MCP **tools**: `prompts (action: list)` lists the recipes
(slug/title/description) and `prompts (action: get)` returns one recipe's full text by
`slug`. The server's initialize instructions point agents there for
topic-shaped requests. Until the agent lists or fetches a recipe, the results
of `personas (action: create)`, `personas (action: list)`, `accounts (action: list)`, and
`billing (action: balance)` end with a short next-step block pointing at
`prompts (action: list)`, and a script rejected by `check_script (action: validate)` or
`generate_video` gets a hint that recipes produce scripts that pass.

To add a prompt, add its text to `shared/prompt-base/prompt-base.ts` and its
entry to the web hub (`apps/web/app/recipes/prompts.ts` + its i18n title and
objective). The MCP needs no change: it serves whatever the web hub lists.

## Links

- Platform: https://post-engineer.com/
- API keys: https://post-engineer.com/recipes
- Recipes: [docs/recipes/daily-news.md](../../docs/recipes/daily-news.md) (daily news becomes a video), [docs/recipes/place-spotlight.md](../../docs/recipes/place-spotlight.md) (place spotlight becomes a video), [docs/recipes/subject-spotlight.md](../../docs/recipes/subject-spotlight.md) (subject spotlight becomes a video), [docs/recipes/last-30-days.md](../../docs/recipes/last-30-days.md) (last 30 days become a video), [docs/recipes/multi-rede.md](../../docs/recipes/multi-rede.md) (one week, one video per network) and [docs/recipes/viral-shorts.md](../../docs/recipes/viral-shorts.md) (a viral video becomes your Short)

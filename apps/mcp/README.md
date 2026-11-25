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
- Connect YouTube / Instagram / LinkedIn / Threads / Facebook Pages / Bluesky / 3Speak / Rumble / Fanvue / Pinterest / Telegram accounts.
- Schedule automated posting.
- Generate and manage API keys at [https://post-engineer.com/recipes](https://post-engineer.com/recipes).

## Requirements

- Node.js 20.10+
- API key generated at https://post-engineer.com/recipes

## Remote (HTTP) surface

With `--http-transport` the same server speaks Streamable HTTP, but it
never reads files from the host it runs on: `publish_video (action: from_file)` is not registered,
`media (action: upload)` and `persona_media (action: add_image)` take a public `imageUrl`, and
`personas (action: create)`, `personas (action: update)` and `voices (action: create_clone)` accept only
public URLs (`avatarUrl` / `audioUrl`) — no `avatarPath`, `audioPath` or
library image files. The server downloads a remote `audioUrl` itself, so it
fetches only `https`, only from a host whose every DNS answer is a public
address (loopback, private and link-local are refused before connecting),
pinned to those addresses for the connection, with no redirects and a
timeout. Local paths stay available on the default stdio
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
(`readOnlyHint` for `video_tasks`/`posts`/`insights`/`billing`/
`check_script`, `destructiveHint` for `personas`/`persona_media`/`voices`/
`accounts`/`schedules`/`prompts`/`publish_video`/`cancel_video`, `openWorldHint`
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
A tool call can make several requests (a `video_tasks (action: status)` wait
checks status every 60 seconds), so each request also carries the call id
(`X-MCP-Call-Id`) and its ordinal in the call (`X-MCP-Call-Request`, from 1).
The web API records one `mcp_tool_called` per call, from the first request,
and records a later request only when it fails, as `mcp_tool_request_failed`
with its `call_request` ordinal.
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

The server offers **17 intent tools**, not one tool per API endpoint. A tool is a complete abstraction of an intent: it takes what you would say ("the persona Maria", "my YouTube channel"), resolves the ids inside the call, and returns only what the agent needs for the next step. Most tools take an `action`; the schema is one flat object (a required `action` plus the fields of every action), and each tool's description lists the required fields per action. A field of another action, or a missing required field, is rejected before any request is sent, naming the tool, the action and the field.

| Tool | Actions | What it is for |
|---|---|---|
| `generate_video` | — | Generate and schedule one video, or a batch of 2-12 (every 6 face videos, the cheapest is free). `persona` and `accounts` by name or id; the result echoes what was resolved. `options.hookTitle` adds an on-screen headline (at most 7 words and 60 characters) over the first 3 seconds; captions move below it while it shows. |
| `video_tasks` | `status`, `list_generations`, `get_generation` | Follow videos: for the final outcome, `status` sets `waitSeconds` above 0 and blocks (up to 12 `taskIds`). `waitSeconds` 0 is only a progress snapshot: wait at least `nextPollInSeconds`. Each task can be polled at most once a minute (the API answers a faster poll with 429 and `Retry-After`); `status` waits out the `Retry-After` instead of failing. |
| `cancel_video` | — | Cancel a video that is still generating. Separate so a client can allow status without cancel. |
| `personas` | `list`, `get`, `create`, `update`, `delete` | Personas. `delete` previews first and needs the `confirmToken` of that preview to delete. |
| `persona_media` | `list_faces`, `list_images`, `add_image`, `update_image`, `remove_image`, `get_card`, `render_prompt` | Stock faces, a persona's image library, and the identity card prompts (see "Identity card"). |
| `voices` | `list`, `preview`, `list_clones`, `create_clone`, `get_clone`, `preview_clone`, `delete_clone` | House voices and voice clones. |
| `accounts` | `list`, `connect`, `disconnect`, `get_persona_publishing`, `set_persona_publishing`, `list_boards` | Social accounts and the accounts each persona publishes to. |
| `tool_config` | `get`, `save` | The saved research/stock tool configuration: which search tool (Tavily/Exa/own) and stock sources (Pexels/Pixabay/Coverr) the account has keys for. `save` replaces the whole set; keys are stored encrypted and are never returned in full — `get` shows presence and last 4 characters only. |
| `schedules` | `list`, `cancel`, `get_slot`, `update_slot_title`, `delete_slot` | Future slots. |
| `posts` | `list`, `get` | Published and scheduled posts. |
| `insights` | `post_metrics`, `last_day`, `retention_curve`, `share_link_create`, `share_link_list`, `share_link_revoke` | How posts performed, and a public read-only link to the metrics summary and this week's posts. |
| `experiments` | `results`, `create` | Compares your prompts inside each publishing account: every video generated with a `promptVersionId` records its prompt version. `results` reads the comparison: at least 10 videos each (5 only lift a prompt out of insufficient); the clear/indicative thresholds are corrected for the number of prompts compared. `create` runs the comparison: 2-4 prompt versions, each with its own videos (one script per video, 5-15 each, 40 in total), rotated over the posting times of one account. Call it without `quoteKey` for a quote (nothing is charged), then again with the `quoteKey` and `expiresAt` of that quote to charge the total once, schedule every video and start them; it returns the `scheduleId` (cancel with `schedules` `cancel`). A retry with the same `quoteKey` replays and never charges twice; a changed price or script answers `QUOTE_CHANGED`, an expired quote `QUOTE_EXPIRED`. Segment media must be public URLs. |
| `media` | `upload`, `check` | Images for video segments. |
| `billing` | `balance`, `transactions` | Prepaid tokens. |
| `prompts` | `list`, `get`, `create`, `update`, `delete`, `versions`, `restore` | Read and write prompts. `list` (optional `query` words and `source` own or community) and `get` return the account's own prompts (private ones included) and other users' public ones; unverified community prompts carry a notice, verified ones do not. `create`, `update`, `delete` and `restore` write the account's own prompts, private by default; only the owner can change one. `versions` only reads the account's own history: it lists a prompt's saved texts newest first (a short preview each, plus `currentVersion`; pass `version` to read one in full) and is owner-only. `restore` makes an old version the current text by writing it as a new version (pass the `currentVersion` as `expectedCurrentVersion`; the title stays, and experiment results count the new version separately). `visibility` `public` makes a prompt readable by anyone (no review while the product is in beta), `private` keeps it to the account. |
| `check_script` | `validate`, `score` | Check a script before spending tokens. `validate` also checks an optional `hookTitle` with the same stable `HOOK_TITLE_*` codes `generate_video` returns. |
| `publish_video` | `from_file`, `create_upload`, `complete_upload`, `publish_upload`, `publish_existing` | Publish media that already exists, with no generation and no charge. `publish_existing` takes a finished video (`taskId`), a completed upload (`uploadId`) or a local image (`imagePath`, stdio only; over HTTP an image goes through `create_upload` like a video, never as base64), sends it to every network of its `accounts` (names or ids, or the persona's bound accounts) in one call, and needs `mode`: `asap`, or `scheduled` once at `publishAt`. A retry with the same `idempotencyKey` replays the original result in both modes. Images (JPEG/PNG, 8 MB) post to Instagram, Bluesky (1 MB), LinkedIn, Threads, Facebook, Pinterest and Telegram; on YouTube an image becomes an 8-second vertical Short with background music (see [YouTube image posts](../../docs/youtube-image-posts.md)). |

Actions that read a file from the disk (`publish_video` `from_file`, and a local `audioPath`/`avatarPath`/`path`) exist only on the stdio server: a path served over HTTP would resolve on the server's host. Over HTTP `persona_media` `add_image` and `media` `upload` take a public https `imageUrl` instead (JPG, PNG or WebP; the server resolves the host, refuses a non-public address, never follows a redirect and checks the real image bytes), and a video goes through the signed upload of `publish_video`.

### Names instead of ids

`persona` and `accounts` accept a display name or an id. An id wins; otherwise the name must match **exactly** (case-insensitive, trimmed; never a prefix). No match is an error that says how to list the candidates. Several matches is **not** an error and not a guess: the result lists the candidates and says nothing was done, so you call again with the id. In `generate_video` every reference of every video is resolved before the first video is created, and `accounts` omitted means the persona's bound publishing accounts.

```json
{ "videos": [ { "persona": "Maria", "accounts": ["Maria Cooks"], "title": "...", "description": "...", "segments": [ ... ], "mode": "asap", "options": { "videoType": "full_lipsync", "lipsyncPhotos": [ { "mediaId": "..." }, { "url": "https://..." } ] } } ] }
```

`full_lipsync` requires `options.lipsyncPhotos`: 2-5 different face photos of the persona (same person, other outfits, places or angles). The narration is cut into windows of at most 12s and each window shows the next photo, so send one photo per 12s of narration (2 for 24s, 4 for 48s, 5 for 60s).

`mode: "scheduled"` (the default) slots a video 3h-30d ahead (`startAt` and `times`); `mode: "asap"` publishes it when generation finishes.

Batch (2-12 videos) needs a `batchKey` and rejects `idempotencyKey`; one video takes an `idempotencyKey` and rejects `batchKey`. A batch is created video by video: if one fails, the earlier videos stay created; call again with the same `batchKey` and the same videos and the created ones replay without a new charge. A key whose schedule was deleted while one of its videos was already delivered is spent: reusing it answers 409 `IDEMPOTENCY_KEY_CONSUMED` and generates nothing, so send a new key. A key whose video was cancelled and fully refunded can be reused and is charged again.

### Identity card

A persona can hold one **identity card**: the face and body traits that never change, plus a default outfit. Store it once, then render a deterministic image prompt for any scene, so your image tool stops inventing the traits the prompt leaves open.

1. `personas` `update` with `identityCard` (`null` removes it). The card is `{ "version": 1, "identity": { "face": { ... }, "body": { ... } }, "defaults": { "outfit": { ... } } }`. Every level is strict: an unknown key is a 400. Every trait is one line of at most 80 characters, at least one trait is required, and the whole card is at most 4096 bytes. `personas` `create` takes the same field.
2. `persona_media` `render_prompt` with a `scene` (`outfit`, `pose`, `setting`, `lighting`, `framing`, `aspect`). It returns `{ prompt, suggestedDescription, cardVersion }`. The scene holds only what changes per photo: an `identity`, `face`, `body` or `version` key is rejected, and so are words about the person (hair, eyes, skin, build, height, beard, tattoo, ...) in `pose`, `setting` and the outfit slots. A scene outfit replaces the card's default outfit completely. `persona_media` `get_card` reads the stored card.
3. Make the image with **your own** image tool, using the persona's base photo as the reference and the returned `prompt` as the instruction. Always edit from the original base photo, never from a previous edit.
4. `persona_media` `add_image` with `description` set to the returned `suggestedDescription`. It is built from the outfit, setting, lighting and framing only, so the per-video image selection keeps matching on the scene.
5. Use the new photos in `generate_video` `options.lipsyncPhotos` for `full_lipsync` (2-5 photos of the same person).

**This is advice, not enforcement.** The server stores the card and renders text. It generates no image, charges no tokens and calls no image model, so nothing stops your image tool from ignoring the prompt, and the word list on the scene is best effort: a paraphrase gets through. The prompt text lives in one place, `apps/web/lib/persona-identity-prompt.ts`; read it there instead of copying it.

Content rules:

- The card describes a real person's physical traits. Fill it only with that person's consent. It is read only through `get_card`: it is never in `personas` `list` and never on a share page, and it is kept out of logs, telemetry and error messages.
- Outfit slots (`top`, `bottom`, `one_piece`, `outerwear`, `footwear`, `accessories`) take clothing only. `one_piece` cannot be combined with `top` or `bottom`.
- Nudity and sexualised or see-through clothing are not allowed in an outfit, and the server rejects the obvious words. It cannot police what your image tool makes from a prompt that passes: that is your responsibility, and more so when the face may belong to a real person.

### Measuring the size of `tools/list`

See "Measuring the `tools/list` payload" above. The 17 tools weigh about 60 KB on the stdio server (the 56 tools they replace weighed about 102 KB).

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
| `get_experiment_results` | `experiments` `results` |
| `upload_media`, `check_media` | `media` `upload`, `check` |
| `get_token_balance`, `list_token_transactions` | `billing` `balance`, `transactions` |
| `list_prompts`, `get_prompt` | `prompts` `list`, `get` |
| `prompt_library` (every action) | `prompts` (same action names: `create`, `update`, `delete`, `versions`, `restore`) |
| `validate_script`, `score_draft` | `check_script` `validate`, `score` |
| `publish_video_direct`, `create_video_upload`, `complete_video_upload`, `publish_uploaded_video` | `publish_video` `from_file`, `create_upload`, `complete_upload`, `publish_upload` |

## Prompts (slash commands)

The server serves the prompts stored on the Post Engineer web platform over
the MCP [prompts capability](https://modelcontextprotocol.io/docs/concepts/prompts),
so MCP clients (Cursor, Claude) list them as slash commands: the account's own
prompts and every public prompt. Each prompt is zero-arg: the agent asks you for
the persona, accounts, and timing when you run it. The list and the text are
fetched from the web API on demand (`GET /api/prompts`, `GET /api/prompts/{slug}`),
so a prompt edit reaches every install without a package update. Prompts live
only in the database (`user_prompts`); there is no prompt text in git.

An agent that arrives without a human typing a slash command can still self-serve
the same prompts through MCP **tools**: `prompts (action: list)` lists them
(slug/title/description) and `prompts (action: get)` returns one prompt's full text by
`slug`. The server's initialize instructions point agents there for
topic-shaped requests. Until the agent lists or fetches a prompt, the results
of `personas (action: create)`, `personas (action: list)`, `accounts (action: list)`, and
`billing (action: balance)` end with a short next-step block pointing at
`prompts (action: list)`, and a script rejected by `check_script (action: validate)` or
`generate_video` gets a hint that recipes produce scripts that pass.

To add a prompt, create it on https://post-engineer.com/recipes or with
`prompts (action: create)`, and make it public to share it. The MCP
needs no change.

## Links

- Platform: https://post-engineer.com/
- API keys: https://post-engineer.com/recipes
- Prompts: https://post-engineer.com/recipes

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
- Connect YouTube / Instagram / LinkedIn / Threads accounts.
- Schedule automated posting.
- Generate and manage API keys at [https://post-engineer.com/recipes](https://post-engineer.com/recipes).

## Requirements

- Node.js 20.10+
- API key generated at https://post-engineer.com/recipes

### Telemetry

Each request to the post-engineer API includes the calling tool's name and
the server version, recorded against your account for product analytics.
No script content, media or credentials are sent. The server itself never
contacts any analytics service.

To measure whether agents use the recipes, the requests of the recipe-aware
tools (`list_prompts`, `get_prompt`, `create_persona`, `list_personas`,
`list_social_accounts`, `get_token_balance`, `validate_script`,
`generate_persona_video`) also carry:

| Header | Value |
| --- | --- |
| `X-MCP-Session-Id` | Random id of this server instance (one stdio connection; one request over HTTP, which is stateless) |
| `X-MCP-Transport` | `stdio` or `http` |
| `X-MCP-Nudged-By` | The last tool whose result showed the recipe nudge, or `none` |
| `X-MCP-Recipes-Known` | `true` once the agent listed or fetched a recipe |
| `X-MCP-Recipe-Fetched` | The last recipe slug `get_prompt` returned, or `none` |
| `X-MCP-Script-Rejections` | Scripts the local validator rejected so far in the session |
| `X-MCP-Recipe` | The recipe slug of this call (`get_prompt`'s slug, `generate_persona_video`'s `recipe`) |

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
## Tools

- `list_personas`: list existing personas.
- `list_voices`: list available persona voices (live catalog: 65 English house voices with `gender`/`accent`/`kind`, plus your ready clones). Each voice has a `description` of how it sounds. Optional filters: `gender` (`female`|`male`), `origin` (`us`|`gb`|`character`), `search` (words matched in name/description, e.g. `"deep calm"`). The response never contains `openrouter:` or `elevenlabs:` ids — the picker is house voices + your clones only.
- `list_cloned_voices`: list your per-user Chatterbox voice clones (status and `voice_id` when ready).
- `create_cloned_voice`: register a voice clone from a short reference recording — exactly one of `audioUrl` (HTTPS URL) or `audioPath` (local `.mp3`/`.wav`/`.m4a`/`.webm` file, max 20MB, checked before it is read; errors name only the file, never the full path) (requires `consent: true` and `denoise`: `true` cleans background noise first, `false` keeps the original).
- `get_cloned_voice`: get one voice clone by id — poll its `status` after `create_cloned_voice` until `ready` (then `voice_id` is set) or `failed`.
- `delete_cloned_voice`: delete a voice clone by id.
- `preview_cloned_voice`: synthesize a short MP3 preview for a ready clone (returns base64 audio). Optional `text` (1-300 chars, English) makes the clone speak your words instead of the fixed sample; previews are free and limited to 10 per user per day.
- `preview_house_voice`: synthesize a short MP3 preview for a house voice from `list_voices` (returns base64 audio). Optional `text` (1-300 chars, English) makes the voice speak your words instead of the fixed sample; previews are free and limited to 10 per user per day.
- `list_faces`: list default/stock persona faces (live catalog from `/api/persona/faces`). Each item has `id`, `url`, `name`, `gender`, `age` (single number, e.g. 23), `ethnicity`, `hair`, and `description` (English) so agents can choose without the photo; pass a face `url` as `avatarUrl` on `create_persona`.
- `create_persona`: create an AI persona (avatar, voice, language, niche). A face is REQUIRED, from exactly one source: `avatarUrl` (a public image URL or a `list_faces` url) or `avatarPath` (a local JPG/PNG/WebP file, max 10MB, uploaded directly as the persona photo, so the server never has to download a link). Passing both is rejected before anything is sent. "No face" is a per-video choice (`options.faceless` on `generate_persona_video`). `voiceId` takes a house name or label from `list_voices` (`phonon_zoey`, `Zoey`) or a clone id/key you copied from `list_voices`; never type a provider prefix (`elevenlabs:`/`openrouter:`) — an unknown voice is rejected before anything is sent.
- `update_persona`: update an existing persona (only the provided fields change). Replace the face with `avatarUrl` or `avatarPath` (local photo file, uploaded directly); at most one of the two.
- `get_token_balance`: get the prepaid token wallet balance. Check before generating videos, which cost tokens.
- `list_prompts`: list the recipe prompts this server can run — one entry per recipe with `slug`, `title`, and `description` (news, place spotlight, subject spotlight, GitHub PRs, full setup), no prompt text (cheap discovery). Call this first when the request is a topic instead of a ready script; then fetch the matching recipe with `get_prompt`.
- `get_prompt`: get one recipe prompt by its `slug` (from `list_prompts`) as ready-to-run instructions covering the full validated flow (script limits, media checks, the generation call), ending with a line asking the agent to pass the slug as `recipe` on `generate_persona_video`. Unknown slugs return an error naming the valid slugs.
- `validate_script`: validate a segments script mechanically, without spending tokens — hook first, CTA last, exactly one of each, word limits (total 60-200, body at least 30, CTA 5-20, hook 15-40 words before TTS). Returns the word counts and the hook window (8-12 seconds spoken). Measured hook duration is pending a hook-only TTS endpoint and is reported as pending, never invented.
- `score_draft`: score a draft mechanically against the caller's own measured posts, without spending tokens. Returns a 0-100 score where every point is explained (hook, length, hashtags, slop markers, links, top-theme match, call to action), the baseline it was scored against (top angles by engagement), and the publish check for the requested network (linkedin, youtube, instagram, bluesky, threads): it fails only on an empty draft or the network's own ceiling where this repo has evidence for it (LinkedIn 3000 characters, Threads 500 characters, Bluesky 300 graphemes); the rest are warnings. A failing publish check means: fix the draft before scheduling it for that network. Pass kind 'script' for a video script (segments joined by newlines, hook first, CTA last): hashtags are not scored and publishCheck is null.
- `upload_media`: upload a local image for a video segment and get a `mediaId` to use in a segment's `media` field. JPG/JPEG, PNG, or WebP, max 8MB (the engine photo limit, not the 10MB library limit); the real content type is validated, not the extension. The file is stored as a temporary engine asset (1 hour TTL): upload shortly before generating, since a scheduled slot far in the future may outlive the asset and the segment then renders without it. Returns only the `mediaId`. A segment's `media` may also carry an `overlay` (`title`, optional `subtitle` and `badge`, at most 60, 80 and 30 characters): an info card with the real place name, address and price, painted at the top of the photo. The photo is shown over the video for the seconds its segment is spoken, with the subtitles on top: full frame on faceless videos and over b-roll (the whole photo over a blurred copy of itself, so it never leaves black bars), and as a framed panel (about 38% of the frame, 30 px from the bottom edge) where a persona's face is on screen, so the face still shows behind it. That means the hook of a hook-only lip-sync video and every segment of a full lip-sync video get the panel; once a hook-only video switches to b-roll the photo goes full frame. In the react layout the persona fills the top half, so the panel sits at the bottom. A card that cannot be drawn is skipped with a task warning while the photo still ships.
- `check_media`: mechanically check one public image URL for a segment, without an LLM and without judging relevance (the agent, who sees the image, decides relevance). Returns exactly one code: `ok`, `blocked_403`, `not_image`, `too_small`, `too_large`, `timeout`, or `face_detected`. No fake User-Agent or Referer is sent to bypass hotlink blocks, and private addresses are never fetched.
- `generate_persona_video`: generate and schedule ONE persona video from a complete script — generation is always tied to publishing (one call = generate + schedule + auto-publish; no orphan videos, no separate schedule step). Send the full script as `segments` (first `hook`, then body segments, last `cta`; 60-200 words total, body at least 30, CTA 5-20, hook 15-40 words ending with terminal punctuation) — no LLM expands it. `title` is the slot label for this video. `personaId` is optional: omit it for a faceless post with no persona, in which case set `options.faceless` and `options.voiceId` (or `options.audioUrl`), plus `videoAspect` / `language` / `niche` as needed. `options.voiceId` takes a house name or label from `list_voices` (`phonon_zoey`, `Zoey`) or a clone id/key from `list_voices`; never type a provider prefix — an unknown voice is rejected before generation (no tokens spent). Pass `providers` plus per-provider account IDs (see the account ID table below), `startAt` + `times` in `timezone` (or `mode: 'asap'` with no `startAt`/`times`). The slot must be 3h–30d ahead. `idempotencyKey` is generated automatically; reuse it to retry without generating twice (`replayed: true`). Optional `recipe`: the recipe slug the script was written with — sent only as the `X-MCP-Recipe` telemetry header, never in the request body. Poll the slot's `taskId` with `get_video_task_progress`.
- `get_video_status`: check generation status and get the final video URL.
- `get_video_task_progress`: poll one video task for machine-readable progress: returns `{task_id, state, progress, stage, error}`. `error` is the engine failure reason when `state` is `-1` (failed), `null` otherwise. Use per-video after `generate_persona_video`; prefer this over `get_video_status` when only progress matters.
- `cancel_video_task`: cancel/remove one of your video tasks on the engine by `taskId` (from `get_video_status`, `get_video_task_progress`, `get_post` or `list_posts`). Only your own task can be cancelled; a persona-scoped API key can only cancel tasks belonging to its personas. Unknown or already-finished tasks return an error; no token refund is issued by this call.
- `list_persona_images`: list a persona's image library (id, tag, description, is_primary). Use the ids with `generate_persona_video` `options.imageId` to force a specific image for every video in one call.
- `add_persona_image`: add an image to a persona image library from a local file path (JPG/JPEG, PNG, or WebP, max 9MB). Optional tag and description drive the deterministic per-video image selection.
- `update_persona_image`: update a persona library image tag, description, or primary flag.
- `remove_persona_image`: remove an image from a persona image library.
- `publish_video_direct`: publish a ready-made video file directly to social accounts — no generation, no schedule (local .mp4/.mov, max 2GB; YouTube needs title, description, tags, privacyStatus; others need caption).
- `list_social_accounts`: list connected social accounts with the account IDs needed for scheduling.
- `get_persona_publishing_accounts`: list a persona's default publishing accounts per provider. `generate_persona_video` falls back to these when no account IDs are passed; explicit IDs always win.
- `set_persona_publishing_accounts`: replace a persona's default publishing accounts per provider (account IDs from `list_social_accounts`; providers mapped to `[]` keep no defaults).
- `connect_account`: connect a social account. For youtube/instagram/linkedin/threads: returns an authorization URL — the user must open it in a browser and authorize, then the account connects automatically (verify with `list_social_accounts`). For bluesky: connects directly with handle + app password.
- `list_schedules`: list automation schedules.
- `list_posts`: list upcoming (scheduled) and past (published/failed) posts across all connected accounts.
- `cancel_schedule`: cancel a schedule by its ID.
- `get_slot`: get one scheduled post's full detail by slot ID (status, title, scheduled time, progress, schedule, persona).
- `update_slot_title`: edit the title of a scheduled post that has not started generating yet.
- `delete_slot`: delete one scheduled post slot (only pending/awaiting or failed slots; never the schedule's last slot).
- `list_video_generations`: list the video generation history, newest first (status, error code, token refunds).
- `get_video_generation`: get one video generation's detail by generation ID.
- `get_post`: get one post's full detail by id, whether the id is a slot id or a generation id (the server resolves it; the response says `kind: "slot"` or `kind: "generation"`). Both kinds carry live generation progress.
- `get_post_metrics`: per-video performance snapshots (views, likes, comments, saves) for a `window` of `24h`, `7d` or `28d`, newest first. Optional exact-match filters: `persona` (uuid, or `^@none` for posts without a persona), `account`, `provider`, `angle` (or `^@none`). Returns `rows` and `truncated`. YouTube rows also carry YouTube Analytics retention for your own videos: `engagedViews`, `stayedToWatchPct` (derived: engaged views / views, not a native metric), `averageViewPercentage`, `contentType`, `provisional` (Analytics data is not final for ~3 days; `28d` rows are final), and `analyticsStatus` (`scope_missing` = reconnect YouTube to grant `yt-analytics.readonly`).
- `list_token_transactions`: list the token ledger — every credit and debit (purchases, generation spends, refunds), newest first.
- `get_persona_delete_preview`: preview what deleting a persona would remove (counts + per-video download links). Read-only.
- `delete_persona`: DESTRUCTIVE — delete a persona with all its schedules, slots, videos, and image library. No token refunds.
- `disconnect_account`: disconnect a social account by provider and account ID.

### Social account IDs for `generate_persona_video`

Each provider's `*AccountIds` field expects the provider's account identifier
from `list_social_accounts` — **not** the `recordId` (that is the internal
database row id and is rejected):

| Provider | `generate_persona_video` field | Use this `list_social_accounts` field |
|---|---|---|
| YouTube | `youtubeAccountIds` | `channelId` |
| Instagram | `instagramAccountIds` | `igUserId` |
| LinkedIn | `linkedinAccountIds` | `providerAccountId` |
| Threads | `threadsAccountIds` | `providerAccountId` |
| Bluesky | `blueskyAccountIds` | `did` (e.g. `did:plc:...`) |

Passing a `recordId` fails fast with an error naming the right field.

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
the same hub through MCP **tools**: `list_prompts` lists the recipes
(slug/title/description) and `get_prompt` returns one recipe's full text by
`slug`. The server's initialize instructions point agents there for
topic-shaped requests. Until the agent lists or fetches a recipe, the results
of `create_persona`, `list_personas`, `list_social_accounts`, and
`get_token_balance` end with a short next-step block pointing at
`list_prompts`, and a script rejected by `validate_script` or
`generate_persona_video` gets a hint that recipes produce scripts that pass.

To add a prompt, add its text to `shared/prompt-base/prompt-base.ts` and its
entry to the web hub (`apps/web/app/recipes/prompts.ts` + its i18n title and
objective). The MCP needs no change: it serves whatever the web hub lists.

## Links

- Platform: https://post-engineer.com/
- API keys: https://post-engineer.com/recipes
- Recipes: [docs/recipes/daily-news.md](../../docs/recipes/daily-news.md) (daily news becomes a video), [docs/recipes/place-spotlight.md](../../docs/recipes/place-spotlight.md) (place spotlight becomes a video), [docs/recipes/subject-spotlight.md](../../docs/recipes/subject-spotlight.md) (subject spotlight becomes a video), [docs/recipes/last-30-days.md](../../docs/recipes/last-30-days.md) (last 30 days become a video), [docs/recipes/multi-rede.md](../../docs/recipes/multi-rede.md) (one week, one video per network) and [docs/recipes/viral-shorts.md](../../docs/recipes/viral-shorts.md) (a viral video becomes your Short)

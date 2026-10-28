# Post Engineer MCP Server

Public MCP (Model Context Protocol) server for [Post Engineer](https://post-engineer.com/). It lets AI agents (Claude, Cursor, Codex, and OpenCode) create personas, generate videos, check generation status, and schedule posts directly on your Post Engineer account.

## What is https://post-engineer.com/?

[https://post-engineer.com/](https://post-engineer.com/) is the Post Engineer web platform. You use it to:

- Create an account and log in.
- Create AI personas (avatar, voice, language, niche).
- Generate videos with those personas.
- Connect YouTube / Instagram / LinkedIn accounts.
- Schedule automated posting.
- Generate and manage API keys at [https://post-engineer.com/api-keys](https://post-engineer.com/api-keys).

## Requirements

- Node.js 20.10+
- API key generated at https://post-engineer.com/api-keys

### Telemetry (optional)

Set `POSTHOG_API_KEY` (and optionally `POSTHOG_HOST`, defaults to
`DEFAULT_POSTHOG_HOST` in `src/analytics.ts` — change the constant to
self-host) to send `mcp_tool_called` analytics events to
PostHog. Without it, the server runs normally with telemetry disabled.
The key is read from the environment only — never hardcoded.

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

Replace `<MY_API_KEY>` with the key you generated on https://post-engineer.com/api-keys. No repository clone or local build is required.

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
- `list_voices`: list available persona voices (live catalog: 65 English house voices with `gender`/`accent`/`kind`, plus your ready clones). Each voice has a `description` of how it sounds. Optional filters: `gender` (`female`|`male`), `origin` (`us`|`gb`|`character`), `search` (words matched in name/description, e.g. `"deep calm"`).
- `list_cloned_voices`: list your per-user Chatterbox voice clones (status and `voice_id` when ready).
- `create_cloned_voice`: register a voice clone from a short HTTPS audio URL (requires `consent: true` and `denoise`: `true` cleans background noise first, `false` keeps the original).
- `get_cloned_voice`: get one voice clone by id — poll its `status` after `create_cloned_voice` until `ready` (then `voice_id` is set) or `failed`.
- `delete_cloned_voice`: delete a voice clone by id.
- `preview_cloned_voice`: synthesize a short MP3 preview for a ready clone (returns base64 audio).
- `list_faces`: list default/stock persona faces (live catalog from `/api/persona/faces`). Each item has `id`, `url`, `name`, `gender`, `age` (single number, e.g. 23), `ethnicity`, `hair`, and `description` (English) so agents can choose without the photo; pass a face `url` as `avatarUrl` on `create_persona`.
- `create_persona`: create an AI persona (avatar, voice, language, niche). `avatarUrl` is REQUIRED — every persona has a face; "no face" is a per-video choice (`options.faceless` on `generate_persona_videos`).
- `update_persona`: update an existing persona (only the provided fields change).
- `get_token_balance`: get the prepaid token wallet balance. Check before generating videos, which cost tokens.
- `generate_persona_videos`: generate and schedule 1-10 persona videos in ONE operation — generation is always tied to publishing (one call = generate + schedule + auto-publish; no orphan videos, no separate schedule step). `personaId` is optional: omit it for a faceless post with no persona, in which case set `options.faceless` and `options.voiceId` (or `options.audioUrl`), plus `options.scriptPrompt` / `videoAspect` / `language` / `niche` as needed — a persona is not only a face, it is where voice, script, aspect and niche come from. With a persona, `options.faceless: true` drops only the face and the persona still supplies the rest. `topics` is one topic per video; the server assigns publish slots across `startAt` + `times` (daily `HH:MM` publish times in `timezone`). Set `mode: 'asap'` to publish each video the moment its generation finishes instead of scheduling it — `startAt` and `times` must NOT be set then. Pass `providers` plus per-provider account IDs (see the account ID table below). Every slot must be 3h–30d ahead. `idempotencyKey` is generated automatically; reuse it to retry without generating twice (`replayed: true`). Poll each slot's `taskId` with `get_video_task_progress`.
- `validate_script`: validate a segments script mechanically, without spending tokens — hook first, CTA last, exactly one of each, word limits (total 60-200, body at least 30, CTA 5-20, hook 15-40 words before TTS). Returns the word counts and the hook window (8-12 seconds spoken). Measured hook duration is pending a hook-only TTS endpoint and is reported as pending, never invented.
- `upload_media`: upload a local image for a video segment and get a `mediaId` to use in a segment's `media` field. JPG/JPEG, PNG, or WebP, max 8MB (the engine photo limit, not the 10MB library limit); the real content type is validated, not the extension. The file is stored as a temporary engine asset (1 hour TTL): upload shortly before generating, since a scheduled slot far in the future may outlive the asset and the segment then renders without it. Returns only the `mediaId`.
- `check_media`: mechanically check one public image URL for a segment, without an LLM and without judging relevance (the agent, who sees the image, decides relevance). Returns exactly one code: `ok`, `blocked_403`, `not_image`, `too_small`, `too_large`, `timeout`, or `face_detected`. No fake User-Agent or Referer is sent to bypass hotlink blocks, and private addresses are never fetched.
- `generate_persona_video`: generate and schedule ONE persona video from a complete script — generation is always tied to publishing (one call = generate + schedule + auto-publish; no orphan videos, no separate schedule step). Send the full script as `segments` (first `hook`, then body segments, last `cta`; 60-200 words total, body at least 30, CTA 5-20, hook 15-40 words ending with terminal punctuation) — no LLM expands it. `title` is the single topic for this video. `personaId` is optional, same faceless rules as `generate_persona_videos`. Pass `providers` plus per-provider account IDs (see the account ID table below), `startAt` + `times` in `timezone` (or `mode: 'asap'` with no `startAt`/`times`). The slot must be 3h–30d ahead. `idempotencyKey` is generated automatically; reuse it to retry without generating twice (`replayed: true`). Poll the slot's `taskId` with `get_video_task_progress`.
- `get_video_status`: check generation status and get the final video URL.
- `get_video_task_progress`: poll one video task for machine-readable progress: returns `{task_id, state, progress, stage, error}`. `error` is the engine failure reason when `state` is `-1` (failed), `null` otherwise. Use per-video (1/6, 2/6, ...) after `generate_persona_videos`; prefer this over `get_video_status` when only progress matters.
- `cancel_video_task`: cancel/remove one of your video tasks on the engine by `taskId` (from `get_video_status`, `get_video_task_progress`, `get_post` or `list_posts`). Only your own task can be cancelled; a persona-scoped API key can only cancel tasks belonging to its personas. Unknown or already-finished tasks return an error; no token refund is issued by this call.
- `list_persona_images`: list a persona's image library (id, tag, description, is_primary). Use the ids with `generate_persona_videos` `options.imageId` to force a specific image for every video in one call.
- `add_persona_image`: add an image to a persona image library from a local file path (JPG/JPEG, PNG, or WebP, max 9MB). Optional tag and description drive the deterministic per-video image selection.
- `update_persona_image`: update a persona library image tag, description, or primary flag.
- `remove_persona_image`: remove an image from a persona image library.
- `publish_video_direct`: publish a ready-made video file directly to social accounts — no generation, no schedule (local .mp4/.mov, max 2GB; YouTube needs title, description, tags, privacyStatus; others need caption).
- `list_social_accounts`: list connected social accounts with the account IDs needed for scheduling.
- `get_persona_publishing_accounts`: list a persona's default publishing accounts per provider. `generate_persona_videos` falls back to these when no account IDs are passed; explicit IDs always win.
- `set_persona_publishing_accounts`: replace a persona's default publishing accounts per provider (account IDs from `list_social_accounts`; providers mapped to `[]` keep no defaults).
- `connect_account`: connect a social account. For youtube/instagram/linkedin: returns an authorization URL — the user must open it in a browser and authorize, then the account connects automatically (verify with `list_social_accounts`). For bluesky: connects directly with handle + app password.
- `list_schedules`: list automation schedules.
- `list_posts`: list upcoming (scheduled) and past (published/failed) posts across all connected accounts.
- `cancel_schedule`: cancel a schedule by its ID.
- `get_slot`: get one scheduled post's full detail by slot ID (status, topic, scheduled time, progress, schedule, persona).
- `update_slot_topic`: edit the topic of a scheduled post that has not started generating yet.
- `delete_slot`: delete one scheduled post slot (only pending/awaiting or failed slots; never the schedule's last slot).
- `list_video_generations`: list the video generation history, newest first (status, error code, token refunds).
- `get_video_generation`: get one video generation's detail by generation ID.
- `get_post`: get one post's full detail by id, whether the id is a slot id or a generation id (the server resolves it; the response says `kind: "slot"` or `kind: "generation"`). Both kinds carry live generation progress.
- `get_post_metrics`: per-video performance snapshots (views, likes, comments, saves) for a `window` of `24h` or `7d`, newest first. Optional exact-match filters: `persona` (uuid, or `^@none` for posts without a persona), `account`, `provider`, `angle` (or `^@none`). Returns `rows` and `truncated`.
- `list_token_transactions`: list the token ledger — every credit and debit (purchases, generation spends, refunds), newest first.
- `get_persona_delete_preview`: preview what deleting a persona would remove (counts + per-video download links). Read-only.
- `delete_persona`: DESTRUCTIVE — delete a persona with all its schedules, slots, videos, and image library. No token refunds.
- `disconnect_account`: disconnect a social account by provider and account ID.

### Social account IDs for `generate_persona_videos`

Each provider's `*AccountIds` field expects the provider's account identifier
from `list_social_accounts` — **not** the `recordId` (that is the internal
database row id and is rejected):

| Provider | `generate_persona_videos` field | Use this `list_social_accounts` field |
|---|---|---|
| YouTube | `youtubeAccountIds` | `channelId` |
| Instagram | `instagramAccountIds` | `igUserId` |
| LinkedIn | `linkedinAccountIds` | `providerAccountId` |
| Bluesky | `blueskyAccountIds` | `did` (e.g. `did:plc:...`) |

Passing a `recordId` fails fast with an error naming the right field.

## Links

- Platform: https://post-engineer.com/
- API keys: https://post-engineer.com/api-keys

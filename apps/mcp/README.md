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
      "command": ["npx", "-y", "post-engineer-mcp"],
      "environment": {
        "POST_ENGINEER_API_KEY": "<MY_API_KEY>"
      }
    }
  }
}
```

Replace `<MY_API_KEY>` with the key you generated on https://post-engineer.com/api-keys. No repository clone or local build is required.

### OpenCode

OpenCode uses `mcp` instead of `mcpServers`. Its local MCP tool-discovery timeout defaults to 5 seconds, which can be too short while `npx` downloads the package on the first launch. Set a longer timeout:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "post-engineer": {
      "type": "local",
      "command": ["npx", "-y", "post-engineer-mcp"],
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
- `list_voices`: list available persona voices (live catalog from the platform, not hardcoded).
- `list_faces`: list default/stock persona faces (live catalog from `/api/persona/faces`). Each item has `id`, `url`, `name`, `gender`, `age` (single number, e.g. 23), `ethnicity`, `hair`, and `description` (English) so agents can choose without the photo; pass a face `url` as `avatarUrl` on `create_persona`.
- `create_persona`: create an AI persona (avatar, voice, language, niche).
- `update_persona`: update an existing persona (only the provided fields change).
- `get_token_balance`: get the prepaid token wallet balance. Check before generating videos, which cost tokens.
- `generate_video_from_persona`: generate a video with a persona. Optional `scriptPrompt` overrides the video script; optional `audioUrl` (public http(s) URL) supplies custom audio for this video, overriding the persona voice; optional `imageId` picks a specific image from the persona image library (see `list_persona_images`); optional `webhookUrl` is POSTed by the server once when the video reaches a terminal state.
- `generate_persona_video_batch`: generate 1-10 persona videos in one batch (sequential, in order; one topic per video). Optional `webhookUrl` is POSTed by the server once when each video terminates. Returns `{task_ids}`; poll each with `get_video_task_progress`.
- `get_video_status`: check generation status and get the final video URL.
- `get_video_task_progress`: poll one video task for machine-readable progress: returns `{task_id, state, progress, stage, error}`. `error` is the engine failure reason when `state` is `-1` (failed), `null` otherwise. Use per-video (1/6, 2/6, ...) after `generate_persona_video_batch`; prefer this over `get_video_status` when only progress matters.
- `list_persona_images`: list a persona's image library (id, tag, description, is_primary). Use the ids with `generate_video_from_persona` `imageId` to force a specific image for one video.
- `add_persona_image`: add an image to a persona image library from a local file path (JPG/JPEG, PNG, or WebP, max 9MB). Optional tag and description drive the deterministic per-video image selection.
- `update_persona_image`: update a persona library image tag, description, or primary flag.
- `remove_persona_image`: remove an image from a persona image library.
- `list_social_accounts`: list connected social accounts with the account IDs needed for scheduling.
- `connect_account`: connect a social account. For youtube/instagram/linkedin: returns an authorization URL — the user must open it in a browser and authorize, then the account connects automatically (verify with `list_social_accounts`). For bluesky: connects directly with handle + app password.
- `schedule_video`: schedule automated posting (must be at least 24h in advance; each provider needs an account ID from `list_social_accounts`).
- `list_schedules`: list automation schedules.
- `list_posts`: list upcoming (scheduled) and past (published/failed) posts across all connected accounts.
- `cancel_schedule`: cancel a schedule by its ID.

### Social account IDs for `schedule_video`

Each provider's `*AccountIds` field expects the provider's account identifier
from `list_social_accounts` — **not** the `recordId` (that is the internal
database row id and is rejected):

| Provider | `schedule_video` field | Use this `list_social_accounts` field |
|---|---|---|
| YouTube | `youtubeAccountIds` | `channelId` |
| Instagram | `instagramAccountIds` | `igUserId` |
| LinkedIn | `linkedinAccountIds` | `providerAccountId` |
| Bluesky | `blueskyAccountIds` | `did` (e.g. `did:plc:...`) |

Passing a `recordId` fails fast with an error naming the right field.

## Links

- Platform: https://post-engineer.com/
- API keys: https://post-engineer.com/api-keys

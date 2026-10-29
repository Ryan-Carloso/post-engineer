# Recipe: full setup becomes a video

> Version: 1. MCP: `post-engineer-mcp` 1.31.0 (use `npx -y post-engineer-mcp@latest`;
> `@latest` fetches the newest version instead of a stale cached copy).
> Status: end-to-end onboarding recipe. It chains account connection, persona
> creation, a validated script, and one real publish. It is the onboarding
> recipe for a fresh account; see `daily-news.md` for the day-two loop.

## Objective

Take a user from zero (no connected accounts, no persona) to one published
persona video in a single ordered flow: connect accounts, create the persona,
write and validate the script, confirm the publish target, then generate one
video with `generate_persona_video`. No step is reordered and none is skipped:
validation runs before any token is spent, and the publish warning reaches the
user before generation.

## Prerequisites

- A Post Engineer account and an API key from
  https://post-engineer.com/api-keys, in the agent's local MCP configuration as
  `POST_ENGINEER_API_KEY`. Never paste the key in chat, in a prompt, or in this
  repo.
- For youtube, instagram, and linkedin: OAuth. Ask the user which of the three
  they want; only the accounts they choose get connected. The MCP tool
  `connect_account` returns an https link; the user finishes it in their own
  browser. The recipe re-checks with `list_social_accounts` after each connect.
- For Bluesky (optional): the user gives the Bluesky app password to the agent
  only for `connect_account`; the agent never repeats, prints, or logs it —
  not in chat, not in a file. The user creates it in their Bluesky security
  settings if they do not have one.
- Script planning answers: what the user's channel is about, spoken language,
  and tone for `create_persona` (name, avatarUrl via `list_faces`, voiceId via
  `list_voices`, language English-only, niche).

## Rules that never change

- Secrets stay out of every surface. The Bluesky app password is typed by the
  user into the platform UI only; an agent never repeats, prints, or logs it.
- Validate before generating. `get_token_balance` first, then
  `validate_script` until it passes; generation never runs on an unvalidated
  script. `validate_script` does not debit tokens; `generate_persona_video`
  does.
- The publish is real. `generate_persona_video` publishes as an actual post on
  the chosen accounts; the agent says so and confirms the providers/accounts
  and the mode (`scheduled` or `asap`) with the user before generating.
- Bluesky video publishing is currently being fixed (issue #327). Bluesky is
  optional in this recipe and can be skipped without blocking connect, persona,
  or generation.
- Script contract: first segment is the hook, last is the CTA, exactly one of
  each; 60–200 words total; spoken English only; no links, hashtags, markdown,
  emoji, or stage directions. One generation call; poll
  `get_video_task_progress` and share the final URL from `get_video_status`.

## Steps

1. `list_social_accounts`. Ask which of youtube, instagram, linkedin the
   user wants; for each one that is missing, call `connect_account` and hand
   the OAuth link to the user; re-check with `list_social_accounts`.
2. Bluesky (optional): ask for handle + app password (never the main
   password); use it in `connect_account` only, never repeat, print, or log
   it.
3. `list_faces` + `list_voices`; let the user pick a face and a voice; then
   `create_persona` with name, avatarUrl, voiceId, language `"en-US"`
   (English only for now) and niche; remember the `personaId`.
4. `get_token_balance`; write the script (hook first, CTA last, 60–200
   words); `validate_script` until it passes, before any token is spent.
5. Confirm publish: say the video IS published as a real post; confirm the
   providers/accounts and the mode (`scheduled|asap`); mention the Bluesky
   limitation (issue #327) and that Bluesky can be skipped.
6. `generate_persona_video` once with that `personaId`, the validated
   segments unchanged, the confirmed providers with their account IDs and
   mode; poll `get_video_task_progress`; share the URL from
   `get_video_status`.

## Example

**Input:** a user with zero accounts and no persona, asking for their first
video.

**Output:** the accounts the user chose connected via OAuth (Bluesky skipped
or connected with an app password), one persona created from their face and
voice pick, a validated 60–200 word script, one `generate_persona_video` call
in the confirmed mode, and the published video URL in the chat.

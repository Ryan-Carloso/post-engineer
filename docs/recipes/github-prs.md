# Prompt: GitHub PRs become videos

> Version: 1. MCP: `post-engineer-mcp` 1.31.0 (use `npx -y post-engineer-mcp@latest`;
> `@latest` fetches the newest version instead of a stale cached copy).
> Status: first prompt entry for this use. Proven mechanically (the script
> contract below is the same one `validate_script` enforces); a real
> published video from this prompt is a separate, user-approved step, not
> part of this file.

## Objective

Turn one GitHub pull request into one short persona video, published to the
user's connected social accounts. One PR, one video, one call to
`generate_persona_video`. No batch, no topics list: the agent writes the
complete script as segments, validates it mechanically, and only then
generates. The agent never invents PR details — if the title,
description, or change summary is missing, it asks for it instead of
guessing.

## Prerequisites

- A Post Engineer account with social accounts connected on
  https://post-engineer.com (OAuth needs a browser; see the MCP README).
- An API key from https://post-engineer.com/api-keys, in the agent's local MCP
  configuration as `POST_ENGINEER_API_KEY`. Never paste the key in chat, in a
  prompt, or in this repo.
- A persona (`personaId` from `list_personas`), or a faceless setup
  (`options.faceless` plus `options.voiceId` or `options.audioUrl`).
- A token balance that covers one video: check with `get_token_balance`
  before generating. Generation costs tokens; `validate_script`,
  `check_media`, and `upload_media` do not debit tokens.

## Rules that never change

- Language is English only (`language` must be exactly `en`, e.g. `en-US`).
  The script is spoken text only: no links, hashtags, markdown, emoji, or
  stage directions in any segment.
- Validate before generating. `validate_script` runs before any token is
  debited. If it returns an error, fix the named field with the named fix
  and validate again. Never send a script to `generate_persona_video` that
  has not passed `validate_script`.
- Generation is always tied to publishing. There is no orphan video and no
  separate schedule step: one `generate_persona_video` call generates and
  publishes at its slot (`mode: 'scheduled'` with `startAt` + `times`, or
  `mode: 'asap'` with no `startAt`/`times`). Slots must be 3h-30d ahead.

## Limits (verified against the segments contract)

| Rule | Value |
| --- | --- |
| Segments per video | At most 12 |
| Segment order | First `hook`, then `body`, last `cta`; exactly one hook and one CTA |
| Total words | 60-200 |
| Body words | At least 30 |
| CTA words | 5-20 |
| Hook words | Aim for 20-30 words, the target for the 8-12 second spoken hook window |
| Medias per video | At most 6; only if they match the PR (screenshots, diagrams, or repo visuals); otherwise generate without media |
| Segment media image | JPG/JPEG, PNG, or WebP; at most 8MB (the engine photo limit) |

## Copy-ready prompt

Paste this into your agent (Cursor, Claude, Muse, OpenCode, or any agent):

```text
Turn this GitHub pull request into one persona video.

PR to use (paste the PR title, description, and a short change summary, plus any linked issues):
- Title: ...
- Description: ...
- What changed: ...
- Linked issues: ...

Rules:
- Use the Post Engineer MCP server and the singular video tool, generate_persona_video.
- First, call validate_script with your script and only proceed when it is valid — validate before any token is debited.
- Script: spoken text only, no links, hashtags, markdown, emojis, or stage directions.
- Structure: first segment is the hook, last segment is the CTA, exactly one of each.
- Length: 60–200 words total, hook 20–30 words (8–12 seconds), body at least 30 words, CTA 5–20 words, at most 12 segments.
- Language: en only.
- Media: at most 6, only if they match the PR (screenshots, diagrams, or repo visuals); otherwise generate without media.
- Then generate one video for this PR and publish it where the user asked, scheduled or asap.
- Never invent PR details: if the title, description, or change summary is missing, ask for it instead of guessing.
```

## Example input (illustrative, not a real PR)

- Title: Add retry with backoff to video uploads.
- Description: Uploads failed on transient 5xx errors with no retry, so a
  single hiccup lost the whole upload.
- What changed: the upload client now retries 5xx responses with
  exponential backoff, up to three attempts, and surfaces the last error
  only after the final attempt.

## Expected output

One video: a hook on the fix, body segments on what changed and why it
matters, and a CTA to follow the repo. The script is validated with
`validate_script` before `generate_persona_video` is called, and nothing
in it is invented beyond the PR input above.

## Tools used

- `list_personas`, `list_social_accounts`,
  `get_persona_publishing_accounts`, `get_token_balance`
  (setup and pre-flight, no tokens debited).
- `validate_script` (mechanical validation, no tokens debited).
- `check_media`, `upload_media` (media checks/uploads, no tokens debited).
- `generate_persona_video` (the one call that debits tokens).
- `get_video_task_progress`, `get_video_status` (polling and final URL).

No new MCP tool is introduced by this prompt. The batch tool
`generate_persona_videos` is deliberately not used: one PR is one video,
one singular call.

## Discovery

This prompt is listed on the web prompts hub at `/recipes` and has its own
detail page there (`/recipes/github-prs`), with the full prompt and a copy
button. The detail page is the primary flow; this doc is the source
content the page is built from.

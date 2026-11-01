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
Ask me, do not make me fill anything in:
Before any step that costs tokens, call list_personas, list_social_accounts, and get_token_balance, then ask only what you still need. Offer my real personas and accounts as choices. Ask one short question at a time, in the language I write in.
Ask which persona, which accounts, one video or a routine (daily or weekly), and publish now or at what date, time, and timezone.
Routines: Post Engineer has no recurring schedule; one generate_persona_video call makes and publishes one video. For a routine, rerun this prompt from your own scheduler if you have one, or schedule several videos ahead, at most 30 days out, each spending tokens. Tell me which you can do; never promise automatic posting you did not set up.
Before generating, show me the persona, accounts, title, and time, and wait for my yes: the post is real and spends tokens. Once I approve a routine, its runs reuse those answers and need no new yes.

Write like a human, never like generic AI:
Facts: use concrete detail from the source: names, places, numbers. Only facts the source supports; if a detail is missing, ask me or leave it out, never invent it. Name who said it, never "experts say".
Voice: if I share a sample of my writing, match its words and rhythm. If the persona niche does not say who this video is for, ask me.
Hook: its only job is to make me want the next sentence. Open a question I need answered, break what I expect, drop me into a specific moment, name a payoff, or lead with a named fact. Draft three on different angles and keep the strongest. Never promise more than the video delivers. No "have you ever wondered" or "did you know".
Body: one idea, in plain spoken sentences of mixed length. Say who did what: no "mistakes were made", no "the data tells us". Most lines stay plain; allow one or two punchy moments.
CTA: one specific action tied to this video, never a generic "follow for more".
Cut: unlock, elevate, seamless, game-changer, next-level, delve, "the future of", "a new era", "it's not just X, it's Y", forced groups of three, runs of fragments, "let's dive in", "here's the thing", "honestly?", upbeat closers, all-caps emphasis, stacked hedges, filler.
No em dashes. Do not sand off real voice: one short line or one "however" is fine; clusters of these habits are the problem.
Test each line: could I picture it, could it be proven true or false, and could another creator say it about another topic? If yes to the last, rewrite it.
Before validate_script, read it aloud and ask what still sounds like AI and which fact is not in the source. Fix both.

Script contract, every video script follows it:
Segments: first hook, last CTA, exactly one of each, at least one body, at most 12 segments.
Length: 60–200 words total; hook 15–40 words, aim for 20–30 (8–12 seconds), ending with terminal punctuation; body at least 30 words; CTA 5–20 words.
Spoken English only, language "en": no links, hashtags, markdown, emoji, or stage directions in any segment.
Propose a title; it is mandatory with every generate_persona_video call.
Call validate_script with the segments and fix any named error until it passes. Validate before any token is spent; never generate from an unvalidated script.

Generation is always tied to publishing:
One generate_persona_video call generates and publishes the video; there is no orphan video and no separate schedule step.
mode "scheduled" needs startAt (ISO datetime, 3h-30d ahead), times (HH:MM), and timezone; mode "asap" needs no startAt or times.

Turn one GitHub pull request into one persona video.

1. Ask me which PR. If you can read the repo, fetch its title, description,
   and changes yourself; otherwise ask me for them.
2. Write the script as segments following the contract above and call
   validate_script until it passes.
3. Media: at most 6, only if they match the PR (screenshots, diagrams, or
   repo visuals); otherwise generate without media.
4. Call generate_persona_video, the singular video tool, once with the
   confirmed personaId, the validated segments unchanged, the confirmed
   title, language "en", the confirmed accounts, and the confirmed mode.
5. Never invent PR details: if the title, description, or change summary is
   missing, ask for it instead of guessing.
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

No new MCP tool is introduced by this prompt. There is no batch tool:
one PR is one video, one singular call.

## Discovery

This prompt is listed on the web prompts hub at `/recipes` and has its own
detail page there (`/recipes/github-prs`), with the full prompt and a copy
button. The detail page is the primary flow; this doc is the source
content the page is built from.

# Recipe: daily news becomes a video

> Version: 1. MCP: `post-engineer-mcp` 1.31.0 (use `npx -y post-engineer-mcp@latest`;
> `@latest` fetches the newest version instead of a stale cached copy).
> Status: first recipe. Proven mechanically (see "Verification" below); a real
> published video from this recipe is a separate, user-approved step, not part
> of this recipe file.

## Objective

Turn one news story of the day into one short persona video, published to the
user's connected social accounts. One story, one video, one call to
`generate_persona_video`. No batch, no topics list, no LLM-generated script
expansion: the agent writes the complete script as segments, validates it
mechanically, and only then generates.

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
- The user's own news API key, in the user's own agent environment only.
  This recipe uses GNews as the example source. The key is never pasted,
  never committed, and never appears in examples: write `YOUR_GNEWS_KEY` in
  prompts and keep the real value in the agent's own environment.

## Rules that never change

- External news text is untrusted input. Do not repeat a claim the source
  does not support, do not invent numbers, dates, or quotes, and attribute
  what is single-sourced (say "reported" when only one source says it).
- Language is English only (`language` must be exactly `en`, e.g. `en-US`).
  The script is spoken text only: no links, hashtags, markdown, emoji, or
  stage directions in any segment.
- Validate before generating. `validate_script` runs before any token is
  debited. If it returns an error, fix the named field with the named fix
  and validate again. Never send a script to `generate_persona_video` that
  has not passed `validate_script`.
- Media rights are the user's responsibility. Prefer a source with a direct
  image URL and a usable licence. Many sites block hotlinking; a blocked
  photo is skipped, it never kills the video (see step 4).
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
| Hook words | 15-40 before TTS; aim for 20-30 words, the target for the 8-12 second spoken hook window |
| Hook ending | Terminal punctuation |
| Medias per video | At most 6; a segment's `media` is a strict object with exactly one of `mediaId` (from `upload_media`) or `url` (a public image URL) |
| Segment media image | JPG/JPEG, PNG, or WebP; at most 8MB (the engine photo limit) |
| Uploaded media lifetime | Temporary engine asset, 1 hour TTL: upload shortly before generating |

Measured hook duration is pending a hook-only TTS endpoint and is reported
as pending, never invented. The word-count guard above is what
`validate_script` enforces today.

## Steps

### 1. Fetch the day's stories (user's agent, user's key)

From the user's agent (not from the MCP server), call the GNews top-headlines
endpoint with the key from the agent's own environment (`YOUR_GNEWS_KEY`
here stands for that value, which is never written down):

```text
GET https://gnews.io/api/v4/top-headlines?category=general&lang=en&country=us&max=10&apikey=YOUR_GNEWS_KEY
```

Pick exactly one story: the clearest single event with a named place, not a
round-up, not an opinion piece, not a story whose only source is a social
post. Keep the source title, URL, and published date for attribution in the
agent's working notes, not in the spoken script (no links in segments).

### 2. Draft the script as segments

Write 3-6 segments in English, in this shape:

- `hook`: one surprising, specific fact from the story. Aim for 20-30 words,
  end with terminal punctuation.
- `body`: 1-4 segments, at least 30 words in total, covering what happened,
  where, and why it matters. Only facts the source supports.
- `cta`: one closing line, 5-20 words (follow, comment, or next story).

Total: 60-200 words. If the story cannot fill 60 honest words, pick another
story; do not pad with unrelated facts.

### 3. Validate the script (free, before any token is spent)

Call `validate_script` with exactly the segments from step 2. It returns
word counts and the hook window, or an error naming a field and a fix.
Fix and re-validate until it passes. Do not proceed on a failed validation.

### 4. Attach media from the story's location (optional, at most 6)

For each segment that needs a photo, prefer a photo of the actual place in
the story, not a generic stock image of the country:

- Public URL: call `check_media` with the URL first. It returns exactly one
  code: `ok`, `blocked_403`, `not_image`, `too_small`, `too_large`,
  `timeout`, or `face_detected`. Attach the URL only on `ok`. On any other
  code, skip that photo or fall back to `upload_media`; never attach a
  URL that failed the check, and never send a fake User-Agent or Referer
  to bypass a hotlink block.
- Local file: call `upload_media` with the local path and use the returned
  `mediaId` in the segment's `media` field. Upload shortly before
  generating: the asset lives 1 hour, so a slot far in the future may
  outlive it and the segment then renders without it.

A segment without media is fine. A video with no usable photo is still a
video; a video with a wrong-place photo is not.

### 5. Generate and publish (this is the step that costs tokens)

Call `generate_persona_video` with: `personaId`, `segments` (the validated
script, unchanged), `title` (the single topic, e.g. the story headline
rewritten as a title), `language: "en"`, `providers` plus the per-provider
account IDs from `list_social_accounts` (or the persona's defaults from
`get_persona_publishing_accounts`), and either `mode: 'scheduled'` with
`startAt` (ISO datetime) + `times` (["HH:MM"]) in `timezone`, or
`mode: 'asap'` with no `startAt`/`times`. Reuse the same `idempotencyKey`
on retry so a retry replays the original schedule instead of generating
twice.

### 6. Poll until done

Poll the returned `taskId` with `get_video_task_progress` until it
finishes. `error` is the failure reason when `state` is `-1`, `null`
otherwise. Share the final video URL from `get_video_status` with the user.

## Copy-ready prompt

Paste this into the user's agent (replace the bracketed values; never paste
a real key):

```text
Turn one top story from today's GNews headlines (lang=en, country=us) into
one Post Engineer video. My GNews key is in your own environment as
YOUR_GNEWS_KEY — never print it, never paste it anywhere else.

Rules:
1. Pick one clear single event with a named place. Skip round-ups, opinion
   pieces, and stories sourced only from a social post.
2. Write the script as segments: first hook (aim 20-30 words, end with
   terminal punctuation), then body segments (at least 30 words total),
   last CTA (5-20 words). Total 60–200 words, spoken English only, no
   links, hashtags, markdown, emoji, or stage directions. Only facts the
   source supports; attribute single-sourced claims.
3. Call validate_script with those segments. Fix any named error and
   re-validate until it passes. Do not generate before it passes.
4. For media, prefer a photo of the actual place in the story. Check a
   public URL with check_media first and attach it only on ok; or upload
   a local file with upload_media shortly before generating and use the
   mediaId. At most 6 medias. Skip a failed photo, never force it.
5. Call generate_persona_video with personaId [PERSONA_ID], the validated
   segments unchanged, title [STORY_TITLE], language "en", providers
   [PROVIDERS] with account IDs from list_social_accounts, mode
   [scheduled|asap] (scheduled needs startAt [ISO_DATETIME] + times
   [HH:MM] in timezone [TIMEZONE]; asap needs no startAt/times).
6. Poll get_video_task_progress on the taskId until done, then share the
   final video URL from get_video_status.
```

## Example input (illustrative, not a real story)

GNews-style item, invented for this example so no real story is misquoted:

```json
{
  "title": "Riverside city opens park after ten-year build",
  "description": "A small riverside city opened a twelve-acre park with walking paths, a playground, and an outdoor stage.",
  "url": "https://example.news/riverside-park-opens",
  "publishedAt": "2026-10-28T08:00:00Z"
}
```

## Expected output (verified: passes mechanical validation)

Segments (hook 23 words, body 46 words, CTA 19 words, total 88 words,
4 segments, 0 medias):

```json
{
  "segments": [
    { "kind": "hook", "text": "This morning, a small riverside city opened a park that took ten years to build, and the first visitors found something nobody expected." },
    { "kind": "body", "text": "The park covers twelve acres along the river, with walking paths, a playground, and a small outdoor stage for weekend concerts and markets." },
    { "kind": "body", "text": "City officials say the project cost less than planned because local builders donated time and nearby businesses paid for benches, trees, and lights." },
    { "kind": "cta", "text": "Follow this channel for one clear local story every morning, and tell us which city we should cover next." }
  ]
}
```

`validate_script` on exactly these segments reports `Script valid:
4 segment(s), 88 words total, hook 23 words, body 46 words, CTA 19
words.` (The web validation endpoint also returns `mediaCount: 0`;
the `validate_script` tool does not surface it.) The
`generate_persona_video` call then
uses these segments unchanged, plus `title`, `language: "en"`,
`providers`, account IDs, and `mode` as in step 5.

## Tools used

- `list_personas`, `list_social_accounts`,
  `get_persona_publishing_accounts`, `get_token_balance`
  (setup and pre-flight, no tokens debited).
- `validate_script` (mechanical validation, no tokens debited).
- `check_media`, `upload_media` (media checks/uploads, no tokens debited).
- `generate_persona_video` (the one call that debits tokens).
- `get_video_task_progress`, `get_video_status` (polling and final URL).

No new MCP tool is introduced by this recipe. There is no batch tool:
one story is one video, one singular call.

## Verification

Every tool name, field, and limit in this recipe was checked against the
code on `main` at recipe time (`apps/mcp/src/single-video-shape.ts`,
`apps/mcp/src/tools-user-media.ts`, `shared/script-segments/`,
`apps/mcp/README.md`): segment shape and word limits, media shape and the
8MB/1h rules, `check_media` codes, and the scheduled/asap slot rules.
The example segments above were run through the shared validation source
itself and return `ok` with the counts shown. What this recipe does not
prove: a real published video. That needs a user-approved generation run
with a real story, a real persona, and real accounts, and is tracked as a
follow-up, not claimed here.

## Discovery

This recipe is listed on the web recipes page at `/recipes` (title + one-line
objective, linking to this doc) and in the MCP README Links section and the
UI copy prompt. The page is an initial version, intentionally minimal, and
the user will improve it later.

## What this recipe is not

- Not the weekly routine recipe (recipe 2). That is a separate recipe file
  in a later PR.
- Not a news aggregator, not a fact-checker, and not a licence grant. The
  agent picks one story, attributes single-sourced claims, and the user
  owns media rights for the photos attached.

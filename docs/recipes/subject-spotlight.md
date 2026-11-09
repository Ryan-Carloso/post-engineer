# Recipe: subject spotlight becomes a video

> MCP: `post-engineer-mcp` (use `npx -y post-engineer-mcp@latest`;
> `@latest` fetches the newest version instead of a stale cached copy).
> Status: prompt shipped in the hub. Proven mechanically (see "Verification"
> below); a real published video from this recipe is a separate, user-approved
> step, not part of this recipe file.

## Objective

Turn one concrete subject (a car, a product, a gadget, a tool) into one short
persona video published to the user's connected social accounts. The subject
shows up as its own photos on screen, each carrying the overlaid card with the
real name, the exact version, and the real price — the segment media + overlay
card the engine draws (see `apps/mcp/README.md`, `upload_media`). One subject,
one video, one call to `generate_persona_video`. No batch, no products list,
no LLM script expansion: the agent writes the complete script as segments,
pins the identity and the price, finds and checks the photos itself, validates
mechanically, and only then generates.

## Prerequisites

- A Post Engineer account with social accounts connected on
  https://post-engineer.com (OAuth needs a browser; see the MCP README).
- An API key from https://post-engineer.com/recipes, in the agent's local MCP
  configuration as `POST_ENGINEER_API_KEY`. The prompts hub can fill a freshly
  created key into its own setup prompt for you; never paste the key anywhere
  else — no other chat, prompt, or this repo.
- A persona (`personaId` from `list_personas`), or a faceless setup
  (`options.faceless` plus `options.voiceId` or `options.audioUrl`).
- A token balance that covers one video: check with `get_token_balance`
  before generating. Generation costs tokens; `validate_script`,
  `check_media`, and `upload_media` do not debit tokens.
- The user's own search-tool key for facts AND image search, in the user's
  own agent environment only. Tavily is the reference example (its search
  returns image results); Exa or the agent's own web/MCP search tool works
  the same way for facts, so long as it can also return direct image URLs.
  The key is never pasted, never committed, and never appears in examples:
  write `YOUR_TAVILY_API_KEY` in prompts and keep the real value in the
  agent's own environment.

## Rules that never change

- One subject per video. A comparison of three cars is three videos, not one.
- Identity first. The exact model, trim, and year (or the product's exact
  generation) are pinned BEFORE any photo is picked: a photo of the wrong
  generation or a rebadged twin is a wrong-subject photo, and a wrong-subject
  photo is worse than no photo.
- Prices expire. The on-screen price must be pinned to the identity, its
  currency, market, and date, and must come from the search results. If the
  results do not confirm it, the badge is dropped, never invented.
- Facts: only what the search results support. Specs the results do not name
  (range, horsepower, charging time) stay out of the script.
- Language is English only (`language` must be exactly `en`, e.g. `en-US`).
  The script is spoken text only: no links, hashtags, markdown, emoji, or
  stage directions in any segment.
- Photos: only photos of the exact subject the video spotlights. Media rights
  are the user's responsibility; prefer sources with a usable licence. Many
  sites block hotlinking; a blocked photo is skipped, it never kills the
  video.
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
| Segments per video | At most 12 (this recipe: 3-6) |
| Segment order | First `hook`, then `body`, last `cta`; exactly one hook and one CTA |
| Total words | 60-200 |
| Body words | At least 30 |
| CTA words | 5-20 |
| Hook words | 15-40 before TTS; aim for 20-30 words, the target for the 8-12 second spoken hook window |
| Hook ending | Terminal punctuation |
| Medias per video | At most 6; a segment's `media` is an array of objects, each with exactly one of `mediaId` (from `upload_media`) or `url` (a public image URL) |
| Segment media image | JPG/JPEG, PNG, or WebP; at most 8MB (the engine photo limit) |
| Overlay card | `title` (the name) at most 60 characters, `subtitle` (the exact version) at most 80, `badge` (the real price) at most 30 |
| Uploaded media lifetime | Temporary engine asset, 1 hour TTL: upload shortly before generating |

## Steps

### 1. Pick the subject and the goal (ask the user)

Ask what the subject is (which car, product, gadget, or tool) and what the
video pushes: buy now, wait for the price to drop, or follow for the next
one. One question at a time, in the user's language. Nothing costs tokens
before the answers are in.

### 2. Search once, pin the identity and the price (user's agent, user's key)

From the user's agent, search the subject once with the tool the user
already has (Tavily, Exa, or the agent's own web/MCP search tool; the key
lives in `YOUR_TAVILY_API_KEY`-style variables in that environment, never in
chat). Keep at most 5 results: title, URL, and snippet, for reasoning only.
Pin, in the agent's working notes: the exact identity (model + trim + year,
or the product's generation), the price with its currency, market, and date,
and the one or two facts that make the video matter now. A price that only
one source names is attributed ("listed at"); a price the results do not
name is dropped.

### 3. Draft the script as segments

Write 3-6 segments in English, in this shape:

- `hook`: one surprising, specific fact about the subject — usually the
  real price against what it competes with. Aim for 20-30 words, end with
  terminal punctuation.
- `body`: 1-4 segments, at least 30 words in total: what the subject is,
  the exact version the price belongs to, and why it matters now. Only
  facts the step-2 results support.
- `cta`: one closing line, 5-20 words, tied to this subject (buy, wait, or
  the next subject). Never a generic "follow for more".

Total: 60-200 words. If the subject cannot fill 60 honest words, pick
another subject; do not pad with unrelated facts about the category.

### 4. Find and check the photos (before validating)

Use the same search tool's image search for the exact subject: the trim and
the year the script names, never a different generation, a render, or a
rebadged twin. Search with the disambiguating words ("GT-Line 2026
hatchback" beats the model name alone).

- Direct public image URLs only (JPG/JPEG, PNG, or WebP, at most 8MB). Call
  `check_media` with each URL first. It returns exactly one code: `ok`,
  `blocked_403`, `not_image`, `too_small`, `too_large`, `timeout`, or
  `face_detected`. Attach the URL only on `ok`. On any other code, skip
  that photo; never attach a URL that failed the check; never send a fake
  User-Agent or Referer to bypass a hotlink block.
- `face_detected` means the engine keeps faces out of segment photos (the
  persona's face is the only one on screen). For a car or a product that
  code usually means a person is in the frame: pick another angle of the
  subject, not a portrait of a reviewer.
- Local file: call `upload_media` with the local path and use the returned
  `mediaId` in one item of the segment's `media` list. Upload shortly before
  generating: the asset lives 1 hour.
- Attach at most 6 photos to at most 6 distinct segments. Fewer, chosen
  well (front three-quarter, the interior, the exact detail the script
  names), beats every photo the search returned.
- A segment without media is fine. A video with no usable photo is still a
  video; a video with a wrong-subject photo is not.

Give each photo its card in that photo's `overlay`: `title` is the
subject's name (at most 60 characters), `subtitle` the exact version or the
fact that locates it (80), `badge` the real price with its currency (30).
Drop the badge when the price is not confirmed by the results. Skip a field
the facts do not support: an empty card is not worth inventing.

### 5. Validate the script, photos included (free)

Call `validate_script` with exactly the segments from steps 3-4, media
included. It returns word counts and the hook window, or
an error naming a field and a fix. Fix and re-validate until it passes. Do
not proceed on a failed validation, and do not slim the script to pass:
pull the photos that fail instead (each skipped photo is only a card lost).

### 6. Score the draft (free)

Call `score_draft` with kind `script`, the segments joined by newlines, the
persona, and the network. Fix what its reasons name, re-validate, rescore.
The score is advice checked by rules, not proof the script is good: never
bend facts to gain points, and ask the user to decide if it stays low.

### 7. Generate and publish (this is the step that costs tokens)

Call `generate_persona_video` with: `personaId`, `segments` (the validated
script, unchanged), `title` (the subject, e.g. the model with its trim and
year), `language: "en"`, `providers` plus the per-provider account IDs from
`list_social_accounts` (or the persona's defaults from
`get_persona_publishing_accounts`), and either `mode: 'scheduled'` with
`startAt` (ISO datetime) + `times` (["HH:MM"]) in `timezone`, or
`mode: 'asap'` with no `startAt`/`times`. Reuse the same `idempotencyKey` on
retry so a retry replays the original schedule instead of generating twice.

### 8. Poll until done

Poll the returned `taskId` with `get_video_task_progress` until it
finishes. `error` is the failure reason when `state` is `-1`, `null`
otherwise. Share the final video URL from `get_video_status` with the user.

## Copy-ready prompt

Copy the current prompt from
https://post-engineer.com/recipes/subject-spotlight, or run
`/subject-spotlight` from the Post Engineer MCP server. Its text lives once
in `shared/prompt-base/prompt-base.ts`, so this page does not repeat it.

## Example input (illustrative, not a real car)

The user says: "the 2026 electric hatch with a 400 km range and a launch
price" (invented here so no real model is misquoted). The agent searches,
the results support: the "Volt 400" name it goes by, the 400 km range, the
launch price of 29,990 euros for the GT-Line trim announced this week, and
the heat-pump detail.

## Expected output (verified: passes mechanical validation)

Segments (hook 22 words, body 53 words, CTA 16 words, total 91 words,
4 segments, 2 medias):

```json
{
  "segments": [
    { "kind": "hook", "text": "The Volt 400 hatch just landed at 29,990 euros with a 400 kilometre battery, and that price is the whole launch story.",
      "media": [{ "url": "https://example.photo/volt400/front.jpg", "overlay": { "title": "Volt 400", "subtitle": "GT-Line, model year 2026", "badge": "29,990 euros" } }] },
    { "kind": "body", "text": "The launch trim is the GT-Line, and it ships with the 400 kilometre pack as standard, so the headline range is not a top-trim promise." },
    { "kind": "body", "text": "Every trim listed this week carries the heat pump, which is the detail that keeps the winter range near the summer number, and the badge price includes it.",
      "media": [{ "url": "https://example.photo/volt400/interior.jpg", "overlay": { "title": "Volt 400", "subtitle": "Heat pump on every trim", "badge": "From 29,990" } }] },
    { "kind": "cta", "text": "Save this one for your shortlist and tell me which launch price I should chase next." }
  ]
}
```

`validate_script` on exactly these segments reports `Script valid:
4 segment(s), 91 words total, hook 22 words, body 53 words, CTA 16
words.` (The web validation endpoint also returns `mediaCount: 2`; the
`validate_script` tool does not surface it.) Every `media` carries the
`overlay` card,
and every URL passed `check_media` with `ok` in this illustration. The
`generate_persona_video` call then uses these segments unchanged, plus
`title`, `language: "en"`, `providers`, account IDs, and `mode` as in
step 7.

## Tools used

- `list_personas`, `list_social_accounts`,
  `get_persona_publishing_accounts`, `get_token_balance`
  (setup and pre-flight, no tokens debited).
- `validate_script`, `score_draft` (mechanical validation, no tokens debited).
- `check_media`, `upload_media` (media checks/uploads, no tokens debited).
- `generate_persona_video` (the one call that debits tokens).
- `get_video_task_progress`, `get_video_status` (polling and final URL).

No new MCP tool is introduced by this recipe. The photos come from the
user's own search tool; the engine's internal Tavily place-photos pipeline
(`match_materials_to_script`) is a separate server-side opt-in, not part of
this prompt.

## Verification

Every tool name, field, and limit in this recipe was checked against the
code on `main` at recipe time (`apps/mcp/src/single-video-shape.ts`,
`apps/mcp/src/tools-user-media.ts`, `shared/script-segments/`,
`apps/mcp/README.md`): segment shape and word limits, `media` shape, the
overlay card fields and their 60/80/30 limits, the 8MB/1h rules,
`check_media` codes (including what `face_detected` means for a non-person
subject), and the scheduled/asap slot rules. The example segments above
were run through the shared validation source itself and return `ok` with
the counts shown. What this recipe does not prove: a real published video.
That needs a user-approved generation run with a real subject, a real
persona, and real accounts, and is a follow-up, not claimed here.

## Related

- Sibling recipe: [place-spotlight](./place-spotlight.md) — same flow for a
  place, where the identity to pin is the address and the card carries the
  opening facts instead of a model year.

## What this recipe is not

- Not the place-spotlight recipe: a place is located by an address, a
  subject is located by an identity (model, trim, year) and a price.
- Not a review or a buying recommendation: the video says what the subject
  is, which exact version the price belongs to, and why it matters now.
- Not a licence grant and not a scraping tool: the user owns the rights to
  the photos attached, and a `check_media` block is a skip, never a bypass.

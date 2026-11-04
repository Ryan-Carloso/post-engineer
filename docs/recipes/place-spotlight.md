# Recipe: place spotlight becomes a video

> MCP: `post-engineer-mcp` (use `npx -y post-engineer-mcp@latest`;
> `@latest` fetches the newest version instead of a stale cached copy).
> Status: prompt shipped in the hub. Proven mechanically (see "Verification"
> below); a real published video from this recipe is a separate, user-approved
> step, not part of this recipe file.

## Objective

Turn one real place (city, neighbourhood, venue, or business) into one short
persona video published to the user's connected social accounts. The place
shows up as its own photos on screen, each carrying the overlaid card with the
real name, the address, and one detail like a price or when it opened — the
segment media + overlay card the engine draws (see `apps/mcp/README.md`,
`upload_media`). One place, one video, one call to `generate_persona_video`.
No batch, no place list, no LLM script expansion: the agent writes the
complete script as segments, finds and checks the photos itself, validates
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
- The user's own search-tool key for facts AND image search, in the user's
  own agent environment only. Tavily is the reference example (its search
  returns image results); Exa or the agent's own web/MCP search tool works
  the same way for facts, so long as it can also return direct image URLs.
  The key is never pasted, never committed, and never appears in examples:
  write `YOUR_TAVILY_API_KEY` in prompts and keep the real value in the
  agent's own environment.

## Rules that never change

- One place per video. A round-up of five places is five videos, not one.
- Facts: only what the search results support. If the price, the address, or
  the opening details are not in the results, drop the claim or ask the user;
  never invent a detail to fill the on-screen card.
- Language is English only (`language` must be exactly `en`, e.g. `en-US`).
  The script is spoken text only: no links, hashtags, markdown, emoji, or
  stage directions in any segment.
- Photos: only photos of the actual place the video spotlights. A generic
  stock photo of the country is worse than no photo. Media rights are the
  user's responsibility; prefer sources with a usable licence. Many sites
  block hotlinking; a blocked photo is skipped, it never kills the video.
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
| Medias per video | At most 6; a segment's `media` is a strict object with exactly one of `mediaId` (from `upload_media`) or `url` (a public image URL) |
| Segment media image | JPG/JPEG, PNG, or WebP; at most 8MB (the engine photo limit) |
| Overlay card | `title` (the place name) at most 60 characters, `subtitle` (address/district) at most 80, `badge` (price or era) at most 30 |
| Uploaded media lifetime | Temporary engine asset, 1 hour TTL: upload shortly before generating |

## Steps

### 1. Pick the place and the goal (ask the user)

Ask which place and what the video pushes: visit now, book early, or follow
for the next place. One question at a time, in the user's language. Nothing
costs tokens before the answers are in.

### 2. Search the facts once (user's agent, user's key)

From the user's agent, search the place once with the tool the user already
has (Tavily, Exa, or the agent's own web/MCP search tool; the key lives in
`YOUR_TAVILY_API_KEY`-style variables in that environment, never in chat).
Keep at most 5 results: title, URL, and snippet, for reasoning only. Collect
only what matters to the video: what the place is, opening or booking facts,
the address, one price or era, one reason it matters now.

### 3. Draft the script as segments

Write 3-6 segments in English, in this shape:

- `hook`: one surprising, specific fact about the place. Aim for 20-30
  words, end with terminal punctuation.
- `body`: 1-4 segments, at least 30 words in total: what the place is, where
  it is, and why it matters now. Only facts the step-2 results support.
- `cta`: one closing line, 5-20 words, tied to this place (visit, book, or
  the next place). Never a generic "follow for more".

Total: 60-200 words. If the place cannot fill 60 honest words, pick another
place; do not pad with unrelated facts about the city.

### 4. Find and check the photos (before validating)

Use the same search tool's image search for the actual place: its facade,
its interior, or the concrete detail the script names, never generic stock
of the city or country. Tavily's search endpoint returns image results
(split the place name from generic terms when a famous city name floods the
results: "A Brasileira café Lisbon" beats "Lisbon").

- Direct public image URLs only (JPG/JPEG, PNG, or WebP, at most 8MB). Call
  `check_media` with each URL first. It returns exactly one code: `ok`,
  `blocked_403`, `not_image`, `too_small`, `too_large`, `timeout`, or
  `face_detected`. Attach the URL only on `ok`. On any other code, skip
  that photo; never attach a URL that failed the check; never send a fake
  User-Agent or Referer to bypass a hotlink block.
- Local file: call `upload_media` with the local path and use the returned
  `mediaId` in the segment's `media` field. Upload shortly before
  generating: the asset lives 1 hour.
- Attach at most 6 photos to at most 6 distinct segments. Fewer, chosen
  well (facade, the menu, the thing the script names), beats every photo
  the search returned.
- A segment without media is fine. A video with no usable photo is still a
  video; a video with a wrong-place photo is not.

Give each photo its card in that segment's `media.overlay`: `title` is the
place's real name (at most 60 characters), `subtitle` the address or
district (80), `badge` one detail such as a price or when it opened (30).
Skip a field the facts do not support: an empty card is not worth inventing.

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
script, unchanged), `title` (the place, e.g. "Casa dos Mapas, Porto"),
`language: "en"`, `providers` plus the per-provider account IDs from
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

Copy the current prompt from https://post-engineer.com/recipes/place-spotlight,
or run `/place-spotlight` from the Post Engineer MCP server. Its text lives
once in `shared/prompt-base/prompt-base.ts`, so this page does not repeat it.

## Example input (illustrative, not a real place)

The user says: "a downtown café that opened in 1913 and serves olive oil
cake" (invented here so no real venue is misquoted). The agent searches, the
results support: opened 1913, conventual-style olive oil cake, two blocks
from the river, cash-only door ring.

## Expected output (verified: passes mechanical validation)

Segments (hook 21 words, body 53 words, CTA 17 words, total 91 words,
4 segments, 3 medias):

```json
{
  "segments": [
    { "kind": "hook", "text": "This café has been pouring coffee since 1913, and the olive oil cake on the counter follows the founders' handwritten note.",
      "media": { "url": "https://example.photo/cafe/facade.jpg", "overlay": { "title": "Casa dos Mapas", "subtitle": "Rua do Rio 12, downtown", "badge": "Since 1913" } } },
    { "kind": "body", "text": "The founders wrote the olive oil cake by hand, and the kitchen still bakes from that note: dense, citrus-heavy, and unlike anything a modern patisserie sells near you.",
      "media": { "url": "https://example.photo/cafe/cake-counter.jpg", "overlay": { "title": "Casa dos Mapas", "subtitle": "Two blocks from the river", "badge": "Olive oil cake" } } },
    { "kind": "body", "text": "It sits two blocks from the river, the ring at the door still decides who is in, and cash is the only language it speaks.",
      "media": { "url": "https://example.photo/cafe/door-ring.jpg", "overlay": { "title": "Casa dos Mapas", "subtitle": "Cash only, closes at six", "badge": "Downtown" } } },
    { "kind": "cta", "text": "Save this café for your next downtown morning and tell me which door I should ring next." }
  ]
}
```

`validate_script` on exactly these segments reports `Script valid:
4 segment(s), 91 words total, hook 21 words, body 53 words, CTA 17
words.` (The web validation endpoint also returns `mediaCount: 3`; the
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
`check_media` codes, and the scheduled/asap slot rules. The example
segments above were run through the shared validation source itself and
return `ok` with the counts shown. What this recipe does not prove: a real
published video. That needs a user-approved generation run with a real
place, a real persona, and real accounts, and is a follow-up, not claimed
here.

## Discovery

This recipe is listed on the web recipes page at `/recipes` (title + one-line
objective, linking to this doc), served as the `/place-spotlight` slash
command by the MCP server, and linked from the MCP README Links section. The
page is an initial version, intentionally minimal, and the user will improve
it later.

## Related

- Sibling recipe: [subject-spotlight](./subject-spotlight.md) — the same flow
  for a subject that is not a place (a car, a product): the identity to pin is
  the model/trim/year and the card carries the real price instead of opening
  facts.

## What this recipe is not

- Not the daily-news recipe (recipe 1) and not its photo rules alone: the
  spotlight's script leads with the place itself, and every photo must show
  the place the video names.
- Not a review or a ranking: the video never claims "the best"; it says what
  the place is, where, and why it matters now.
- Not a licence grant and not a scraping tool: the user owns the rights to
  the photos attached, and a `check_media` block is a skip, never a bypass.

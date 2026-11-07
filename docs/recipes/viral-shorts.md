# Recipe: a viral video becomes your Short

> Status: viral-structure recipe. It learns from the most-viewed video
> in the user's niche and writes a fresh Shorts script in the user's own
> voice — hook, content, CTA — instead of starting from a blank page.

## The prompt lives once, in the hub

The full ordered prompt — niche question, top-5 search by views, study
of the top video without downloading it, structure breakdown, fresh
script, validation, scoring, and the single `generate_persona_video`
call — is served from the prompts hub, not repeated here:

**https://post-engineer.com/recipes/viral-shorts**

Its text lives once in `shared/prompt-base/prompt-base.ts` and is imported
by the hub; the MCP fetches it from the web API. Do not paste the prompt
steps, rules, or tool calls into this doc: an edit to the prompt must
reach the hub, the MCP, and this page from that one source, with no
hand-maintained copy to drift.

In short: the agent finds what already works in the niche, studies how
the top video is built, and writes a new script in that structure from
the user's own content, with a fresh angle. The video itself is never
downloaded, cut, or re-uploaded: `yt-dlp` is used for metadata and
subtitles only (`--skip-download`), and the "cut" is the user's
brand-new video.

View count is treated as popularity, not retention: since 2026-08-24
YouTube counts a view at play start, and another creator's retention is
private. So the breakdown words every hook conclusion as a hypothesis
and reports `retention_evidence: 'unavailable'` with the source URL and
the fetch date.

## Prerequisites (not part of the prompt)

- A Post Engineer account and an API key from
  https://post-engineer.com/recipes, in the agent's local MCP configuration as
  `POST_ENGINEER_API_KEY`. The prompts hub can fill a freshly created key into
  its own setup prompt for you; never paste the key anywhere else — no other
  chat, prompt, or this repo. Use `npx -y post-engineer-mcp@latest` so the MCP
  is the newest version instead of a stale cached copy.
- `yt-dlp` installed in the agent's own environment (`pip install
  yt-dlp`). It is not in the repo and no new dependency is added: it is
  an agent-side instruction only. If it is missing, the prompt tells the
  user to install it instead of failing silently.
- A persona (`personaId` from `list_personas`), or a faceless setup
  (`options.faceless` plus `options.voiceId` or `options.audioUrl`).
- A token balance that covers one video: check with `get_token_balance`
  before generating. Generation costs tokens; `validate_script` and
  `score_draft` do not debit tokens.

## Example

**Input:** the most-viewed video in your niche this year.

**Output:** one validated 60–200 word script in the viral structure —
your facts, your voice — one `generate_persona_video` call in the
confirmed mode, and the published video URL in the chat.

# Recipe: last 30 days become a video

> Status: niche-freshness recipe. It turns what happened in the user's
> niche in the last 30 days into one persona video, instead of a
> timeless explainer.

## The prompt lives once, in the hub

The full ordered prompt — niche question, 30-day web search, facts-only
script, validation, scoring, and the single `generate_persona_video`
call — is served from the prompts hub, not repeated here:

**https://post-engineer.com/recipes/last-30-days**

Its text lives once in `shared/prompt-base/prompt-base.ts` and is imported
by the hub; the MCP fetches it from the web API. Do not paste the prompt
steps, rules, or tool calls into this doc: an edit to the prompt must
reach the hub, the MCP, and this page from that one source, with no
hand-maintained copy to drift.

In short: the agent searches the web for what happened in the niche in
the last 30 days, picks the one clearest single event with a named
place, person, or number, and writes one script from only the facts
those results support. Validation runs before any token is spent.

## Prerequisites (not part of the prompt)

- A Post Engineer account and an API key from
  https://post-engineer.com/recipes, in the agent's local MCP configuration as
  `POST_ENGINEER_API_KEY`. The prompts hub can fill a freshly created key into
  its own setup prompt for you; never paste the key anywhere else — no other
  chat, prompt, or this repo. Use `npx -y post-engineer-mcp@latest` so the MCP
  is the newest version instead of a stale cached copy.
- A search tool in the agent's own environment (Tavily, Exa, or the
  agent's own web search). If it needs a key, the key lives in the
  agent's own environment as `YOUR_TAVILY_API_KEY` or `YOUR_EXA_API_KEY`;
  it is never pasted, never committed, and never appears in examples.
- A persona (`personaId` from `list_personas`), or a faceless setup
  (`options.videoType: 'faceless'` plus `options.voiceId` or `options.audioUrl`).
- A token balance that covers one video: check with `get_token_balance`
  before generating. Generation costs tokens; `validate_script` and
  `score_draft` do not debit tokens.

## Example

**Input:** a niche event from the last 30 days with a named place.

**Output:** one validated 60–200 word script from only the facts the
search results support, one `generate_persona_video` call in the
confirmed mode, and the published video URL in the chat.

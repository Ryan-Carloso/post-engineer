# Recipe: daily news becomes a video

> MCP: `post-engineer-mcp` (use `npx -y post-engineer-mcp@latest`;
> `@latest` fetches the newest version instead of a stale cached copy).
> Status: first recipe. A real published video from this recipe is a
> separate, user-approved step, not part of this file.

## The prompt lives once, in the hub

The full ordered prompt — one story, the script contract, media, validation,
and the single `generate_persona_video` call — is served from the prompts
hub, not repeated here:

**https://post-engineer.com/recipes/daily-news**

Its text lives once in `shared/prompt-base/prompt-base.ts` and is imported
by the hub; the MCP fetches it from the web API. Do not paste the prompt
steps, rules, or tool calls into this doc: an edit to the prompt must
reach the hub, the MCP, and this page from that one source, with no
hand-maintained copy to drift.

In short: the agent turns one news story of the day into one short persona
video. One story, one video, one `generate_persona_video` call. Validation
runs before any token is spent.

## Prerequisites (not part of the prompt)

- A Post Engineer account and an API key from
  https://post-engineer.com/recipes, in the agent's local MCP configuration as
  `POST_ENGINEER_API_KEY`. The prompts hub can fill a freshly created key into
  its own setup prompt for you; never paste the key anywhere else — no other
  chat, prompt, or this repo. Use `npx -y post-engineer-mcp@latest` so the MCP
  is the newest version instead of a stale cached copy.
- A persona (`personaId` from `list_personas`), or a faceless setup
  (`options.faceless` plus `options.voiceId` or `options.audioUrl`).
- A token balance that covers one video: check with `get_token_balance`
  before generating. Generation costs tokens; `validate_script` does not.
- The user's own news API key, in the user's own agent environment only.
  This recipe uses GNews as the example source. The key is never pasted,
  never committed, and never appears in examples: the name `YOUR_GNEWS_KEY`
  stands for that value, which stays in the agent's own environment.

## Example

**Input:** one GNews-style story with a named place (invented here so no
real story is misquoted): a riverside city opens a twelve-acre park.

**Output:** one validated script from only the facts that story supports,
one `generate_persona_video` call in the confirmed mode, and the published
video URL in the chat.

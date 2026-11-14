# Recipe: place spotlight becomes a video

> MCP: `post-engineer-mcp` (use `npx -y post-engineer-mcp@latest`;
> `@latest` fetches the newest version instead of a stale cached copy).
> Status: prompt shipped in the hub. A real published video from this
> recipe is a separate, user-approved step, not part of this file.

## The prompt lives once, in the hub

The full ordered prompt — the place and the goal, a facts search, the
place's own photos with overlay cards, validation, scoring, and the single
`generate_video` call — is served from the prompts hub, not
repeated here:

**https://post-engineer.com/recipes/place-spotlight**

Its text lives once in `shared/prompt-base/prompt-base.ts` and is imported
by the hub; the MCP fetches it from the web API. Do not paste the prompt
steps, rules, or tool calls into this doc: an edit to the prompt must
reach the hub, the MCP, and this page from that one source, with no
hand-maintained copy to drift.

In short: one real place becomes one persona video. The place shows up as
its own photos, each with the real name, the address, and one supported
detail. One place, one video, one `generate_video` call. Validation
runs before any token is spent.

## Prerequisites (not part of the prompt)

- A Post Engineer account and an API key from
  https://post-engineer.com/recipes, in the agent's local MCP configuration as
  `POST_ENGINEER_API_KEY`. The prompts hub can fill a freshly created key into
  its own setup prompt for you; never paste the key anywhere else — no other
  chat, prompt, or this repo. Use `npx -y post-engineer-mcp@latest` so the MCP
  is the newest version instead of a stale cached copy.
- A persona (its name or id from `personas (action: list)`), or a faceless setup
  (`options.videoType: 'faceless'` plus `options.voiceId` or `options.audioUrl`).
- A token balance that covers one video: check with `billing (action: balance)`
  before generating. Generation costs tokens; `check_script (action: validate)` does not.
- A search tool in the agent's own environment (Tavily, Exa, or the agent's
  own web search) that can return facts and direct image URLs. If it needs
  a key, the key lives in the agent's own environment as
  `YOUR_TAVILY_API_KEY` or `YOUR_EXA_API_KEY`. It is never pasted, never
  committed, and never appears in examples.

## Example

**Input:** a downtown café the user names. The search supports an opening
year of 1913, an olive oil cake, and a cash-only door (invented here so no
real venue is misquoted).

**Output:** one validated script about that place, photos of the place
itself on the segments, one `generate_video` call, and the published
video URL in the chat.

## Related

- Sibling recipe: [subject-spotlight](./subject-spotlight.md) — the same
  kind of video for a car, a product, or another subject that is not a place.

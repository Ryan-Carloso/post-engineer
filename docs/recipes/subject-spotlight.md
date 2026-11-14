# Recipe: subject spotlight becomes a video

> MCP: `post-engineer-mcp` (use `npx -y post-engineer-mcp@latest`;
> `@latest` fetches the newest version instead of a stale cached copy).
> Status: prompt shipped in the hub. A real published video from this
> recipe is a separate, user-approved step, not part of this file.

## The prompt lives once, in the hub

The full ordered prompt — the subject and the goal, identity and price,
photos of that exact subject with overlay cards, validation, scoring, and
the single `generate_video` call — is served from the prompts hub,
not repeated here:

**https://post-engineer.com/recipes/subject-spotlight**

Its text lives once in `shared/prompt-base/prompt-base.ts` and is imported
by the hub; the MCP fetches it from the web API. Do not paste the prompt
steps, rules, or tool calls into this doc: an edit to the prompt must
reach the hub, the MCP, and this page from that one source, with no
hand-maintained copy to drift.

In short: one concrete subject (a car, a product, a gadget, a tool) becomes
one persona video. The photos show that subject, with the real name, the
exact version, and the real price when the search supports it. One subject,
one video, one `generate_video` call. Validation runs before any
token is spent.

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

**Input:** an electric hatch the user names. The search supports a model
year, a range, and a launch price for one trim (invented here so no real
model is misquoted).

**Output:** one validated script about that subject, photos of that subject
on the segments, one `generate_video` call, and the published video
URL in the chat.

## Related

- Sibling recipe: [place-spotlight](./place-spotlight.md) — the same kind of
  video for a place, with the address on the card instead of a product price.

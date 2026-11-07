# Recipe: one week, one video per network

> Status: weekly multi-network recipe. It publishes one video per
> network in the same week — LinkedIn, YouTube, Instagram, Bluesky —
> from one weekly topic, each script scored for its own network.

## The prompt lives once, in the hub

The full ordered prompt — niche and week questions, one topic for the
week, one script per network, per-network validation and scoring,
week confirmation, and one `generate_persona_video` call per network —
is served from the prompts hub, not repeated here:

**https://post-engineer.com/recipes/multi-rede**

Its text lives once in `shared/prompt-base/prompt-base.ts` and is imported
by the hub; the MCP fetches it from the web API. Do not paste the prompt
steps, rules, or tool calls into this doc: an edit to the prompt must
reach the hub, the MCP, and this page from that one source, with no
hand-maintained copy to drift.

In short: the same week, the same persona, one video per network. Same
facts everywhere, never invented per network. Each script is validated
and scored for its own network before any token is spent, and the whole
week is confirmed once before generating.

## Prerequisites (not part of the prompt)

- A Post Engineer account and an API key from
  https://post-engineer.com/recipes, in the agent's local MCP configuration as
  `POST_ENGINEER_API_KEY`. The prompts hub can fill a freshly created key into
  its own setup prompt for you; never paste the key anywhere else — no other
  chat, prompt, or this repo. Use `npx -y post-engineer-mcp@latest` so the MCP
  is the newest version instead of a stale cached copy.
- Connected accounts on the networks the week includes
  (`list_social_accounts`): LinkedIn, YouTube, Instagram, Bluesky. A
  network with no connected account is skipped for that week.
- A persona (`personaId` from `list_personas`), or a faceless setup
  (`options.faceless` plus `options.voiceId` or `options.audioUrl`).
- A token balance that covers one video per network: check with
  `get_token_balance` before generating. Generation costs tokens;
  `validate_script` and `score_draft` do not debit tokens.

## Example

**Input:** one weekly topic for LinkedIn, YouTube, Instagram, and Bluesky.

**Output:** four validated scripts (one per network), four
`generate_persona_video` calls in the confirmed mode, and the published
video URLs in the chat.

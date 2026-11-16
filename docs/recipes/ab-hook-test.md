# Recipe: test two hooks (A/B)

> MCP: `post-engineer-mcp` (use `npx -y post-engineer-mcp@latest`;
> `@latest` fetches the newest version instead of a stale cached copy).
> Status: hub recipe for a paired hook experiment. Publishing the videos
> is a separate, user-approved step, not part of this file.

## The prompt lives once, in the hub

The full ordered prompt — faceless as the cheapest test, the experiment,
the pairs, and when a variant may be called the winner — is served from
the prompts hub, not repeated here:

**https://post-engineer.com/recipes/ab-hook-test**

Its text lives once in `shared/prompt-base/prompt-base.ts` and is imported
by the hub; the MCP fetches it from the web API. Do not paste the prompt
steps, rules, or tool calls into this doc: an edit to the prompt must
reach the hub, the MCP, and this page from that one source, with no
hand-maintained copy to drift.

In short: one experiment compares two hooks. Faceless is the cheapest
test. The agent waits for publication and metrics, reads the result, and
names a winner only when the label is clear.

## Prerequisites (not part of the prompt)

- A Post Engineer account and an API key from
  https://post-engineer.com/recipes, in the agent's local MCP configuration as
  `POST_ENGINEER_API_KEY`. The prompts hub can fill a freshly created key into
  its own setup prompt for you; never paste the key anywhere else — no other
  chat, prompt, or this repo. Use `npx -y post-engineer-mcp@latest` so the MCP
  is the newest version instead of a stale cached copy.
- A voice (`voices (action: list)`). A faceless experiment has no persona.
- A token balance that covers the pairs: check with `billing (action: balance)`
  before creating them. Each faceless video costs 1 token.

## Example

**Input:** compare a calm hook with a direct hook, faceless, on one niche.

**Output:** one experiment, pairs of videos that differ only in the hook,
and a result. No variant is called the winner unless the label is clear.

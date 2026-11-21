# Recipe: compare two prompts (A/B)

> MCP: `post-engineer-mcp` (use `npx -y post-engineer-mcp@latest`;
> `@latest` fetches the newest version instead of a stale cached copy).
> Status: hub recipe for a prompt comparison. Publishing the videos
> is a separate, user-approved step, not part of this file.

## The prompt lives once, in the hub

The full ordered prompt — which two prompts, one account, the alternating
calendar with swapped times, and when a prompt may be called the winner — is
served from the prompts hub, not repeated here:

**https://post-engineer.com/recipes/compare-prompts**

Its text lives once in `shared/prompt-base/prompt-base.ts` and is imported
by the hub; the MCP fetches it from the web API. Do not paste the prompt
steps, rules, or tool calls into this doc: an edit to the prompt must
reach the hub, the MCP, and this page from that one source, with no
hand-maintained copy to drift.

In short: an experiment is a comparison of prompts. Every video records the
prompt version it was written from, and the results compare the versions
inside one account. The agent alternates the two prompts on the same account,
swaps their posting times every day, and names a winner only when the label
is clear.

## How a video records its prompt

- `prompts (action: get)` returns the prompt with its `versionId`.
- `generate_video` takes that `versionId` as `promptVersionId` on each video.
- Editing a prompt's text creates a new version; the old one is kept, so old
  videos still name the exact text they used.
- `experiments (action: results)` and the Experiments page group the videos
  per account and per prompt version.

## Prerequisites (not part of the prompt)

- A Post Engineer account and an API key from
  https://post-engineer.com/recipes, in the agent's local MCP configuration as
  `POST_ENGINEER_API_KEY`. The prompts hub can fill a freshly created key into
  its own setup prompt for you; never paste the key anywhere else — no other
  chat, prompt, or this repo. Use `npx -y post-engineer-mcp@latest` so the MCP
  is the newest version instead of a stale cached copy.
- Two prompts that differ only in what you test, for example two of your own
  prompts in `prompt_library`.
- A token balance that covers the videos: check with `billing (action: balance)`
  first. Each faceless video costs 1 token.

## Example

**Input:** my calm-hook prompt against my direct-hook prompt, faceless, on my
YouTube.

**Output:** 10 videos alternated over 5 days on one account, each recording its
prompt version, and a comparison. No prompt is called the winner unless the
label is clear.

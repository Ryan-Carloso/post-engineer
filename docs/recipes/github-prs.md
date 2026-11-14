# Prompt: GitHub PRs become videos

> MCP: `post-engineer-mcp` (use `npx -y post-engineer-mcp@latest`;
> `@latest` fetches the newest version instead of a stale cached copy).
> Status: first prompt entry for this use. A real published video from
> this prompt is a separate, user-approved step, not part of this file.

## The prompt lives once, in the hub

The full ordered prompt — which pull request, the script contract, media
only when it matches the change, and the single `generate_video`
call — is served from the prompts hub, not repeated here:

**https://post-engineer.com/recipes/github-prs**

Its text lives once in `shared/prompt-base/prompt-base.ts` and is imported
by the hub; the MCP fetches it from the web API. Do not paste the prompt
steps, rules, or tool calls into this doc: an edit to the prompt must
reach the hub, the MCP, and this page from that one source, with no
hand-maintained copy to drift.

In short: one pull request becomes one persona video. The agent asks for
the title, the description, or the change summary when it cannot read them,
and it does not invent those details. Validation runs before any token is
spent.

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

## Example

**Input:** a pull request titled "Add retry with backoff to video uploads,"
with a description of transient 5xx failures and a change that retries them.

**Output:** one validated script about that change, one
`generate_video` call, and the published video URL in the chat.

# Prompt: write scripts story-first

> MCP: `post-engineer-mcp` (use `npx -y post-engineer-mcp@latest`;
> `@latest` fetches the newest version instead of a stale cached copy).
> Status: hub prompt for story-first scripts. Publishing the video
> is a separate, user-approved step, not part of this file.

## The prompt lives once, in the hub

The full ordered prompt — one micro-arc per video, the hook mechanisms,
and the watch-through rules — is served from the prompts hub, not
repeated here:

**https://post-engineer.com/recipes/story-first-reels**

Its text lives once in `shared/prompt-base/prompt-base.ts` and is imported
by the hub; the MCP fetches it from the web API. Do not paste the prompt
steps, rules, or tool calls into this doc: an edit to the prompt must
reach the hub, the MCP, and this page from that one source, with no
hand-maintained copy to drift.

In short: one story per video — a real, concrete, lived first-person
story about one concrete day, plausible in real life, never a generic
explainer and never a random anecdote. "The day it happened to me" is
one valid form, not the only one: a first time, a week, a realization,
a repeating ritual, or a before/after arc. A documentary, a study, or
a fact is transformed into a concrete story lived by someone: the fact
goes inside the story, never as exposition. Every fact is researched
before it is asserted — mechanisms, hormones, numbers, deadlines —
never invented; a fact that cannot be confirmed is cut from the script.
Media is mixed: AI photos, real photos, and licensed stock photos,
with one consistent persona for the whole video whenever the persona
appears, never unlicensed media. Photos only: the engine renders
segment media as photos and cannot use video (b-roll) as segment
media yet.
The agent finds the real story first (setup, turning point,
payoff), builds the hook from one mechanism that fits, writes for
watch-through, and follows the base: validate, score, confirm, then
generate once. Every emotional beat is visible in the image, the
rhythm varies take by take, every sentence gets its own image, and
every image is sharp, well-lit, and on-topic.

## Prerequisites (not part of the prompt)

- A Post Engineer account and an API key from
  https://post-engineer.com/recipes, in the agent's local MCP configuration as
  `POST_ENGINEER_API_KEY`. The prompts hub can fill a freshly created key into
  its own setup prompt for you; never paste the key anywhere else — no other
  chat, prompt, or this repo. Use `npx -y post-engineer-mcp@latest` so the MCP
  is the newest version instead of a stale cached copy.
- A token balance that covers the video: check with `billing (action: balance)`
  before generating. Each faceless video costs 1 token.

## Example

**Input:** HabitLoom, faceless, why the weight comes back after a diet.

**Output:** hook on the regain, content on the hidden cause, CTA to save it — 88 words, 3 segments.

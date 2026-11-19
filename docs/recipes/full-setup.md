# Recipe: full setup becomes a video

> Status: end-to-end onboarding recipe. It chains account connection, persona
> creation, a validated script, and one real publish. It is the onboarding
> recipe for a fresh account; see `daily-news.md` for the day-two loop.

## The prompt lives once, in the hub

The full ordered prompt — account connection, persona creation, script
contract, publish confirmation, and the single `generate_video`
call — is served from the prompts hub, not repeated here:

**https://post-engineer.com/recipes/full-setup**

Its text lives once in `shared/prompt-base/prompt-base.ts` and is imported
by the hub; the MCP fetches it from the web API. Do not paste the prompt
steps, rules, or tool calls into this doc: an edit to the prompt must
reach the hub, the MCP, and this page from that one source, with no
hand-maintained copy to drift.

In short: the user goes from zero (no connected accounts, no persona) to
one published persona video in a single ordered flow. Setup checks the
saved tool configuration first, asks once for what is missing (which
licensed stock video sources the user already has keys for; the search
tool is asked once in the base prompt), saves the answers, and reuses
them for later videos and later conversations; the first video uses images
only. If a source fails, the agent tries the next configured source, best
match first, and uses photos only if every configured source fails.
Validation runs before any token is spent, the publish is real (the agent says so and
confirms the providers/accounts and the mode, `scheduled` or `asap`,
before generating), and Bluesky is optional — one provider among the
accounts the user chooses, skipped or connected with an app password,
never a blocker.

## Prerequisites (not part of the prompt)

- A Post Engineer account and an API key from
  https://post-engineer.com/recipes, in the agent's local MCP configuration as
  `POST_ENGINEER_API_KEY`. The prompts hub can fill a freshly created key into
  its own setup prompt for you; never paste the key anywhere else — no other
  chat, prompt, or this repo. Use `npx -y post-engineer-mcp@latest` so the MCP
  is the newest version instead of a stale cached copy.
- For youtube, instagram, and linkedin: OAuth. The user finishes the
  provider's OAuth link in their own browser; only the accounts they choose
  get connected.
- For Bluesky (optional): the user gives the Bluesky app password to the agent
  only for `accounts (action: connect)`; the agent never repeats, prints, or logs it —
  not in chat, not in a file. The user creates it in their Bluesky security
  settings if they do not have one.
- Script planning answers: what the user's channel is about, and the persona
  details (name, face pick, voice pick, language English-only, niche).
- Which tools the user already has: the agent checks the saved tool
  configuration first (`tool_config` `get`), asks once at setup for what
  is missing, and saves the answers (`tool_config` `save`, keys included,
  stored encrypted, never shown back in full) so a later conversation
  reuses them instead of asking again: the licensed stock video sources
  (Pexels, Pixabay, Coverr, or none), asked in order, best match first,
  falling back to the next configured source on failure. The search tool
  for facts (Tavily, Exa, or the agent's own web or MCP search tool) is
  asked once in the base prompt and reused the same way. The keys live
  in the agent's own environment as `YOUR_TAVILY_API_KEY`,
  `YOUR_EXA_API_KEY`, `YOUR_PEXELS_API_KEY`, `YOUR_PIXABAY_API_KEY`, or
  `YOUR_COVERR_API_KEY`; never paste one in chat, in a prompt, or in
  this repo.

## Example

**Input:** a user with zero accounts and no persona, asking for their first
video.

**Output:** the accounts the user chose connected (OAuth, or Bluesky with an
app password), one persona created from their face and voice pick, a validated
60–200 word script, one `generate_video` call in the confirmed mode,
and the published video URL in the chat.

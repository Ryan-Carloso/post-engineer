// Shared prompt base: single source of truth for the web prompts hub and
// the MCP prompts hub. Every served prompt is composed as
// [...SHARED_PROMPT_BASE, '', ...specificLines].join('\n'), so the
// delivered text is complete and standalone: the agent receives the
// whole prompt in one paste, never a bare "see the base prompt"
// reference.
// DO NOT EDIT this copy directly in apps/web or apps/mcp: there is no
// copy there anymore. Both hubs read this file through a symlink —
// apps/web/lib/generation/prompt-base.ts and apps/mcp/src/prompt-base.ts.
// A direct import is not an option: each app's tsc rootDir (apps/web,
// apps/mcp/src) rejects it with TS6059, widening the MCP rootDir would
// move dist/index.js, and Stryker's sandbox copies only the app root,
// so a direct web import breaks mutation testing. The symlinks are
// dereferenced by tsc, webpack, vitest, and Stryker, so every tool sees
// the shared content as a local file. Edit here and both hubs pick it
// up; there is no sync step and no generated copy to drift. The
// per-app prompt-base-shared tests fail loudly if a copy ever
// reappears, so a stale copy can never pass CI silently.
// Rules that apply to every prompt go in SHARED_PROMPT_BASE. Topic-specific
// steps go in the prompt that owns them, below, so the base stays short and
// every prompt stays cheap. Web and MCP serve these exports unchanged.
// This file has no imports, so the same bytes compile under the web
// bundler resolution and the MCP NodeNext resolution.

export const SHARED_PROMPT_BASE: string[] = [
  'Ask me, do not make me fill anything in:',
  'Before any step that costs tokens, call list_personas, list_social_accounts, and get_token_balance, then ask only what you still need. Offer my real personas and accounts as choices. Ask one short question at a time, in the language I write in.',
  'Ask which persona, which accounts, one video or a routine (daily or weekly), and publish now or at what date, time, and timezone.',
  'Routines: Post Engineer has no recurring schedule; one generate_persona_video call makes and publishes one video. For a routine, rerun this prompt from your own scheduler if you have one, or schedule several videos ahead, at most 30 days out, each spending tokens. Tell me which you can do; never promise automatic posting you did not set up.',
  'Before generating, show me the persona, accounts, title, and time, and wait for my yes: the post is real and spends tokens. Once I approve a routine, its runs reuse those answers and need no new yes.',
  '',
  'Write like a human, never like generic AI:',
  'Facts: use concrete detail from the source: names, places, numbers. Only facts the source supports; if a detail is missing, ask me or leave it out, never invent it. Name who said it, never "experts say".',
  'Voice: if I share a sample of my writing, match its words and rhythm. If the persona niche does not say who this video is for, ask me.',
  'Hook: its only job is to make me want the next sentence. Open a question I need answered, break what I expect, drop me into a specific moment, name a payoff, or lead with a named fact. Draft three on different angles and keep the strongest. Never promise more than the video delivers. No "have you ever wondered" or "did you know".',
  'Body: one idea, in plain spoken sentences of mixed length. Say who did what: no "mistakes were made", no "the data tells us". Most lines stay plain; allow one or two punchy moments.',
  'CTA: one specific action tied to this video, never a generic "follow for more".',
  "Cut: unlock, elevate, seamless, game-changer, next-level, delve, \"the future of\", \"a new era\", \"it's not just X, it's Y\", forced groups of three, runs of fragments, \"let's dive in\", \"here's the thing\", \"honestly?\", upbeat closers, all-caps emphasis, stacked hedges, filler.",
  'No em dashes. Do not sand off real voice: one short line or one "however" is fine; clusters of these habits are the problem.',
  'Test each line: could I picture it, could it be proven true or false, and could another creator say it about another topic? If yes to the last, rewrite it.',
  'Before validate_script, read it aloud and ask what still sounds like AI and which fact is not in the source. Fix both.',
  '',
  'Verify before you state it:',
  'When a script needs a fact you are not sure about, search the web BEFORE stating it. If you have a doubt, search first, then speak.',
  'Ask me once which search tool you already have: Tavily, Exa, or your own web or MCP search tool. Reuse that choice in this conversation; if only one tool is configured, use it without asking which. If it needs a key, the key lives in your own environment as YOUR_TAVILY_API_KEY or YOUR_EXA_API_KEY: never print it, never paste it anywhere else, never log it, and never ask me to paste it in chat. If it is missing, tell me to set it and stop that fact; do not invent it.',
  'If the topic is entirely external (news, a place guide, an explainer about the world), search once first and keep at most 5 results: title, URL, and snippet for reasoning only; spoken segments never carry links. Write the script using ONLY facts from those results.',
  'If search returns nothing or cannot confirm a fact, leave that fact out or ask me; never state an uncertain fact as a fact, and never invent a replacement fact to fill the gap.',
  'If the source is already given (a GitHub PR I gave, a news story I gave, a personal opinion or story), use that source and do not force a search.',
  '',
  'Script contract, every video script follows it:',
  'Segments: first hook, last CTA, exactly one of each, at least one body, at most 12 segments.',
  'Length: 60–200 words total; hook 15–40 words, aim for 20–30 (8–12 seconds), ending with terminal punctuation; body at least 30 words; CTA 5–20 words.',
  'Spoken English only, language "en": no links, hashtags, markdown, emoji, or stage directions in any segment.',
  'Propose a title; it is mandatory with every generate_persona_video call.',
  'Call validate_script with the segments and fix any named error until it passes. Validate before any token is spent; never generate from an unvalidated script.',
  'Then call score_draft with kind "script", the segments joined by newlines, the persona, and the network; it spends no tokens. Show me the score and every reason, fix what it names, re-validate, and score again. The score is advice checked by rules, not proof the script is good: never bend facts to gain points, and ask me to decide if it stays low.',
  '',
  'Generation is always tied to publishing:',
  'One generate_persona_video call generates and publishes the video; there is no orphan video and no separate schedule step.',
  'mode "scheduled" needs startAt (ISO datetime, 3h-30d ahead), times (HH:MM), and timezone; mode "asap" needs no startAt or times.',
];

export const FULL_SETUP_PROMPT = [
  ...SHARED_PROMPT_BASE,
  '',
  'Set up Post Engineer end to end and publish your first video. Follow the',
  'steps in order; do not skip ahead of validation or the publish confirmation.',
  '',
  '1. Call list_social_accounts. Ask which of youtube, instagram, linkedin',
  '   the user wants; for each one that is missing, call connect_account with',
  '   that provider and hand the returned https OAuth link to the user to',
  '   finish in the browser, then re-check with list_social_accounts.',
  '2. Bluesky is optional. If the user wants it, ask for the handle and the',
  '   app password (never the main password); use the app password only in',
  '   connect_account and never repeat, print, or log it.',
  '3. Ask what the channel is about and what to call the persona. Call',
  '   list_faces and list_voices, let the user pick a face and a voice,',
  '   then call create_persona with name, avatarUrl, voiceId,',
  '   language "en-US" (English only for now) and niche. Remember the personaId.',
  '4. Call get_token_balance first, ask what the first video is about, then',
  '   write the script as segments following the contract above and call',
  '   validate_script until it passes.',
  '5. Before generating, tell the user the video IS published as a',
  '   real post, and confirm the providers/accounts and the mode (scheduled|asap)',
  '   with the user. Also ask if they want a routine after this first video.',
  '   Warning: Bluesky video publishing is',
  '   currently being fixed (issue #327); Bluesky is optional and can be',
  '   skipped.',
  '6. Call generate_persona_video once with that personaId, the validated',
  '   segments unchanged, the confirmed title, language "en", the confirmed',
  '   providers with their account IDs from list_social_accounts, and the',
  '   confirmed mode. Then call get_video_task_progress until done and share the',
  '   get_video_status URL.',
].join('\n');

export const DAILY_NEWS_PROMPT = [
  ...SHARED_PROMPT_BASE,
  '',
  "Turn one top story from today's GNews headlines (lang=en, country=us) into",
  'one Post Engineer video. My GNews key is in your own environment as',
  'YOUR_GNEWS_KEY: never print it, never paste it anywhere else. If it is',
  'missing, tell me to set it; never ask me to paste it in chat.',
  '',
  '1. Pick one clear single event with a named place. Skip round-ups, opinion',
  '   pieces, and stories sourced only from a social post. Attribute',
  '   single-sourced claims.',
  '2. Write the script as segments following the contract above and call',
  '   validate_script until it passes.',
  '3. For media, prefer a photo of the actual place in the story. Check a',
  '   public URL with check_media first and attach it only on ok; or upload',
  '   a local file with upload_media shortly before generating and use the',
  '   mediaId. At most 6 medias. Skip a failed photo, never force it.',
  '4. Call generate_persona_video with the confirmed personaId, the validated',
  '   segments unchanged, the confirmed title, language "en", the confirmed',
  '   providers with account IDs from list_social_accounts, and the confirmed',
  '   mode.',
  '5. Poll get_video_task_progress on the taskId until done, then share the',
  '   final video URL from get_video_status.',
].join('\n');

export const GITHUB_PRS_PROMPT = [
  ...SHARED_PROMPT_BASE,
  '',
  'Turn one GitHub pull request into one persona video.',
  '',
  '1. Ask me which PR. If you can read the repo, fetch its title, description,',
  '   and changes yourself; otherwise ask me for them.',
  '2. Write the script as segments following the contract above and call',
  '   validate_script until it passes.',
  '3. Media: at most 6, only if they match the PR (screenshots, diagrams, or',
  '   repo visuals); otherwise generate without media.',
  '4. Call generate_persona_video, the singular video tool, once with the',
  '   confirmed personaId, the validated segments unchanged, the confirmed',
  '   title, language "en", the confirmed accounts, and the confirmed mode.',
  '5. Never invent PR details: if the title, description, or change summary is',
  '   missing, ask for it instead of guessing.',
].join('\n');

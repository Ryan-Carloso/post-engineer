// Shared prompt base: single source of truth for the web prompts hub and
// the MCP prompts hub. Every served prompt is composed as
// [...SHARED_PROMPT_BASE, '', ...specificLines].join('\n'), so the
// delivered text is complete and standalone: the agent receives the
// whole prompt in one paste, never a bare "see the base prompt"
// reference.
// DO NOT EDIT this copy directly in apps/web or apps/mcp: the files at
// apps/web/lib/generation/prompt-base.ts and apps/mcp/src/prompt-base.ts
// are generated copies of this file. Edit here, then run
// `node scripts/sync-prompt-base.mjs` from the repo root. The per-app
// prompt-base-shared tests fail loudly if a generated copy ever drifts,
// so a stale copy can never pass CI silently. The sync script is
// deliberately NOT wired into prebuild/pretest: both apps' package.json
// files are guard-protected paths, and auto-regeneration is a
// convenience, not a correctness requirement.
// Only rules that are truly universal belong here: asking the user
// instead of placeholders, humanizer and anti-slop apply to every prompt,
// as do the segments contract and the scheduling rules. Anything topic-specific stays in the prompt that
// owns it, so this base stays short and every prompt stays cheap.
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
  'Use concrete detail from the source: names, places, numbers. Only facts the source supports; if a detail is missing, ask me or leave it out, never invent it.',
  'No em dashes, no hedging (delve, moreover, it is important to note), no filler, no corporate speak.',
  'Short sentences. Plain words. If a line could belong to any topic, rewrite it until it could only belong to this one.',
  '',
  'Script contract, every video script follows it:',
  'Segments: first hook, last CTA, exactly one of each, at least one body, at most 12 segments.',
  'Length: 60–200 words total; hook 15–40 words, aim for 20–30 (8–12 seconds), ending with terminal punctuation; body at least 30 words; CTA 5–20 words.',
  'Spoken English only, language "en": no links, hashtags, markdown, emoji, or stage directions in any segment.',
  'Propose a title; it is mandatory with every generate_persona_video call.',
  'Call validate_script with the segments and fix any named error until it passes. Validate before any token is spent; never generate from an unvalidated script.',
  '',
  'Generation is always tied to publishing:',
  'One generate_persona_video call generates and publishes the video; there is no orphan video and no separate schedule step.',
  'mode "scheduled" needs startAt (ISO datetime, 3h-30d ahead), times (HH:MM), and timezone; mode "asap" needs no startAt or times.',
];

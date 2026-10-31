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
// Only rules that are truly universal belong here: humanizer and
// anti-slop apply to every prompt, as do the segments contract and the
// scheduling rules. Anything topic-specific stays in the prompt that
// owns it, so this base stays short and every prompt stays cheap.
// This file has no imports, so the same bytes compile under the web
// bundler resolution and the MCP NodeNext resolution.

export const SHARED_PROMPT_BASE: string[] = [
  'Write like a human, never like generic AI:',
  'Use concrete detail from the source: names, places, numbers, and one specific moment. Swap any generic line for your own detail.',
  'No em dashes, no hedging (delve, moreover, it is important to note), no filler, no corporate speak.',
  'Short sentences. Plain words. If a line could belong to any topic, rewrite it until it could only belong to this one.',
  '',
  'Script contract — every video script follows it:',
  'Segments: first hook, last CTA, exactly one of each, at most 12 segments.',
  'Length: 60–200 words total; hook 20–30 words (8–12 seconds) ending with terminal punctuation; body at least 30 words; CTA 5–20 words.',
  'Spoken English only, language "en": no links, hashtags, markdown, emoji, or stage directions in any segment.',
  'Title is mandatory with every generate_persona_video call.',
  'Call validate_script with the segments and fix any named error until it passes. Validate before any token is spent; never generate from an unvalidated script.',
  '',
  'Generation is always tied to publishing:',
  'One generate_persona_video call generates and publishes the video; there is no orphan video and no separate schedule step.',
  'mode "scheduled" needs startAt [ISO_DATETIME, 3h-30d ahead] + times [HH:MM] in timezone [TIMEZONE]; mode "asap" needs no startAt/times.',
];

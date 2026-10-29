//---------------
// MCP prompts hub — slash commands for the recipes prompts. This file
// is a self-contained COPY of the web hub (apps/web/): the published
// tarball cannot import apps/web at runtime (see
// scripts/sync-script-segments.mjs and prompts-sync.test.ts). Adding a
// prompt to the web hub means copying its slug, title, description,
// and exact prompt text here; prompts-sync.test.ts fails loudly when
// the two drift. Prompts are zero-arg: placeholders stay in the text.
//---------------

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface HubPrompt {
  slug: string;
  title: string;
  description: string;
  prompt: string;
}

export const HUB_PROMPTS: HubPrompt[] = [
  {
    slug: "daily-news",
    title: "Daily news becomes a video",
    description: [
      "Turn one news story of the day into one persona video, validated before any token is spent.",
    ].join("\n"),
    prompt: [
      "Turn one top story from today's GNews headlines (lang=en, country=us) into",
      "one Post Engineer video. My GNews key is in your own environment as",
      "YOUR_GNEWS_KEY — never print it, never paste it anywhere else.",
      "",
      "Rules:",
      "1. Pick one clear single event with a named place. Skip round-ups, opinion",
      "   pieces, and stories sourced only from a social post.",
      "2. Write the script as segments: first hook (aim 20-30 words, end with",
      "   terminal punctuation), then body segments (at least 30 words total),",
      "   last CTA (5-20 words). Total 60–200 words, spoken English only, no",
      "   links, hashtags, markdown, emoji, or stage directions. Only facts the",
      "   source supports; attribute single-sourced claims.",
      "3. Call validate_script with those segments. Fix any named error and",
      "   re-validate until it passes. Do not generate before it passes.",
      "4. For media, prefer a photo of the actual place in the story. Check a",
      "   public URL with check_media first and attach it only on ok; or upload",
      "   a local file with upload_media shortly before generating and use the",
      "   mediaId. At most 6 medias. Skip a failed photo, never force it.",
      "5. Call generate_persona_video with personaId [PERSONA_ID], the validated",
      "   segments unchanged, title [STORY_TITLE], language \"en\", providers",
      "   [PROVIDERS] with account IDs from list_social_accounts, mode",
      "   [scheduled|asap] (scheduled needs startAt [ISO_DATETIME] + times",
      "   [HH:MM] in timezone [TIMEZONE]; asap needs no startAt/times).",
      "6. Poll get_video_task_progress on the taskId until done, then share the",
      "   final video URL from get_video_status.",
    ].join("\n"),
  },
  {
    slug: "github-prs",
    title: "GitHub PRs become videos",
    description: [
      "Turn your GitHub pull requests into persona videos.",
    ].join("\n"),
    prompt: [
      "Turn this GitHub pull request into one persona video.",
      "",
      "PR to use (paste the PR title, description, and a short change summary, plus any linked issues):",
      "- Title: ...",
      "- Description: ...",
      "- What changed: ...",
      "- Linked issues: ...",
      "",
      "Rules:",
      "- Use the Post Engineer MCP server and the singular video tool, generate_persona_video.",
      "- First, call validate_script with your script and only proceed when it is valid — validate before any token is debited.",
      "- Script: spoken text only, no links, hashtags, markdown, emojis, or stage directions.",
      "- Structure: first segment is the hook, last segment is the CTA, exactly one of each.",
      "- Length: 60–200 words total, hook 20–30 words (8–12 seconds), body at least 30 words, CTA 5–20 words, at most 12 segments.",
      "- Language: en only.",
      "- Media: at most 6, only if they match the PR (screenshots, diagrams, or repo visuals); otherwise generate without media.",
      "- Then generate one video for this PR and publish it where the user asked, scheduled or asap.",
      "- Never invent PR details: if the title, description, or change summary is missing, ask for it instead of guessing.",
    ].join("\n"),
  },
  {
    slug: "full-setup",
    title: "Full setup becomes videos",
    description: [
      "Connect accounts, create a persona, validate the script, and publish your first video without skipping a step.",
    ].join("\n"),
    prompt: [
      "Set up Post Engineer end to end and publish your first video. Follow the",
      "steps in order; do not skip ahead of validation or the publish confirmation.",
      "",
      "1. Call list_social_accounts. Ask which of youtube, instagram, linkedin",
      "   the user wants; for each one that is missing, call connect_account with",
      "   that provider and hand the returned https OAuth link to the user to",
      "   finish in the browser, then re-check with list_social_accounts.",
      "2. Bluesky is optional. If the user wants it, ask for the handle and the",
      "   app password (never the main password); use the app password only in",
      "   connect_account and never repeat, print, or log it.",
      "3. Call list_faces and list_voices, let the user pick a face and a voice,",
      "   then call create_persona with name, avatarUrl, voiceId,",
      "   language \"en-US\" (English only for now) and niche. Remember the personaId.",
      "4. Call get_token_balance first. Then write the script as segments: hook",
      "   first, CTA last, 60–200 words total, spoken English only, no links,",
      "   hashtags, markdown, emoji, or stage directions. Call validate_script",
      "   and fix any named error until it passes — validate before any token is",
      "   spent.",
      "5. Before generating, tell the user the video IS published as a",
      "   real post, and confirm the providers/accounts and the mode (scheduled|asap)",
      "   with the user. Warning: Bluesky video publishing is",
      "   currently being fixed (issue #327); Bluesky is optional and can be",
      "   skipped.",
      "6. Call generate_persona_video once with that personaId, the validated",
      "   segments unchanged, title [VIDEO_TITLE], language \"en\", the confirmed",
      "   providers with their account IDs from list_social_accounts, and the",
      "   confirmed mode (scheduled needs startAt [ISO_DATETIME, 3h-30d ahead] +",
      "   times [HH:MM] in timezone [TIMEZONE]; asap needs no startAt/times).",
      "   Then call get_video_task_progress until done and share the",
      "   get_video_status URL.",
    ].join("\n"),
  },
];

export function registerPrompts(server: McpServer): void {
  for (const prompt of HUB_PROMPTS) {
    server.registerPrompt(prompt.slug, {
      title: prompt.title,
      description: prompt.description,
    }, async () => ({
      messages: [{
        role: 'user',
        content: { type: 'text', text: prompt.prompt },
      }],
    }));
  }
}

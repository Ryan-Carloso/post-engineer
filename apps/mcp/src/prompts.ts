//---------------
// MCP prompts hub: slash commands for the recipes prompts. Prompt texts
// come from ./prompt-base.ts, a symlink to
// shared/prompt-base/prompt-base.ts: tsc rootDir is ./src, so a direct
// import outside src fails with TS6059, and widening rootDir would move
// dist/index.js. The symlink keeps the published tarball self-contained
// (tsc emits a real dist/prompt-base.js) with no generated copy in git.
// Slugs, titles and descriptions mirror the web hub;
// prompts-sync.test.ts fails when they drift. Prompts are zero-arg: the
// agent asks the user for values.
//---------------

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  DAILY_NEWS_PROMPT,
  FULL_SETUP_PROMPT,
  GITHUB_PRS_PROMPT,
  PLACE_SPOTLIGHT_PROMPT,
  SUBJECT_SPOTLIGHT_PROMPT,
} from './prompt-base.js';

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
    prompt: DAILY_NEWS_PROMPT,
  },
  {
    slug: "place-spotlight",
    title: "Place spotlight becomes a video",
    description: [
      "Turn one real place into one persona video with photos of the place itself on screen, validated before any token is spent.",
    ].join("\n"),
    prompt: PLACE_SPOTLIGHT_PROMPT,
  },
  {
    slug: "subject-spotlight",
    title: "Subject spotlight becomes a video",
    description: [
      "Turn one concrete subject (a car, a product, a gadget) into one persona video with its own photos and its real price on screen, validated before any token is spent.",
    ].join("\n"),
    prompt: SUBJECT_SPOTLIGHT_PROMPT,
  },
  {
    slug: "github-prs",
    title: "GitHub PRs become videos",
    description: [
      "Turn your GitHub pull requests into persona videos.",
    ].join("\n"),
    prompt: GITHUB_PRS_PROMPT,
  },
  {
    slug: "full-setup",
    title: "Full setup becomes videos",
    description: [
      "Connect accounts, create a persona, validate the script, and publish your first video without skipping a step.",
    ].join("\n"),
    prompt: FULL_SETUP_PROMPT,
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

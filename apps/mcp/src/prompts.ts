//---------------
// MCP prompts hub: slash commands for the recipes prompts. Prompt texts
// come from shared/prompt-base/prompt-base.ts through ./prompt-base.ts.
// Slugs, titles and descriptions mirror the web hub;
// prompts-sync.test.ts fails when they drift. Prompts are zero-arg: the
// agent asks the user for values.
//---------------

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DAILY_NEWS_PROMPT, FULL_SETUP_PROMPT, GITHUB_PRS_PROMPT } from './prompt-base.js';

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

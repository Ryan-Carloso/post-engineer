import { buildInstallPrompt } from '@/lib/mcp-install-prompt';
import type { DocPage } from '../types';

export const mcpGuide: DocPage = {
  section: 'docs',
  slug: 'mcp',
  title: { en: 'MCP server' },
  description: {
    en: 'Connect Claude and other agents to Post Engineer with the MCP server, locally or remotely.',
  },
  updatedAt: '2026-11-28',
  contentHash: 'a9da7d61ba09f08fa02788728b5749042f14ae07011abb67fc6d3b102b7ec71b',
  blocks: [
    {
      kind: 'paragraph',
      text: {
        en: 'The MCP server lets an agent create personas, publish videos and images made elsewhere and schedule posts through Post Engineer. It speaks the Model Context Protocol over stdio locally or over HTTPS remotely.',
      },
    },
    { kind: 'heading', level: 2, text: { en: 'Local setup' } },
    {
      kind: 'paragraph',
      text: {
        en: 'Install the server with npx and point it at your API key. The snippet below is the same setup the app shows.',
      },
    },
    { kind: 'code', language: 'text', code: buildInstallPrompt('en') },
    { kind: 'heading', level: 2, text: { en: 'Remote server' } },
    {
      kind: 'paragraph',
      text: {
        en: 'Use the hosted server when the agent cannot run local commands. It serves the same tools over Streamable HTTP with OAuth sign-in.',
      },
    },
    {
      kind: 'link',
      href: { en: 'https://post-engineer.com/mcp' },
      text: { en: 'Remote MCP server' },
    },
    { kind: 'heading', level: 2, text: { en: 'Tools' } },
    {
      kind: 'paragraph',
      text: {
        en: 'Every tool below is registered by the MCP server. Each takes an action.',
      },
    },
    { kind: 'toolList' },
    { kind: 'heading', level: 2, text: { en: 'Publish media via MCP' } },
    {
      kind: 'paragraph',
      text: {
        en: 'Call `publish_video` with the finished file you made elsewhere: publish it now or schedule it, and it goes out to the persona\'s accounts at the chosen time.',
      },
    },
  ],
};

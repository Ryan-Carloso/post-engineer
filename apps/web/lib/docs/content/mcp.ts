import { buildInstallPrompt } from '@/lib/mcp-install-prompt';
import type { DocPage } from '../types';

export const mcpGuide: DocPage = {
  section: 'docs',
  slug: 'mcp',
  title: { en: 'MCP server' },
  description: {
    en: 'Connect Claude and other agents to Post Engineer with the MCP server, locally or remotely.',
  },
  updatedAt: '2026-11-26',
  contentHash: 'b75a3c447604110209f1c1fece489c9761e432c500f75620772f8e4fa30c65b5',
  blocks: [
    {
      kind: 'paragraph',
      text: {
        en: 'The MCP server lets an agent create personas, generate videos and schedule posts through Post Engineer. It speaks the Model Context Protocol over stdio locally or over HTTPS remotely.',
      },
    },
    { kind: 'heading', level: 2, text: { en: 'Local setup' } },
    {
      kind: 'paragraph',
      text: {
        en: 'Install the server with npx and point it at your API key. The snippet below is the same setup the app shows.',
      },
    },
    { kind: 'code', language: 'text', code: buildInstallPrompt('en', null) },
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
        en: 'Every tool below is registered by the MCP server. Each takes an action, except `generate_video` and `cancel_video`.',
      },
    },
    { kind: 'toolList' },
    { kind: 'heading', level: 2, text: { en: 'Publish videos via MCP' } },
    {
      kind: 'paragraph',
      text: {
        en: 'Call `generate_video` with segments: the hook first, then the content takes in order. Generation is always tied to publishing, so every video is scheduled and auto-published.',
      },
    },
  ],
};

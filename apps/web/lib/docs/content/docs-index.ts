import type { DocPage } from '../types';

export const docsIndex: DocPage = {
  section: 'docs',
  slug: null,
  title: { en: 'Documentation' },
  description: {
    en: 'Agent guides for Post Engineer: MCP setup, HTTP API, use cases and integrations.',
  },
  updatedAt: '2026-11-26',
  contentHash: '3c38f94866033e54469f6fdbf899d0a0cc40df86955bcd10b88a7c6a4ccccd0b',
  blocks: [
    {
      kind: 'paragraph',
      text: {
        en: 'These guides explain how agents use Post Engineer: connect through the MCP server, call the HTTP API, or automate a whole posting workflow.',
      },
    },
    { kind: 'link', href: '/docs/mcp', text: { en: 'MCP server' } },
    { kind: 'link', href: '/docs/api', text: { en: 'HTTP API' } },
    { kind: 'link', href: '/docs/use-cases', text: { en: 'Use cases' } },
    { kind: 'link', href: '/docs/integrations', text: { en: 'Integrations' } },
  ],
};

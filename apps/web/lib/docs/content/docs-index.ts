import type { DocPage } from '../types';

export const docsIndex: DocPage = {
  section: 'docs',
  slug: null,
  title: { en: 'Documentation' },
  description: {
    en: 'Agent guides for Post Engineer: MCP setup, HTTP API, use cases and integrations.',
  },
  updatedAt: '2026-11-26',
  contentHash: '6d1fc4c805cf3794615a9927de26dba4b4a13e6dfdf485279e87a1b236f91593',
  blocks: [
    {
      kind: 'paragraph',
      text: {
        en: 'These guides explain how agents use Post Engineer: connect through the MCP server, call the HTTP API, or automate a whole posting workflow.',
      },
    },
    { kind: 'link', href: '/docs/mcp', text: { en: 'MCP server' } },
  ],
};

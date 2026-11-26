import type { DocPage } from '../types';

export const docsIndex: DocPage = {
  section: 'docs',
  slug: null,
  title: { en: 'Documentation' },
  description: {
    en: 'Agent guides for Post Engineer: MCP setup, HTTP API, use cases and integrations.',
  },
  updatedAt: '2026-11-26',
  contentHash: '31bccb4852f58d7f61497f067fb6ab1cf3e3b4d96a4ef1d74b899bde07478242',
  blocks: [
    {
      kind: 'paragraph',
      text: {
        en: 'These guides explain how agents use Post Engineer: connect through the MCP server, call the HTTP API, or automate a whole posting workflow.',
      },
    },
    { kind: 'link', href: { en: '/docs/mcp' }, text: { en: 'MCP server' } },
    { kind: 'link', href: { en: '/docs/api' }, text: { en: 'HTTP API' } },
    { kind: 'link', href: { en: '/docs/use-cases' }, text: { en: 'Use cases' } },
    { kind: 'link', href: { en: '/docs/integrations' }, text: { en: 'Integrations' } },
  ],
};

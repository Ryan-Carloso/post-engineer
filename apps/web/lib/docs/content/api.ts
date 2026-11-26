import type { DocPage } from '../types';

export const apiGuide: DocPage = {
  section: 'docs',
  slug: 'api',
  title: { en: 'HTTP API' },
  description: {
    en: 'Call the Post Engineer HTTP API with a bearer key: auth, endpoints and the OpenAPI contract.',
  },
  updatedAt: '2026-11-26',
  contentHash: '7854b1375e6b090789bfc0d7f9e6e1569a2e8bd0b7087bd24d93359a5f6f78af',
  blocks: [
    {
      kind: 'paragraph',
      text: {
        en: 'The HTTP API is the same surface the MCP server calls. Every request carries your API key as a bearer token, and every response uses the same envelope.',
      },
    },
    { kind: 'heading', level: 2, text: { en: 'Authentication' } },
    {
      kind: 'paragraph',
      text: {
        en: 'Send your key in the Authorization header on every request. Keys start with pe_live_ and are created in the app.',
      },
    },
    {
      kind: 'code',
      language: 'bash',
      code: 'curl https://post-engineer.com/api/persona/list \\\n  -H "Authorization: Bearer pe_live_..."',
    },
    { kind: 'heading', level: 2, text: { en: 'Endpoints' } },
    {
      kind: 'paragraph',
      text: {
        en: 'The full contract lives in the OpenAPI document and the plain-text API documentation. Both list every route, its inputs and its errors.',
      },
    },
    { kind: 'link', href: '/openapi.json', text: { en: 'OpenAPI contract' } },
    { kind: 'link', href: '/api-documentation.txt', text: { en: 'API documentation (plain text)' } },
  ],
};

import type { DocPage } from '../types';

export const apiGuide: DocPage = {
  section: 'docs',
  slug: 'api',
  title: { en: 'HTTP API' },
  description: {
    en: 'Call the Post Engineer HTTP API with a bearer key: auth, endpoints and the OpenAPI contract.',
  },
  updatedAt: '2026-11-26',
  contentHash: '35ada0bff1e0edf2651fc4a26fafedd265b4be59e3d0076e58ee933dfd724c80',
  blocks: [
    {
      kind: 'paragraph',
      text: {
        en: 'The HTTP API is the same surface the MCP server calls. Every request carries your API key as a bearer token; the API documentation lists the response shape of each route.',
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
    { kind: 'link', href: { en: '/openapi.json' }, text: { en: 'OpenAPI contract' } },
    { kind: 'link', href: { en: '/api-documentation.txt' }, text: { en: 'API documentation (plain text)' } },
  ],
};

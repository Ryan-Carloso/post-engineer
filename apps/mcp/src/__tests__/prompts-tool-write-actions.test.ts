import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPostEngineerMcpServer } from '../index.js';
import { PostEngineerClient } from '../client.js';
import { MCP_SESSION_ID_HEADER } from '../recipe-session.js';

const BASE = 'https://api.example.test';

interface Seen {
  method: string;
  path: string;
  body: unknown;
}

const OWN = {
  slug: 'my-prompt',
  title: 'My prompt',
  description: 'About',
  source: 'own',
  visibility: 'private',
  verified: false,
  prompt: 'Write it in three beats.',
  body: 'Write it in three beats.',
  versionId: '44444444-4444-4444-8444-444444444444',
  version: 1,
};

function setup(routes: Record<string, unknown>): {
  call: (args: Record<string, unknown>) => Promise<{ isError: boolean; text: string }>;
  seen: Seen[];
  headers: Array<Record<string, string>>;
} {
  const seen: Seen[] = [];
  const headers: Array<Record<string, string>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const parsed = new URL(url);
      const method = init.method ?? 'GET';
      headers.push(init.headers as Record<string, string>);
      seen.push({ method, path: parsed.pathname, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
      return Response.json(routes[`${method} ${parsed.pathname}`] ?? { success: true });
    }),
  );
  const api = new PostEngineerClient({ apiKey: 'pe_test', baseUrl: BASE });
  return {
    seen,
    headers,
    async call(args) {
      const server = createPostEngineerMcpServer(api, 'stdio');
      const [a, b] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 't', version: '0.0.0' });
      await Promise.all([server.connect(b), client.connect(a)]);
      try {
        const result = await client.callTool({ name: 'prompts', arguments: args });
        const content = result.content as Array<{ type: string; text?: string }>;
        return { isError: result.isError === true, text: content.map((part) => part.text ?? '').join('\n') };
      } finally {
        await client.close();
      }
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('prompts write actions', () => {
  it('create posts the prompt text as `prompt` and leaves visibility to the server default', async () => {
    const { call, seen } = setup({ 'POST /api/prompts': { success: true, prompt: OWN } });
    const result = await call({ action: 'create', slug: 'my-prompt', title: 'My prompt', description: 'About', prompt: 'Write it in three beats.' });
    expect(result.isError).toBe(false);
    expect(seen).toEqual([{ method: 'POST', path: '/api/prompts', body: { slug: 'my-prompt', title: 'My prompt', description: 'About', prompt: 'Write it in three beats.' } }]);
    expect(result.text).toContain('Prompt created');
  });

  it('create sends visibility public when asked', async () => {
    const { call, seen } = setup({ 'POST /api/prompts': { success: true, prompt: { ...OWN, visibility: 'public' } } });
    await call({ action: 'create', slug: 'my-prompt', title: 'T', prompt: 'P', visibility: 'public' });
    expect(seen[0]?.body).toEqual({ slug: 'my-prompt', title: 'T', prompt: 'P', visibility: 'public' });
  });

  it('update sends only the fields given and never the slug in the body', async () => {
    const { call, seen } = setup({ 'PATCH /api/prompts/my-prompt': { success: true, prompt: { ...OWN, title: 'Renamed' } } });
    const result = await call({ action: 'update', slug: 'my-prompt', title: 'Renamed' });
    expect(result.isError).toBe(false);
    expect(seen).toEqual([{ method: 'PATCH', path: '/api/prompts/my-prompt', body: { title: 'Renamed' } }]);
  });

  it.each(['public', 'private'])('update makes a prompt %s by sending only the visibility', async (visibility) => {
    const { call, seen } = setup({ 'PATCH /api/prompts/my-prompt': { success: true, prompt: { ...OWN, visibility } } });
    const result = await call({ action: 'update', slug: 'my-prompt', visibility });
    expect(result.isError).toBe(false);
    expect(seen[0]?.body).toEqual({ visibility });
  });

  it('update with nothing to change is refused before any request', async () => {
    const { call, seen } = setup({});
    const result = await call({ action: 'update', slug: 'my-prompt' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('at least one of title, description, prompt or visibility');
    expect(seen).toEqual([]);
  });

  it('delete removes the prompt by encoded slug', async () => {
    const { call, seen } = setup({ 'DELETE /api/prompts/my-prompt': { success: true } });
    const result = await call({ action: 'delete', slug: 'my-prompt' });
    expect(result.isError).toBe(false);
    expect(seen).toEqual([{ method: 'DELETE', path: '/api/prompts/my-prompt', body: undefined }]);
  });

  it.each([
    ['a slug with capitals', { action: 'create', slug: 'My Prompt', title: 'T', prompt: 'P' }],
    ['an unknown visibility', { action: 'update', slug: 'my-prompt', visibility: 'approved' }],
    ['a field of another action', { action: 'delete', slug: 'my-prompt', title: 'T' }],
    ['a removed review action', { action: 'review', slug: 'my-prompt' }],
    ['a changed slug on update', { action: 'update', slug: 'my-prompt', newSlug: 'other' }],
  ])('refuses %s before any request', async (_label, args) => {
    const { call, seen } = setup({});
    const result = await call(args);
    expect(result.isError).toBe(true);
    expect(seen).toEqual([]);
  });

  it('surfaces a conflict from the server as a tool error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false, error: 'You already have a prompt with this slug, or another public prompt uses it.', code: 'PROMPT_SLUG_TAKEN' }, { status: 409 })));
    const api = new PostEngineerClient({ apiKey: 'pe_test', baseUrl: BASE });
    const server = createPostEngineerMcpServer(api, 'stdio');
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 't', version: '0.0.0' });
    await Promise.all([server.connect(b), client.connect(a)]);
    try {
      const result = await client.callTool({ name: 'prompts', arguments: { action: 'update', slug: 'my-prompt', visibility: 'public' } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('another public prompt uses it');
    } finally {
      await client.close();
    }
  });

  describe('versions', () => {
    const PAGE = {
      success: true,
      currentVersion: 3,
      versions: [
        { versionId: '55555555-5555-4555-8555-555555555553', version: 3, title: 'T', createdAt: '2026-11-24T10:00:00Z', preview: 'three', previewTruncated: false, bodyLength: 5, current: true },
        { versionId: '55555555-5555-4555-8555-555555555552', version: 2, title: 'T', createdAt: '2026-11-23T10:00:00Z', preview: 'two', previewTruncated: false, bodyLength: 3, current: false },
      ],
      truncated: true,
      nextCursor: 2,
    };
    const DETAIL = {
      success: true,
      version: { versionId: '55555555-5555-4555-8555-555555555552', version: 2, title: 'T', createdAt: '2026-11-23T10:00:00Z', body: 'the full two', current: false },
    };

    it('lists the versions of a prompt with GET on the encoded slug', async () => {
      const { call, seen } = setup({ 'GET /api/prompts/my-prompt/versions': PAGE });
      const result = await call({ action: 'versions', slug: 'my-prompt' });
      expect(result.isError).toBe(false);
      expect(seen).toEqual([{ method: 'GET', path: '/api/prompts/my-prompt/versions', body: undefined }]);
      expect(result.text).toContain('"currentVersion": 3');
      expect(result.text).toContain('"nextCursor": 2');
    });

    it('sends limit and before as query parameters', async () => {
      const search: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          search.push(new URL(url).search);
          return Response.json(PAGE);
        }),
      );
      const api = new PostEngineerClient({ apiKey: 'pe_test', baseUrl: BASE });
      const server = createPostEngineerMcpServer(api, 'stdio');
      const [a, b] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 't', version: '0.0.0' });
      await Promise.all([server.connect(b), client.connect(a)]);
      try {
        await client.callTool({ name: 'prompts', arguments: { action: 'versions', slug: 'my-prompt', limit: 5, before: 9 } });
      } finally {
        await client.close();
      }
      expect(search).toEqual(['?limit=5&before=9']);
    });

    it('reads one version with its full text when version is given', async () => {
      const { call, seen } = setup({ 'GET /api/prompts/my-prompt/versions/2': DETAIL });
      const result = await call({ action: 'versions', slug: 'my-prompt', version: 2 });
      expect(result.isError).toBe(false);
      expect(seen).toEqual([{ method: 'GET', path: '/api/prompts/my-prompt/versions/2', body: undefined }]);
      expect(result.text).toContain('the full two');
    });

    it.each([
      ['a limit of 0', { limit: 0 }],
      ['a limit above the cap', { limit: 51 }],
      ['a before of 1', { before: 1 }],
      ['a before above the version limit', { before: 1_000_000_000 }],
      ['a version of 0', { version: 0 }],
      ['a fractional version', { version: 1.5 }],
      ['version with a page cursor', { version: 2, before: 3 }],
    ])('refuses %s before any request', async (_label, extra) => {
      const { call, seen } = setup({});
      const result = await call({ action: 'versions', slug: 'my-prompt', ...extra });
      expect(result.isError).toBe(true);
      expect(seen).toEqual([]);
    });
  });

  describe('restore', () => {
    const RESTORED = { success: true, restored: true, prompt: { ...OWN, version: 4 } };
    const UNCHANGED = { success: true, restored: false, prompt: { ...OWN, version: 3 } };

    it('posts expectedCurrentVersion to the restore endpoint of the chosen version', async () => {
      const { call, seen } = setup({ 'POST /api/prompts/my-prompt/versions/1/restore': RESTORED });
      const result = await call({ action: 'restore', slug: 'my-prompt', version: 1, expectedCurrentVersion: 3 });
      expect(result.isError).toBe(false);
      expect(seen).toEqual([{ method: 'POST', path: '/api/prompts/my-prompt/versions/1/restore', body: { expectedCurrentVersion: 3 } }]);
    });

    it('says a new version was created when the text was restored', async () => {
      const { call } = setup({ 'POST /api/prompts/my-prompt/versions/1/restore': RESTORED });
      const result = await call({ action: 'restore', slug: 'my-prompt', version: 1, expectedCurrentVersion: 3 });
      expect(result.text).toContain('Prompt restored as version 4');
      expect(result.text).not.toContain('nothing changed');
    });

    it('says nothing changed when the text already was the current one', async () => {
      const { call } = setup({ 'POST /api/prompts/my-prompt/versions/3/restore': UNCHANGED });
      const result = await call({ action: 'restore', slug: 'my-prompt', version: 3, expectedCurrentVersion: 3 });
      expect(result.isError).toBe(false);
      expect(result.text).toContain('Already the current text; nothing changed');
      expect(result.text).not.toContain('Prompt restored');
    });

    it('refuses a restore without expectedCurrentVersion before any request', async () => {
      const { call, seen } = setup({});
      const result = await call({ action: 'restore', slug: 'my-prompt', version: 1 });
      expect(result.isError).toBe(true);
      expect(seen).toEqual([]);
    });

    it.each([
      ['a missing version', { slug: 'my-prompt', expectedCurrentVersion: 3 }],
      ['a zero expectedCurrentVersion', { slug: 'my-prompt', version: 1, expectedCurrentVersion: 0 }],
      ['a text field of another action', { slug: 'my-prompt', version: 1, expectedCurrentVersion: 3, prompt: 'x' }],
    ])('refuses %s before any request', async (_label, extra) => {
      const { call, seen } = setup({});
      const result = await call({ action: 'restore', ...extra });
      expect(result.isError).toBe(true);
      expect(seen).toEqual([]);
    });

    it('surfaces a 409 as a tool error with the status and message and not the raw body', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json(
            { success: false, error: 'The prompt changed since you loaded it. Reload and try again.', code: 'PROMPT_VERSION_CONFLICT', secretDebug: 'internal-detail' },
            { status: 409 },
          ),
        ),
      );
      const api = new PostEngineerClient({ apiKey: 'pe_test', baseUrl: BASE });
      const server = createPostEngineerMcpServer(api, 'stdio');
      const [a, b] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 't', version: '0.0.0' });
      await Promise.all([server.connect(b), client.connect(a)]);
      try {
        const result = await client.callTool({
          name: 'prompts',
          arguments: { action: 'restore', slug: 'my-prompt', version: 1, expectedCurrentVersion: 2 },
        });
        expect(result.isError).toBe(true);
        const text = JSON.stringify(result.content);
        expect(text).toContain('409');
        expect(text).toContain('The prompt changed since you loaded it');
        expect(text).not.toContain('internal-detail');
      } finally {
        await client.close();
      }
    });
  });

  describe('merged tool surface', () => {
    async function listPromptsTool(): Promise<{ description: string; properties: Record<string, { description?: string; pattern?: string; maxLength?: number }> }> {
      const api = new PostEngineerClient({ apiKey: 'pe_test', baseUrl: BASE });
      const server = createPostEngineerMcpServer(api, 'stdio');
      const [a, b] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 't', version: '0.0.0' });
      await Promise.all([server.connect(b), client.connect(a)]);
      try {
        const { tools } = await client.listTools();
        const tool = tools.find((candidate) => candidate.name === 'prompts');
        if (tool === undefined) throw new Error('prompts tool is not registered');
        const properties = tool.inputSchema.properties as Record<string, { description?: string; pattern?: string; maxLength?: number }>;
        return { description: tool.description ?? '', properties };
      } finally {
        await client.close();
      }
    }

    it('advertises the loose get slug schema shared by every action', async () => {
      const { properties } = await listPromptsTool();
      expect(properties.slug?.pattern).toBeUndefined();
      expect(properties.slug?.maxLength).toBeUndefined();
    });

    it('advertises a slug description that fits reads as well as writes', async () => {
      const { description, properties } = await listPromptsTool();
      expect(properties.slug?.description).toBe('Prompt slug: lowercase letters, digits, hyphens.');
      expect(description).toContain('A prompt slug cannot change after creation.');
    });

    it('advertises a version description that fits versions and restore', async () => {
      const { properties } = await listPromptsTool();
      expect(properties.version?.description).toContain('versions reads this version in full');
      expect(properties.version?.description).toContain('restore makes it the current text');
      expect(properties.version?.description).toContain('Leave it out to list the versions');
    });

    it('reaches the handler on a malformed get slug and fails with the valid-slug list, not the SDK pattern error', async () => {
      const seen: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          const parsed = new URL(url);
          seen.push(parsed.pathname);
          if (parsed.pathname === '/api/prompts/Place%20Spotlight') {
            return Response.json({ success: false, error: 'Prompt not found.', code: 'PROMPT_NOT_FOUND' }, { status: 404 });
          }
          return Response.json({ success: true, prompts: [OWN] });
        }),
      );
      const api = new PostEngineerClient({ apiKey: 'pe_test', baseUrl: BASE });
      const server = createPostEngineerMcpServer(api, 'stdio');
      const [a, b] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 't', version: '0.0.0' });
      await Promise.all([server.connect(b), client.connect(a)]);
      try {
        const result = await client.callTool({ name: 'prompts', arguments: { action: 'get', slug: 'Place Spotlight' } });
        const text = (result.content as Array<{ text?: string }>).map((part) => part.text ?? '').join('\n');
        expect(result.isError).toBe(true);
        expect(text).toContain('unknown prompt slug "Place Spotlight"');
        expect(text).toContain('Valid slugs: my-prompt');
        expect(text).not.toContain('must match pattern');
        expect(seen).toContain('/api/prompts/Place%20Spotlight');
      } finally {
        await client.close();
      }
    });

    it('describes the write actions and no longer names prompt_library', async () => {
      const { description } = await listPromptsTool();
      expect(description).toContain('list and get read prompts; create, update, delete, versions and restore write your own');
      expect(description).toContain('create (slug, title, prompt)');
      expect(description).toContain('restore (slug, version, expectedCurrentVersion)');
      expect(description).not.toContain('prompt_library');
    });

    it('sends no session or recipe headers on a write but does on a list', async () => {
      const { call, headers } = setup({ 'POST /api/prompts': { success: true, prompt: OWN }, 'GET /api/prompts': { success: true, prompts: [] } });
      await call({ action: 'create', slug: 'my-prompt', title: 'T', prompt: 'P' });
      await call({ action: 'list' });
      const [writeHeaders, listHeaders] = headers;
      expect(writeHeaders).toBeDefined();
      expect(listHeaders).toBeDefined();
      expect(Object.keys(writeHeaders ?? {}).filter((name) => name.startsWith('X-MCP-Recipe') || name === MCP_SESSION_ID_HEADER)).toEqual([]);
      expect(listHeaders?.[MCP_SESSION_ID_HEADER]).toBeDefined();
    });

    it('prefixes a rejected write with the prompts tool name', async () => {
      const { call, seen } = setup({});
      const result = await call({ action: 'update', slug: 'my-prompt' });
      expect(result.isError).toBe(true);
      expect(result.text.startsWith('Error in prompts · update:')).toBe(true);
      expect(seen).toEqual([]);
    });
  });
});

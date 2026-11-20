import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPostEngineerMcpServer } from '../index.js';
import { PostEngineerClient } from '../client.js';

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
  prompt: 'Write it in three beats.',
};

function setup(routes: Record<string, unknown>): {
  call: (args: Record<string, unknown>) => Promise<{ isError: boolean; text: string }>;
  seen: Seen[];
} {
  const seen: Seen[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const parsed = new URL(url);
      const method = init.method ?? 'GET';
      seen.push({ method, path: parsed.pathname, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
      return Response.json(routes[`${method} ${parsed.pathname}`] ?? { success: true });
    }),
  );
  const api = new PostEngineerClient({ apiKey: 'pe_test', baseUrl: BASE });
  return {
    seen,
    async call(args) {
      const server = createPostEngineerMcpServer(api, 'stdio');
      const [a, b] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 't', version: '0.0.0' });
      await Promise.all([server.connect(b), client.connect(a)]);
      try {
        const result = await client.callTool({ name: 'prompt_library', arguments: args });
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

describe('prompt_library', () => {
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
      const result = await client.callTool({ name: 'prompt_library', arguments: { action: 'update', slug: 'my-prompt', visibility: 'public' } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('another public prompt uses it');
    } finally {
      await client.close();
    }
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPostEngineerMcpServer } from '../index.js';
import { PostEngineerClient } from '../client.js';

const BASE = 'https://api.example.test';
const PROMPT_ID = '11111111-1111-4111-8111-111111111111';
const HASH = 'a'.repeat(64);

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
  status: 'private',
  rejectionReason: null,
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
  it('create posts the prompt text as `prompt` and reports it private', async () => {
    const { call, seen } = setup({ 'POST /api/prompts': { success: true, prompt: OWN } });
    const result = await call({ action: 'create', slug: 'my-prompt', title: 'My prompt', description: 'About', prompt: 'Write it in three beats.' });
    expect(result.isError).toBe(false);
    expect(seen).toEqual([{ method: 'POST', path: '/api/prompts', body: { slug: 'my-prompt', title: 'My prompt', description: 'About', prompt: 'Write it in three beats.' } }]);
    expect(result.text).toContain('Prompt created (private)');
  });

  it('update sends only the fields given and never the slug in the body', async () => {
    const { call, seen } = setup({ 'PATCH /api/prompts/my-prompt': { success: true, prompt: { ...OWN, title: 'Renamed' } } });
    const result = await call({ action: 'update', slug: 'my-prompt', title: 'Renamed' });
    expect(result.isError).toBe(false);
    expect(seen).toEqual([{ method: 'PATCH', path: '/api/prompts/my-prompt', body: { title: 'Renamed' } }]);
  });

  it('update with nothing to change is refused before any request', async () => {
    const { call, seen } = setup({});
    const result = await call({ action: 'update', slug: 'my-prompt' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('at least one of title, description or prompt');
    expect(seen).toEqual([]);
  });

  it('delete removes the prompt by slug', async () => {
    const { call, seen } = setup({ 'DELETE /api/prompts/my-prompt': { success: true } });
    const result = await call({ action: 'delete', slug: 'my-prompt' });
    expect(result.isError).toBe(false);
    expect(seen).toEqual([{ method: 'DELETE', path: '/api/prompts/my-prompt', body: undefined }]);
  });

  it.each([
    ['public', 'Publication requested'],
    ['private', 'Prompt is private'],
  ])('set_visibility %s posts the visibility and says what happens next', async (visibility, message) => {
    const { call, seen } = setup({ 'POST /api/prompts/my-prompt/visibility': { success: true, prompt: { ...OWN, status: visibility === 'public' ? 'pending' : 'private' } } });
    const result = await call({ action: 'set_visibility', slug: 'my-prompt', visibility });
    expect(result.isError).toBe(false);
    expect(seen).toEqual([{ method: 'POST', path: '/api/prompts/my-prompt/visibility', body: { visibility } }]);
    expect(result.text).toContain(message);
  });

  it('review_queue lists the prompts waiting with their text and hash', async () => {
    const queue = {
      success: true,
      truncated: false,
      prompts: [{ id: PROMPT_ID, slug: 'waiting', title: 'Waiting', description: 'D', prompt: 'text', contentHash: HASH, authorId: 'u1', requestedAt: '2026-11-20T00:00:00Z' }],
    };
    const { call, seen } = setup({ 'GET /api/admin/prompts': queue });
    const result = await call({ action: 'review_queue' });
    expect(result.isError).toBe(false);
    expect(seen.map((request) => `${request.method} ${request.path}`)).toEqual(['GET /api/admin/prompts']);
    expect(result.text).toContain(HASH);
  });

  it('review sends the decision and the hash that was read, with the id only in the path', async () => {
    const { call, seen } = setup({ [`POST /api/admin/prompts/${PROMPT_ID}/review`]: { success: true, slug: 'waiting', status: 'approved' } });
    const result = await call({ action: 'review', id: PROMPT_ID, decision: 'approve', contentHash: HASH });
    expect(result.isError).toBe(false);
    expect(seen).toEqual([{ method: 'POST', path: `/api/admin/prompts/${PROMPT_ID}/review`, body: { decision: 'approve', contentHash: HASH } }]);
  });

  it('review sends the reason with a rejection', async () => {
    const { call, seen } = setup({ [`POST /api/admin/prompts/${PROMPT_ID}/review`]: { success: true, slug: 'waiting', status: 'rejected' } });
    await call({ action: 'review', id: PROMPT_ID, decision: 'reject', contentHash: HASH, reason: 'Too vague' });
    expect(seen[0]?.body).toEqual({ decision: 'reject', contentHash: HASH, reason: 'Too vague' });
  });

  it('a rejection without a reason is refused before any request', async () => {
    const { call, seen } = setup({});
    const result = await call({ action: 'review', id: PROMPT_ID, decision: 'reject', contentHash: HASH });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('needs a reason');
    expect(seen).toEqual([]);
  });

  it.each([
    ['a slug with capitals', { action: 'create', slug: 'My Prompt', title: 'T', prompt: 'P' }],
    ['a review hash that is not sha256 hex', { action: 'review', id: PROMPT_ID, decision: 'approve', contentHash: 'nope' }],
    ['a review id that is not a uuid', { action: 'review', id: 'nope', decision: 'approve', contentHash: HASH }],
    ['a field of another action', { action: 'delete', slug: 'my-prompt', title: 'T' }],
    ['an unknown visibility', { action: 'set_visibility', slug: 'my-prompt', visibility: 'approved' }],
  ])('refuses %s before any request', async (_label, args) => {
    const { call, seen } = setup({});
    const result = await call(args);
    expect(result.isError).toBe(true);
    expect(seen).toEqual([]);
  });

  it('surfaces a conflict from the server as a tool error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false, error: 'This prompt cannot move to that visibility from its current status.', code: 'PROMPT_STATE_CONFLICT' }, { status: 409 })));
    const api = new PostEngineerClient({ apiKey: 'pe_test', baseUrl: BASE });
    const server = createPostEngineerMcpServer(api, 'stdio');
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 't', version: '0.0.0' });
    await Promise.all([server.connect(b), client.connect(a)]);
    try {
      const result = await client.callTool({ name: 'prompt_library', arguments: { action: 'set_visibility', slug: 'my-prompt', visibility: 'public' } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('cannot move to that visibility');
    } finally {
      await client.close();
    }
  });
});

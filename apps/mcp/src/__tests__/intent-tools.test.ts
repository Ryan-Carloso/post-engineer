import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPostEngineerMcpServer } from '../index.js';
import { PostEngineerClient } from '../client.js';

// The intent tools end to end through a real MCP client, with a stubbed
// `fetch` standing in for the web API: names resolve to ids, an ambiguous
// reference does nothing, and each action sends the request its mapping says.

const MARIA = '11111111-1111-4111-8111-111111111111';
const BASE = 'https://api.example.test';

interface Seen {
  method: string;
  path: string;
  body: unknown;
}

function setup(routes: Record<string, unknown>): { call: (name: string, args: Record<string, unknown>) => Promise<{ isError?: boolean; text: string }>; seen: Seen[] } {
  const seen: Seen[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const parsed = new URL(url);
      const method = init.method ?? 'GET';
      seen.push({ method, path: `${parsed.pathname}${parsed.search}`, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
      const payload = routes[`${method} ${parsed.pathname}`] ?? { success: true };
      return Response.json(payload);
    }),
  );
  const api = new PostEngineerClient({ apiKey: 'pe_test', baseUrl: BASE });
  return {
    seen,
    async call(name, args) {
      const server = createPostEngineerMcpServer(api, 'stdio');
      const [a, b] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 't', version: '0.0.0' });
      await Promise.all([server.connect(b), client.connect(a)]);
      try {
        const result = await client.callTool({ name, arguments: args });
        const content = result.content as Array<{ type: string; text?: string }>;
        return { isError: result.isError === true, text: content.map((part) => part.text ?? '').join('\n') };
      } finally {
        await client.close();
      }
    },
  };
}

const PERSONAS = { personas: [{ id: MARIA, name: 'Maria', niche: 'cooking' }] };

describe('personas get', () => {
  it('joins the persona, its library size and its bound accounts in one call', async () => {
    const { call, seen } = setup({
      'GET /api/persona/list': PERSONAS,
      'GET /api/persona/images': { images: [{ id: 'i1' }, { id: 'i2' }] },
      'GET /api/persona/publishing-accounts': { success: true, defaults: { youtube: ['UC1'] } },
    });
    const result = await call('personas', { action: 'get', persona: 'maria' });
    expect(result.isError).toBe(false);
    const body = JSON.parse(result.text.slice(result.text.indexOf('{')));
    expect(body).toMatchObject({ persona: { id: MARIA, name: 'Maria' }, libraryImages: 2, boundAccounts: { youtube: ['UC1'] } });
    expect(seen.map((request) => request.path)).toEqual(expect.arrayContaining([`/api/persona/images?personaId=${MARIA}`, `/api/persona/publishing-accounts?personaId=${MARIA}`]));
  });

  it('says there is no persona with that id instead of returning an empty record', async () => {
    const { call } = setup({ 'GET /api/persona/list': PERSONAS, 'GET /api/persona/images': { images: [] }, 'GET /api/persona/publishing-accounts': { defaults: {} } });
    const result = await call('personas', { action: 'get', persona: '99999999-9999-4999-8999-999999999999' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('No persona with id');
  });
});

describe('personas delete over the server', () => {
  it('previews first, deletes only with that preview’s token', async () => {
    const { call, seen } = setup({ 'GET /api/persona/delete-preview': { persona: { id: MARIA, name: 'Maria' }, counts: { schedules: 1 }, videos: [] }, 'DELETE /api/persona': { success: true } });
    const preview = await call('personas', { action: 'delete', persona: MARIA });
    expect(preview.isError).toBe(false);
    expect(seen.some((request) => request.method === 'DELETE')).toBe(false);
    const token = /confirmToken "([0-9a-f]+)"/.exec(preview.text)?.[1];
    expect(token).toBeDefined();
    const deleted = await call('personas', { action: 'delete', persona: MARIA, confirmToken: token });
    expect(deleted.isError).toBe(false);
    expect(seen.filter((request) => request.method === 'DELETE')).toHaveLength(1);
  });
});

const ACCOUNTS = {
  accounts: [
    { provider: 'youtube', channelId: 'UC1', channelName: 'Maria' },
    { provider: 'instagram', igUserId: '9', username: 'maria' },
    { provider: 'pinterest', providerAccountId: 'PIN1', accountName: 'Maria Pins' },
  ],
};

describe('accounts', () => {
  it('disconnects an account given by name, with the network read from the account', async () => {
    const { call, seen } = setup({ 'GET /api/account': ACCOUNTS });
    const result = await call('accounts', { action: 'disconnect', account: 'Maria Pins' });
    expect(result.isError).toBe(false);
    const request = seen.find((entry) => entry.method === 'DELETE');
    expect(request?.path).toBe('/api/account?provider=pinterest&providerAccountId=PIN1');
  });

  it('answers an ambiguous name with candidates and disconnects nothing', async () => {
    const { call, seen } = setup({ 'GET /api/account': ACCOUNTS });
    const result = await call('accounts', { action: 'disconnect', account: 'maria' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toMatchObject({ ambiguous: true, actionTaken: false });
    expect(seen.some((request) => request.method === 'DELETE')).toBe(false);
  });

  it('narrows an ambiguous name with the provider', async () => {
    const { call, seen } = setup({ 'GET /api/account': ACCOUNTS });
    await call('accounts', { action: 'disconnect', account: 'maria', provider: 'instagram' });
    expect(seen.find((entry) => entry.method === 'DELETE')?.path).toBe('/api/account?provider=instagram&providerAccountId=9');
  });

  it('lists the boards of a Pinterest account given by name, using its id', async () => {
    const { call, seen } = setup({ 'GET /api/account': ACCOUNTS, 'GET /api/pinterest/boards': { boards: [{ id: 'b1', name: 'Board' }] } });
    const result = await call('accounts', { action: 'list_boards', account: 'Maria Pins' });
    expect(result.isError).toBe(false);
    expect(seen.some((request) => request.path === '/api/pinterest/boards?accountId=PIN1')).toBe(true);
  });

  it('does not take a youtube account for list_boards', async () => {
    const { call, seen } = setup({ 'GET /api/account': ACCOUNTS });
    const result = await call('accounts', { action: 'list_boards', account: 'UC1' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('on pinterest');
    expect(seen.some((request) => request.path.startsWith('/api/pinterest'))).toBe(false);
  });

  it('keeps the whole listing when the provider filter is not given', async () => {
    const { call } = setup({ 'GET /api/account': ACCOUNTS });
    // The first block is the listing; a recipe nudge may follow it as its own block.
    const first = (text: string): unknown => JSON.parse(text.slice(0, text.indexOf('\nNext step') === -1 ? undefined : text.indexOf('\nNext step')));
    const all = first((await call('accounts', { action: 'list' })).text) as { accounts: unknown[] };
    expect(all.accounts).toHaveLength(3);
    const some = first((await call('accounts', { action: 'list', provider: 'pinterest' })).text) as { accounts: unknown[] };
    expect(some.accounts).toEqual([ACCOUNTS.accounts[2]]);
  });
});

describe('experiments and check_script with a persona by name', () => {
  it('creates an experiment for a persona given by name', async () => {
    const { call, seen } = setup({ 'GET /api/persona/list': PERSONAS, 'POST /api/experiments': { success: true } });
    const result = await call('experiments', {
      action: 'create',
      name: 'Calm vs bold',
      persona: 'Maria',
      variants: [{ variantId: 'hook-calm', name: 'Calm', description: 'calm' }, { variantId: 'hook-bold', name: 'Bold', description: 'bold' }],
    });
    expect(result.isError).toBe(false);
    expect(seen.find((request) => request.method === 'POST')?.body).toMatchObject({ personaId: MARIA, name: 'Calm vs bold' });
  });

  it('creates an experiment with no persona when none is given', async () => {
    const { call, seen } = setup({ 'POST /api/experiments': { success: true } });
    await call('experiments', {
      action: 'create',
      name: 'Faceless',
      variants: [{ variantId: 'hook-a', name: 'A', description: 'a' }, { variantId: 'hook-b', name: 'B', description: 'b' }],
    });
    expect(seen.find((request) => request.method === 'POST')?.body).toMatchObject({ personaId: null });
  });

  it('scores a draft against the measured posts of a persona given by name', async () => {
    const { call, seen } = setup({ 'GET /api/persona/list': PERSONAS, 'POST /api/videos/score-draft': { score: 80 } });
    const result = await call('check_script', { action: 'score', draft: 'A short draft about training plans that is long enough.', network: 'youtube', persona: 'Maria' });
    expect(result.isError).toBe(false);
    expect(seen.find((request) => request.path === '/api/videos/score-draft')?.body).toMatchObject({ personaId: MARIA });
  });
});

describe('video_tasks over the server', () => {
  it('takes a snapshot of several tasks by default and tags the request with the action', async () => {
    const { call, seen } = setup({
      'GET /api/persona/video-status/t1': { body: { task_id: 't1', state: 4, progress: 30, stage: 'audio' } },
      'GET /api/persona/video-status/t2': { body: { task_id: 't2', state: 1, progress: 100 } },
    });
    const result = await call('video_tasks', { action: 'status', taskIds: ['t1', 't2'] });
    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.text.slice(result.text.indexOf('{')));
    expect(parsed.results.map((entry: { outcome: string }) => entry.outcome)).toEqual(['running', 'completed']);
    expect(seen).toHaveLength(2);
  });
});

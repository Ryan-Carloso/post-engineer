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

const PERSONAS = { authenticated: true, personas: [{ id: MARIA, name: 'Maria', createdAt: '2026-01-01T00:00:00Z', boundAccounts: { youtube: [], instagram: [], bluesky: [], linkedin: [], threads: [], facebook: [], pinterest: [], '3speak': [], rumble: [], fanvue: [], telegram: [] }, niche: 'cooking' }] };

describe('personas get', () => {
  it('joins the persona, its library size and its bound accounts in one call', async () => {
    const { call, seen } = setup({
      'GET /api/persona/list': PERSONAS,
      'GET /api/persona/images': { success: true, images: [{ id: 'i1', tag: 'casual', description: '', is_primary: false, created_at: '2026-01-01T00:00:00Z', image_url: null }, { id: 'i2', tag: 'formal', description: '', is_primary: false, created_at: '2026-01-01T00:00:00Z', image_url: null }] },
      'GET /api/persona/publishing-accounts': { success: true, defaults: { youtube: ['UC1'], instagram: [], bluesky: ['did:plc:abc'], linkedin: [], threads: [], facebook: [], pinterest: [], '3speak': [], rumble: [], fanvue: [], telegram: [] } },
    });
    const result = await call('personas', { action: 'get', persona: 'maria' });
    expect(result.isError).toBe(false);
    const body = JSON.parse(result.text.slice(result.text.indexOf('{')));
    expect(body).toMatchObject({ persona: { id: MARIA, name: 'Maria' }, libraryImages: 2, boundAccounts: { youtube: ['UC1'] } });
    expect(seen.map((request) => request.path)).toEqual(expect.arrayContaining([`/api/persona/images?personaId=${MARIA}`, `/api/persona/publishing-accounts?personaId=${MARIA}`]));
  });

  it('says there is no persona with that id instead of returning an empty record', async () => {
    const { call } = setup({ 'GET /api/persona/list': PERSONAS, 'GET /api/persona/images': { success: true, images: [] }, 'GET /api/persona/publishing-accounts': { success: true, defaults: { youtube: [], instagram: [], bluesky: [], linkedin: [], threads: [], facebook: [], pinterest: [], '3speak': [], rumble: [], fanvue: [], telegram: [] } } });
    const result = await call('personas', { action: 'get', persona: '99999999-9999-4999-8999-999999999999' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('No persona with id');
  });
});

describe('personas delete over the server', () => {
  it('previews first, deletes only with that preview’s token', async () => {
    const { call, seen } = setup({ 'GET /api/persona/delete-preview': { success: true, persona: { id: MARIA, name: 'Maria' }, counts: { schedules: 1, upcomingSlots: 0, publishedSlots: 0, failedSlots: 0, generatedVideos: 0, personaImages: 0 }, videos: [], videosTruncated: false, linksIncomplete: false }, 'DELETE /api/persona': { success: true } });
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
  authenticated: true,
  accounts: [
    { provider: 'youtube', recordId: 'rec-1', channelId: 'UC1', channelName: 'Maria', connectedAt: 1700000000000, lastUsed: 1700000000000 },
    { provider: 'instagram', recordId: 'rec-2', igUserId: '9', username: 'maria', connectedAt: 1700000000000, lastUsed: 1700000000000 },
    { provider: 'pinterest', recordId: 'rec-3', providerAccountId: 'PIN1', accountName: 'Maria Pins', connectedAt: 1700000000000, lastUsed: 1700000000000 },
  ],
  message: 'Accounts retrieved from Supabase',
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

  it('resolves against the accounts as they are on each call, not as they were on the first one', async () => {
    const seen: string[] = [];
    let accounts: unknown = {
      authenticated: true,
      accounts: [{ provider: 'youtube', recordId: 'rec-1', channelId: 'UC1', channelName: 'Maria', connectedAt: 1700000000000, lastUsed: 1700000000000 }],
      message: 'Accounts retrieved from Supabase',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const parsed = new URL(url);
        seen.push(`${init.method ?? 'GET'} ${parsed.pathname}${parsed.search}`);
        return Response.json(parsed.pathname === '/api/account' && (init.method ?? 'GET') === 'GET' ? accounts : { success: true });
      }),
    );
    const server = createPostEngineerMcpServer(new PostEngineerClient({ apiKey: 'pe_test', baseUrl: BASE }), 'stdio');
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 't', version: '0.0.0' });
    await Promise.all([server.connect(b), client.connect(a)]);
    try {
      expect((await client.callTool({ name: 'accounts', arguments: { action: 'disconnect', account: 'Maria' } })).isError).not.toBe(true);
      // The user reconnects another account; the same server must see it.
      accounts = {
        authenticated: true,
        accounts: [{ provider: 'instagram', recordId: 'rec-2', igUserId: '9', username: 'new.account', connectedAt: 1700000000000, lastUsed: 1700000000000 }],
        message: 'Accounts retrieved from Supabase',
      };
      expect((await client.callTool({ name: 'accounts', arguments: { action: 'disconnect', account: 'new.account' } })).isError).not.toBe(true);
    } finally {
      await client.close();
    }
    expect(seen.filter((entry) => entry.startsWith('DELETE'))).toEqual([
      'DELETE /api/account?provider=youtube&providerAccountId=UC1',
      'DELETE /api/account?provider=instagram&providerAccountId=9',
    ]);
  });

  it('lists the boards of a Pinterest account given by name, using its id', async () => {
    const { call, seen } = setup({ 'GET /api/account': ACCOUNTS, 'GET /api/pinterest/boards': { success: true, boards: [{ id: 'b1', name: 'Board' }] } });
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
    const { call, seen } = setup({ 'GET /api/persona/list': PERSONAS, 'POST /api/experiments': { success: true, experiment: { id: '22222222-2222-4222-8222-222222222222', name: 'Calm vs bold', variable: 'hook', personaId: MARIA, targetPairs: 6, variants: [{ variantId: 'hook-calm', name: 'Calm', description: 'calm' }, { variantId: 'hook-bold', name: 'Bold', description: 'bold' }] } } });
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
    const { call, seen } = setup({ 'POST /api/experiments': { success: true, experiment: { id: '22222222-2222-4222-8222-222222222222', name: 'Faceless', variable: 'hook', personaId: null, targetPairs: 6, variants: [{ variantId: 'hook-a', name: 'A', description: 'a' }, { variantId: 'hook-b', name: 'B', description: 'b' }] } } });
    await call('experiments', {
      action: 'create',
      name: 'Faceless',
      variants: [{ variantId: 'hook-a', name: 'A', description: 'a' }, { variantId: 'hook-b', name: 'B', description: 'b' }],
    });
    expect(seen.find((request) => request.method === 'POST')?.body).toMatchObject({ personaId: null });
  });

  it('scores a draft against the measured posts of a persona given by name', async () => {
    const { call, seen } = setup({ 'GET /api/persona/list': PERSONAS, 'POST /api/videos/score-draft': {
        success: true, score: 80, reasons: [],
        counts: { chars: 0, words: 0, hashtags: 0, links: 0, firstLineWords: 0, slopHits: [], topThemeMatch: null },
        baseline: { postsMeasured: 0, topAngles: [], medianEngagement: null, bestEngagement: null, truncated: false },
        publishCheck: null,
      } });
    const result = await call('check_script', { action: 'score', draft: 'A short draft about training plans that is long enough.', network: 'youtube', persona: 'Maria' });
    expect(result.isError).toBe(false);
    expect(seen.find((request) => request.path === '/api/videos/score-draft')?.body).toMatchObject({ personaId: MARIA });
  });
});

describe('video_tasks over the server', () => {
  it('takes a snapshot of several tasks by default and tags the request with the action', async () => {
    const { call, seen } = setup({
      'GET /api/persona/video-status/t1': { status: 200, message: 'success', body: { task_id: 't1', state: 4, progress: 30, stage: 'audio' } },
      'GET /api/persona/video-status/t2': { status: 200, message: 'success', body: { task_id: 't2', state: 1, progress: 100 } },
    });
    const result = await call('video_tasks', { action: 'status', taskIds: ['t1', 't2'] });
    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.text.slice(result.text.indexOf('{')));
    expect(parsed.results.map((entry: { outcome: string }) => entry.outcome)).toEqual(['running', 'completed']);
    expect(seen).toHaveLength(2);
  });
});

describe('malformed API payloads are reported, not turned into empty results', () => {
  it('reports a listing without an accounts array as a malformed response', async () => {
    const { call } = setup({ 'GET /api/account': { message: 'odd' } });
    const result = await call('accounts', { action: 'list', provider: 'youtube' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Malformed response from GET /api/account');
  });

  it('passes an accounts failure through when filtering by provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const api = new PostEngineerClient({ apiKey: 'pe_test', baseUrl: BASE });
    const server = createPostEngineerMcpServer(api, 'stdio');
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 't', version: '0.0.0' });
    await Promise.all([server.connect(b), client.connect(a)]);
    try {
      const result = await client.callTool({ name: 'accounts', arguments: { action: 'list', provider: 'youtube' } });
      expect(result.isError).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('personas get reports a null library size and null bindings when those payloads are malformed', async () => {
    const { call } = setup({ 'GET /api/persona/list': PERSONAS, 'GET /api/persona/images': 'odd', 'GET /api/persona/publishing-accounts': 'odd' });
    const result = await call('personas', { action: 'get', persona: MARIA });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text.slice(result.text.indexOf('{')))).toMatchObject({ libraryImages: null, boundAccounts: null });
  });

  it('personas get reports a malformed listing as an error instead of "no persona"', async () => {
    const { call } = setup({ 'GET /api/persona/list': { personas: 'nope' }, 'GET /api/persona/images': { success: true, images: [] }, 'GET /api/persona/publishing-accounts': { success: true, defaults: { youtube: [], instagram: [], bluesky: [], linkedin: [], threads: [], facebook: [], pinterest: [], '3speak': [], rumble: [], fanvue: [], telegram: [] } } });
    const result = await call('personas', { action: 'get', persona: MARIA });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Malformed response from GET /api/persona/list');
  });
});

describe('tool_config', () => {
  const PRESENCE = {
    success: true,
    configured: true,
    searchTool: 'tavily',
    stockSources: ['pexels'],
    keysPresent: { tavily: true, exa: false, pexels: true, pixabay: false, coverr: false },
    keysLast4: { tavily: '1234', exa: null, pexels: '5678', pixabay: null, coverr: null },
  };

  it('get reads the saved configuration and never sees a key value', async () => {
    const { call, seen } = setup({
      'GET /api/tool-config': { ...PRESENCE, keys: { tavily: 'tvly-fake-key-1234' } },
    });
    const result = await call('tool_config', { action: 'get' });
    expect(result.isError).toBe(false);
    expect(seen.map((request) => `${request.method} ${request.path}`)).toEqual(['GET /api/tool-config']);
    expect(result.text).toContain('"tavily": true');
    expect(result.text).not.toContain('tvly-fake-key-1234');
  });

  it('save sends the whole configuration and reports presence only', async () => {
    const { call, seen } = setup({ 'PUT /api/tool-config': PRESENCE });
    const config = {
      searchTool: 'tavily',
      stockSources: ['pexels'],
      keys: { tavily: 'tvly-fake-key-1234', pexels: 'pxls-fake-key-5678' },
    };
    const result = await call('tool_config', { action: 'save', ...config });
    expect(result.isError).toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe('PUT');
    expect(seen[0]?.path).toBe('/api/tool-config');
    expect(seen[0]?.body).toEqual(config);
    expect(result.text).toContain('Tool configuration saved successfully');
    expect(result.text).not.toContain('tvly-fake-key-1234');
  });

  it('save fails fast in the tool when a required field is missing, sending nothing', async () => {
    const { call, seen } = setup({ 'PUT /api/tool-config': PRESENCE });
    const result = await call('tool_config', { action: 'save', searchTool: 'tavily' });
    expect(result.isError).toBe(true);
    expect(seen).toHaveLength(0);
  });
});

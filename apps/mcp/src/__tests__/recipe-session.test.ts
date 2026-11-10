import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  MCP_NUDGED_BY_HEADER,
  MCP_RECIPE_FETCHED_HEADER,
  MCP_RECIPE_HEADER,
  MCP_RECIPES_KNOWN_HEADER,
  MCP_SCRIPT_REJECTIONS_HEADER,
  MCP_SESSION_ID_HEADER,
  MCP_TRANSPORT_HEADER,
  RECIPE_NUDGE_TEXT,
  RecipeSession,
  SCRIPT_REJECTED_RECIPE_HINT,
  withRecipeNudge,
  withScriptOutcome,
} from '../recipe-session.js';
import { MCP_TOOL_HEADER } from '../analytics.js';
import { createPostEngineerMcpServer } from '../index.js';
import { PostEngineerClient } from '../client.js';
import type { McpToolResponse } from '../tools-call.js';

//---------------
// Recipe adoption: the nudges an agent sees before it meets the recipes,
// and the X-MCP-* headers that carry the session state to the web API
// (which records them on mcp_tool_called). Runs the real analytics module
// and API client against a fetch mock answering the real route envelopes,
// so the headers asserted are the ones that go on the wire.
//---------------

const BASE_URL = 'https://api.example.test';

const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.';
const body =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const cta = 'Save this video before your next trip to Porto.';
function photos(count: number, prefix: string): Array<{ url: string }> {
  return Array.from({ length: count }, (_, i) => ({ url: `https://example.com/${prefix}-${i + 1}.jpg` }));
}

const validSegments = [
  { kind: 'hook' as const, text: hook, media: photos(3, 'hook') },
  { kind: 'body' as const, text: body, media: photos(6, 'body') },
  { kind: 'cta' as const, text: cta, media: photos(2, 'cta') },
];
// Too short: the mechanical validator rejects it before any request.
const rejectedSegments = [
  { kind: 'hook' as const, text: 'Short hook.' },
  { kind: 'body' as const, text: 'Short body.' },
  { kind: 'cta' as const, text: 'Follow now.' },
];

type FetchArgs = [url: string, init: RequestInit];

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function apiResponse(url: string): Response {
  const path = new URL(url).pathname;
  if (path === '/api/prompts') {
    return json(200, { success: true, prompts: [{ slug: 'place-spotlight', title: 'Place', description: 'A place.' }] });
  }
  if (path === '/api/prompts/place-spotlight') {
    return json(200, {
      success: true,
      prompt: { slug: 'place-spotlight', title: 'Place', description: 'A place.', prompt: 'Place recipe text.' },
    });
  }
  if (path.startsWith('/api/prompts/')) {
    return json(404, { success: false, error: 'Unknown prompt slug.', code: 'PROMPT_NOT_FOUND' });
  }
  if (path === '/api/persona/list') return json(200, { success: true, personas: [] });
  if (path === '/api/billing/tokens') return json(200, { success: true, balance: 10 });
  if (path === '/api/videos/generate-and-schedule') {
    return json(200, {
      success: true,
      schedule: { id: 'sch-1', mode: 'asap' },
      slots: [{ slotId: 's1', slotAt: null, title: 'Porto trip', taskId: 'task-1', status: 'queued' }],
      replayed: false,
    });
  }
  return json(404, { success: false, error: `unexpected path ${path}` });
}

let fetchMock: ReturnType<typeof vi.fn<(...args: FetchArgs) => Promise<Response>>>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, _init: RequestInit) => apiResponse(url));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function requestHeaders(path: string): Array<Record<string, string>> {
  return fetchMock.mock.calls
    .filter(([url]) => new URL(url).pathname === path)
    .map(([, init]) => init.headers as Record<string, string>);
}

function texts(result: CallToolResult | McpToolResponse | { toolResult?: unknown }): string[] {
  if (!('content' in result)) return [];
  return result.content.map((block) => ('text' in block ? String(block.text) : ''));
}

function ok(text: string): McpToolResponse {
  return { content: [{ type: 'text', text }] };
}

function fail(text: string): McpToolResponse {
  return { content: [{ type: 'text', text }], isError: true };
}

describe('RecipeSession.telemetryHeaders', () => {
  it('reports a fresh session: its id, transport, no nudge, recipes unknown, nothing fetched, no rejections', () => {
    const session = new RecipeSession('http');
    expect(session.telemetryHeaders(undefined)).toEqual({
      [MCP_SESSION_ID_HEADER]: session.sessionId,
      [MCP_TRANSPORT_HEADER]: 'http',
      [MCP_NUDGED_BY_HEADER]: 'none',
      [MCP_RECIPES_KNOWN_HEADER]: 'false',
      [MCP_RECIPE_FETCHED_HEADER]: 'none',
      [MCP_SCRIPT_REJECTIONS_HEADER]: '0',
    });
    expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new RecipeSession('stdio').sessionId).not.toBe(session.sessionId);
  });

  it('reports the last nudge, the fetched recipe and the rejection count', () => {
    const session = new RecipeSession('stdio');
    session.recordNudgeShown('list_personas');
    session.recordNudgeShown('get_token_balance');
    session.recordScriptRejected();
    session.recordScriptRejected();
    session.recordRecipeFetched('daily-news');
    expect(session.telemetryHeaders('daily-news')).toMatchObject({
      [MCP_NUDGED_BY_HEADER]: 'get_token_balance',
      [MCP_RECIPES_KNOWN_HEADER]: 'true',
      [MCP_RECIPE_FETCHED_HEADER]: 'daily-news',
      [MCP_SCRIPT_REJECTIONS_HEADER]: '2',
      [MCP_RECIPE_HEADER]: 'daily-news',
    });
  });

  it('never sends a recipe that is not slug-shaped', () => {
    const session = new RecipeSession('stdio');
    session.recordRecipeFetched('Bearer abc.def');
    const headers = session.telemetryHeaders('Bearer pe_live_secret');
    expect(headers).not.toHaveProperty(MCP_RECIPE_HEADER);
    expect(headers[MCP_RECIPE_FETCHED_HEADER]).toBe('none');
    expect(session.knowsRecipes()).toBe(false);
  });

  it('saturates the rejection counter at 999', () => {
    const session = new RecipeSession('stdio');
    for (let i = 0; i < 1005; i += 1) session.recordScriptRejected();
    expect(session.telemetryHeaders(undefined)[MCP_SCRIPT_REJECTIONS_HEADER]).toBe('999');
  });
});

describe('withRecipeNudge', () => {
  it('appends the nudge as a second block and keeps the payload block first', async () => {
    const session = new RecipeSession('stdio');
    const wrapped = withRecipeNudge(session, 'list_personas', async () => ok('[{"id":"p1"}]'));
    expect(texts(await wrapped({}))).toEqual(['[{"id":"p1"}]', RECIPE_NUDGE_TEXT]);
    expect(session.telemetryHeaders(undefined)[MCP_NUDGED_BY_HEADER]).toBe('list_personas');
  });

  it('leaves an error response untouched', async () => {
    const session = new RecipeSession('stdio');
    const wrapped = withRecipeNudge(session, 'list_personas', async () => fail('boom'));
    expect(texts(await wrapped({}))).toEqual(['boom']);
    expect(session.telemetryHeaders(undefined)[MCP_NUDGED_BY_HEADER]).toBe('none');
  });

  it('stops nudging once the agent listed the recipes', async () => {
    const session = new RecipeSession('stdio');
    session.recordRecipesListed();
    const wrapped = withRecipeNudge(session, 'get_token_balance', async () => ok('{"balance":10}'));
    expect(texts(await wrapped({}))).toEqual(['{"balance":10}']);
  });
});

describe('withScriptOutcome', () => {
  it('leaves an accepted script alone and counts no rejection', async () => {
    const session = new RecipeSession('stdio');
    const wrapped = withScriptOutcome(session, 'generate_persona_video', async () => ok('Scheduled'));
    expect(texts(await wrapped({ segments: validSegments }))).toEqual(['Scheduled']);
    expect(session.telemetryHeaders(undefined)[MCP_SCRIPT_REJECTIONS_HEADER]).toBe('0');
  });

  it('counts a validator rejection and appends the recipe hint', async () => {
    const session = new RecipeSession('stdio');
    const wrapped = withScriptOutcome(session, 'validate_script', async () => fail('Script validation failed'));
    expect(texts(await wrapped({ segments: rejectedSegments }))).toEqual([
      'Script validation failed',
      SCRIPT_REJECTED_RECIPE_HINT,
    ]);
    expect(session.telemetryHeaders(undefined)).toMatchObject({
      [MCP_SCRIPT_REJECTIONS_HEADER]: '1',
      [MCP_NUDGED_BY_HEADER]: 'validate_script',
    });
  });

  it('does not count an error on a valid script as a rejection', async () => {
    const session = new RecipeSession('stdio');
    const wrapped = withScriptOutcome(session, 'generate_persona_video', async () => fail('Insufficient tokens'));
    expect(texts(await wrapped({ segments: validSegments }))).toEqual(['Insufficient tokens']);
    expect(session.telemetryHeaders(undefined)[MCP_SCRIPT_REJECTIONS_HEADER]).toBe('0');
  });

  it('counts but does not hint a rejected script that already came from a recipe', async () => {
    const session = new RecipeSession('stdio');
    const wrapped = withScriptOutcome(session, 'generate_persona_video', async () => fail('hook: too short'));
    expect(texts(await wrapped({ segments: rejectedSegments, recipe: 'daily-news' }))).toEqual(['hook: too short']);
    expect(session.telemetryHeaders(undefined)[MCP_SCRIPT_REJECTIONS_HEADER]).toBe('1');
  });
});

describe('recipe adoption through the registered server', () => {
  async function withServer(transport: 'stdio' | 'http', run: (mcp: Client) => Promise<void>): Promise<void> {
    const api = new PostEngineerClient({ apiKey: 'pe_test', baseUrl: BASE_URL });
    const server = createPostEngineerMcpServer(api, transport);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcp = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
    try {
      await run(mcp);
    } finally {
      await mcp.close();
    }
  }

  const generateArgs = {
    personaId: 'persona-1',
    segments: validSegments,
    title: 'Porto trip',
    providers: ['youtube'],
    youtubeAccountIds: ['acct-1'],
    mode: 'asap',
  };

  it('nudges on list_personas, attributes list_prompts to it, then stops nudging', async () => {
    await withServer('stdio', async (mcp) => {
      const first = await mcp.callTool({ name: 'list_personas', arguments: {} });
      expect(texts(first)).toContain(RECIPE_NUDGE_TEXT);
      expect(requestHeaders('/api/persona/list')[0]).toMatchObject({
        [MCP_TOOL_HEADER]: 'list_personas',
        [MCP_NUDGED_BY_HEADER]: 'none',
        [MCP_RECIPES_KNOWN_HEADER]: 'false',
        [MCP_TRANSPORT_HEADER]: 'stdio',
      });
      await mcp.callTool({ name: 'list_prompts', arguments: {} });
      expect(requestHeaders('/api/prompts')[0]).toMatchObject({
        [MCP_TOOL_HEADER]: 'list_prompts',
        [MCP_NUDGED_BY_HEADER]: 'list_personas',
      });
      const second = await mcp.callTool({ name: 'list_personas', arguments: {} });
      expect(texts(second)).not.toContain(RECIPE_NUDGE_TEXT);
      expect(requestHeaders('/api/persona/list')[1]).toMatchObject({ [MCP_RECIPES_KNOWN_HEADER]: 'true' });
    });
  });

  it('sends the declared and fetched recipe on generate_persona_video, never in the body', async () => {
    await withServer('stdio', async (mcp) => {
      const fetched = await mcp.callTool({ name: 'get_prompt', arguments: { slug: 'place-spotlight' } });
      expect(texts(fetched)[0]).toContain('pass recipe: "place-spotlight"');
      expect(requestHeaders('/api/prompts/place-spotlight')[0]).toMatchObject({ [MCP_RECIPE_HEADER]: 'place-spotlight' });
      const result = await mcp.callTool({
        name: 'generate_persona_video',
        arguments: { ...generateArgs, recipe: 'place-spotlight' },
      });
      expect(result.isError).toBeFalsy();
      const [headers] = requestHeaders('/api/videos/generate-and-schedule');
      expect(headers).toMatchObject({
        [MCP_TOOL_HEADER]: 'generate_persona_video',
        [MCP_RECIPE_HEADER]: 'place-spotlight',
        [MCP_RECIPE_FETCHED_HEADER]: 'place-spotlight',
        [MCP_SCRIPT_REJECTIONS_HEADER]: '0',
      });
      const generateCall = fetchMock.mock.calls.find(([url]) => url.endsWith('/api/videos/generate-and-schedule'));
      expect(String(generateCall?.[1].body)).not.toContain('place-spotlight');
    });
  });

  it('does not record an unknown get_prompt slug as fetched', async () => {
    await withServer('stdio', async (mcp) => {
      const result = await mcp.callTool({ name: 'get_prompt', arguments: { slug: 'car-review' } });
      expect(result.isError).toBe(true);
      await mcp.callTool({ name: 'get_token_balance', arguments: {} });
      expect(requestHeaders('/api/billing/tokens')[0]).toMatchObject({
        [MCP_RECIPE_FETCHED_HEADER]: 'none',
        [MCP_RECIPES_KNOWN_HEADER]: 'false',
      });
    });
  });

  it('rejects a recipe that is not slug-shaped before any web call', async () => {
    await withServer('stdio', async (mcp) => {
      const result = await mcp.callTool({
        name: 'generate_persona_video',
        arguments: { ...generateArgs, recipe: 'Place Spotlight' },
      });
      expect(result.isError).toBe(true);
      expect(texts(result).join('\n')).toContain('recipe must be a recipe slug from list_prompts');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('hints on a rejected improvised script and reports the rejection on the next request', async () => {
    await withServer('stdio', async (mcp) => {
      const rejected = await mcp.callTool({
        name: 'generate_persona_video',
        arguments: { ...generateArgs, segments: rejectedSegments },
      });
      expect(rejected.isError).toBe(true);
      expect(texts(rejected)).toContain(SCRIPT_REJECTED_RECIPE_HINT);
      expect(fetchMock).not.toHaveBeenCalled();
      await mcp.callTool({ name: 'generate_persona_video', arguments: generateArgs });
      expect(requestHeaders('/api/videos/generate-and-schedule')[0]).toMatchObject({
        [MCP_SCRIPT_REJECTIONS_HEADER]: '1',
        [MCP_NUDGED_BY_HEADER]: 'generate_persona_video',
      });
      expect(requestHeaders('/api/videos/generate-and-schedule')[0]).not.toHaveProperty(MCP_RECIPE_HEADER);
    });
  });

  it('tags requests from an HTTP-built server with transport http', async () => {
    await withServer('http', async (mcp) => {
      await mcp.callTool({ name: 'list_prompts', arguments: {} });
      expect(requestHeaders('/api/prompts')[0]).toMatchObject({ [MCP_TRANSPORT_HEADER]: 'http' });
    });
  });
});

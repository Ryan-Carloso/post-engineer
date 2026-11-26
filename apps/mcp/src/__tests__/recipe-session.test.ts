import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  MCP_NUDGED_BY_HEADER,
  MCP_RECIPE_FETCHED_HEADER,
  MCP_RECIPE_HEADER,
  MCP_RECIPES_KNOWN_HEADER,
  MCP_SESSION_ID_HEADER,
  MCP_TRANSPORT_HEADER,
  RECIPE_NUDGE_TEXT,
  RecipeSession,
  withRecipeNudge,
} from '../recipe-session.js';
import { MCP_TOOL_HEADER } from '../analytics.js';
import { createPostEngineerMcpServer } from '../index.js';
import { PostEngineerClient } from '../client.js';
import type { McpToolResponse } from '../tools-call.js';

const BASE_URL = 'https://api.example.test';

type FetchArgs = [url: string, init: RequestInit];

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function apiResponse(url: string): Response {
  const path = new URL(url).pathname;
  if (path === '/api/prompts') {
    return json(200, { success: true, prompts: [{ slug: 'place-spotlight', title: 'Place', description: 'A place.', source: 'own', visibility: 'public', verified: false }] });
  }
  if (path === '/api/prompts/place-spotlight') {
    return json(200, {
      success: true,
      prompt: { slug: 'place-spotlight', title: 'Place', description: 'A place.', source: 'own', visibility: 'public', verified: false, prompt: 'Place recipe text.', body: 'Place recipe text.', versionId: '44444444-4444-4444-8444-444444444444', version: 1 },
    });
  }
  if (path.startsWith('/api/prompts/')) {
    return json(404, { success: false, error: 'Unknown prompt slug.', code: 'PROMPT_NOT_FOUND' });
  }
  if (path === '/api/persona/list') return json(200, { authenticated: true, personas: [] });
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
  it('reports a fresh session: its id, transport, no nudge, recipes unknown, nothing fetched', () => {
    const session = new RecipeSession('http');
    expect(session.telemetryHeaders(undefined)).toEqual({
      [MCP_SESSION_ID_HEADER]: session.sessionId,
      [MCP_TRANSPORT_HEADER]: 'http',
      [MCP_NUDGED_BY_HEADER]: 'none',
      [MCP_RECIPES_KNOWN_HEADER]: 'false',
      [MCP_RECIPE_FETCHED_HEADER]: 'none',
    });
    expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new RecipeSession('stdio').sessionId).not.toBe(session.sessionId);
  });

  it('never sends a recipe that is not slug-shaped', () => {
    const session = new RecipeSession('stdio');
    session.recordRecipeFetched('Bearer abc.def');
    const headers = session.telemetryHeaders('Bearer pe_live_secret');
    expect(headers).not.toHaveProperty(MCP_RECIPE_HEADER);
    expect(headers[MCP_RECIPE_FETCHED_HEADER]).toBe('none');
    expect(session.knowsRecipes()).toBe(false);
  });

});

describe('withRecipeNudge', () => {
  it('appends the nudge as a second block and keeps the payload block first', async () => {
    const session = new RecipeSession('stdio');
    const wrapped = withRecipeNudge(session, 'personas_list', async () => ok('[{"id":"p1"}]'));
    expect(texts(await wrapped({}))).toEqual(['[{"id":"p1"}]', RECIPE_NUDGE_TEXT]);
    expect(session.telemetryHeaders(undefined)[MCP_NUDGED_BY_HEADER]).toBe('personas_list');
  });

  it('leaves an error response untouched', async () => {
    const session = new RecipeSession('stdio');
    const wrapped = withRecipeNudge(session, 'personas_list', async () => fail('boom'));
    expect(texts(await wrapped({}))).toEqual(['boom']);
    expect(session.telemetryHeaders(undefined)[MCP_NUDGED_BY_HEADER]).toBe('none');
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

  it('nudges on personas list, attributes prompts list to it, then stops nudging', async () => {
    await withServer('stdio', async (mcp) => {
      const first = await mcp.callTool({ name: 'personas', arguments: { action: 'list' } });
      expect(texts(first)).toContain(RECIPE_NUDGE_TEXT);
      expect(requestHeaders('/api/persona/list')[0]).toMatchObject({
        [MCP_TOOL_HEADER]: 'personas',
        [MCP_NUDGED_BY_HEADER]: 'none',
        [MCP_RECIPES_KNOWN_HEADER]: 'false',
        [MCP_TRANSPORT_HEADER]: 'stdio',
      });
      await mcp.callTool({ name: 'prompts', arguments: { action: 'list' } });
      expect(requestHeaders('/api/prompts')[0]).toMatchObject({
        [MCP_TOOL_HEADER]: 'prompts',
        [MCP_NUDGED_BY_HEADER]: 'personas_list',
      });
      const second = await mcp.callTool({ name: 'personas', arguments: { action: 'list' } });
      expect(texts(second)).not.toContain(RECIPE_NUDGE_TEXT);
      expect(requestHeaders('/api/persona/list')[1]).toMatchObject({ [MCP_RECIPES_KNOWN_HEADER]: 'true' });
    });
  });

  it('sends the fetched recipe header on the prompt get and tells the agent to pass promptVersionId', async () => {
    await withServer('stdio', async (mcp) => {
      const fetched = await mcp.callTool({ name: 'prompts', arguments: { action: 'get', slug: 'place-spotlight' } });
      expect(texts(fetched)[0]).toContain('pass promptVersionId: "44444444-4444-4444-8444-444444444444"');
      expect(texts(fetched)[0]).toContain('publish_existing');
      expect(requestHeaders('/api/prompts/place-spotlight')[0]).toMatchObject({ [MCP_RECIPE_HEADER]: 'place-spotlight' });
      await mcp.callTool({ name: 'personas', arguments: { action: 'list' } });
      expect(requestHeaders('/api/persona/list')[0]).toMatchObject({ [MCP_RECIPE_FETCHED_HEADER]: 'place-spotlight' });
    });
  });

  it('does not record an unknown prompts get slug as fetched', async () => {
    await withServer('stdio', async (mcp) => {
      const result = await mcp.callTool({ name: 'prompts', arguments: { action: 'get', slug: 'car-review' } });
      expect(result.isError).toBe(true);
      await mcp.callTool({ name: 'personas', arguments: { action: 'list' } });
      expect(requestHeaders('/api/persona/list')[0]).toMatchObject({
        [MCP_RECIPE_FETCHED_HEADER]: 'none',
        [MCP_RECIPES_KNOWN_HEADER]: 'false',
      });
    });
  });

  it('tags requests from an HTTP-built server with transport http', async () => {
    await withServer('http', async (mcp) => {
      await mcp.callTool({ name: 'prompts', arguments: { action: 'list' } });
      expect(requestHeaders('/api/prompts')[0]).toMatchObject({ [MCP_TRANSPORT_HEADER]: 'http' });
    });
  });
});

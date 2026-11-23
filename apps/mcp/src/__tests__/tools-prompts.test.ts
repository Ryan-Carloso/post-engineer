import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { InitializeResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  SERVER_INSTRUCTIONS,
  ListPromptsShape,
  GetPromptShape,
  handleListPrompts,
  handleGetPrompt,
} from '../tools-prompts.js';
import { createPostEngineerMcpServer } from '../index.js';
import { PostEngineerClient } from '../client.js';
import { MCP_ACTION_HEADER, MCP_TOOL_HEADER } from '../analytics.js';
import { COMMUNITY_PROMPT_NOTICE, MCP_RECIPES_KNOWN_HEADER, recipeRunText } from '../recipe-session.js';

const BASE_URL = 'https://api.example.test';

const SHAPE = { source: 'own', visibility: 'public', verified: false } as const;

const CATALOG = [
  { slug: 'daily-news', title: 'Daily news becomes a video', description: 'Turn one news story into a video.', ...SHAPE },
  { slug: 'full-setup', title: 'Full setup becomes videos', description: 'Connect accounts and publish.', ...SHAPE },
];

const VERSION_ID = '44444444-4444-4444-8444-444444444444';

const PROMPT_TEXT: Record<string, string> = {
  'daily-news': 'Daily news recipe: call validate_script, then generate_persona_video.',
  'full-setup': 'Full setup recipe: list_personas, get_token_balance, then generate_persona_video.',
};

type FetchArgs = [url: string, init: RequestInit];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function apiResponse(url: string): Response {
  const path = new URL(url).pathname;
  if (path === '/api/prompts') return json(200, { success: true, prompts: CATALOG });
  const slug = decodeURIComponent(path.replace('/api/prompts/', ''));
  const entry = CATALOG.find((candidate) => candidate.slug === slug);
  if (entry === undefined) {
    return json(404, { success: false, error: 'Unknown prompt slug.', code: 'PROMPT_NOT_FOUND' });
  }
  return json(200, { success: true, prompt: { ...entry, prompt: PROMPT_TEXT[slug], body: PROMPT_TEXT[slug], versionId: VERSION_ID, version: 1 } });
}

let fetchMock: ReturnType<typeof vi.fn<(...args: FetchArgs) => Promise<Response>>>;

function client(): PostEngineerClient {
  return new PostEngineerClient({ apiKey: 'pe_test', baseUrl: BASE_URL });
}

function requestedPaths(): string[] {
  return fetchMock.mock.calls.map(([url]) => new URL(url).pathname);
}

function requestedUrls(): string[] {
  return fetchMock.mock.calls.map(([url]) => {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  });
}

function toolHeaders(): Array<string | undefined> {
  return fetchMock.mock.calls.map(([, init]) => (init.headers as Record<string, string>)[MCP_TOOL_HEADER]);
}

function actionHeaders(): Array<string | undefined> {
  return fetchMock.mock.calls.map(([, init]) => (init.headers as Record<string, string>)[MCP_ACTION_HEADER]);
}

function textOf(result: CallToolResult | { toolResult?: unknown }): string {
  if (!('content' in result)) return '';
  const first = result.content[0];
  return first !== undefined && 'text' in first ? String(first.text) : '';
}

async function withMcpClient(run: (mcp: Client) => Promise<void>): Promise<void> {
  const server = createPostEngineerMcpServer(client());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  try {
    await run(mcp);
  } finally {
    await mcp.close();
  }
}

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, _init: RequestInit) => apiResponse(url));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('handleListPrompts', () => {
  it('returns the API catalog as slug + title + description', async () => {
    const result = await handleListPrompts(client());
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual(CATALOG);
    expect(requestedPaths()).toEqual(['/api/prompts']);
  });

  it('surfaces an API failure as a tool error, never an empty list', async () => {
    fetchMock.mockResolvedValueOnce(json(500, { success: false, error: 'boom' }));
    const result = await handleListPrompts(client());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Error listing prompts');
  });

  it('rejects a malformed 200 body', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { success: true, prompts: [{ slug: 'x' }] }));
    const result = await handleListPrompts(client());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Malformed response from GET /api/prompts');
  });

  it('sends the search words and the source as query parameters', async () => {
    const result = await handleListPrompts(client(), { query: '  daily news ', source: 'community' });
    expect(JSON.parse(textOf(result))).toEqual(CATALOG);
    expect(requestedUrls()).toEqual(['/api/prompts?q=daily+news&source=community']);
  });

  it('sends no query string when the filters are empty', async () => {
    await handleListPrompts(client(), { query: '   ' });
    expect(requestedUrls()).toEqual(['/api/prompts']);
  });

  it('rejects an unknown source and an over-long query before any request', async () => {
    const unknownSource = await handleListPrompts(client(), { source: 'mine' });
    const longQuery = await handleListPrompts(client(), { query: 'x'.repeat(101) });
    expect(unknownSource.isError).toBe(true);
    expect(longQuery.isError).toBe(true);
    expect(requestedPaths()).toEqual([]);
  });

  it('takes an optional query and source for list and only a slug for get', () => {
    expect(Object.keys(ListPromptsShape)).toEqual(['query', 'source']);
    expect(Object.keys(GetPromptShape)).toEqual(['slug']);
  });
});

describe('handleGetPrompt', () => {
  it('returns the prompt text from the API plus the declare-the-recipe footer', async () => {
    const result = await handleGetPrompt(client(), { slug: 'daily-news' });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe(recipeRunText({ slug: 'daily-news', prompt: PROMPT_TEXT['daily-news'] ?? '', source: 'own', visibility: 'public', verified: false, versionId: VERSION_ID }));
    expect(textOf(result).startsWith(PROMPT_TEXT['daily-news'] ?? '-')).toBe(true);
    expect(textOf(result)).toContain(`pass recipe: "daily-news" and promptVersionId: "${VERSION_ID}"`);
    expect(requestedPaths()).toEqual(['/api/prompts/daily-news']);
  });

  it('percent-encodes the slug in the path', async () => {
    await handleGetPrompt(client(), { slug: 'a/b' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE_URL}/api/prompts/a%2Fb`);
  });

  it('rejects an unknown slug with an explicit error naming the valid slugs', async () => {
    const result = await handleGetPrompt(client(), { slug: 'car-review' });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain('unknown prompt slug "car-review"');
    expect(text).toContain('daily-news, full-setup');
    expect(requestedPaths()).toEqual(['/api/prompts/car-review', '/api/prompts']);
  });

  it('rejects a missing slug without calling the API', async () => {
    const result = await handleGetPrompt(client(), {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('slug is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a non-404 API failure as a tool error', async () => {
    fetchMock.mockResolvedValueOnce(json(500, { success: false, error: 'boom' }));
    const result = await handleGetPrompt(client(), { slug: 'daily-news' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Error getting prompt');
    expect(requestedPaths()).toEqual(['/api/prompts/daily-news']);
  });

  it('rejects a 200 body without prompt text', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { success: true, prompt: CATALOG[0] }));
    const result = await handleGetPrompt(client(), { slug: 'daily-news' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Malformed response from GET /api/prompts/:slug');
  });
});

describe('SERVER_INSTRUCTIONS', () => {
  it('points topic-shaped requests at the prompts tool before any scripting', () => {
    expect(SERVER_INSTRUCTIONS).toContain('call prompts (action: list) first');
    expect(SERVER_INSTRUCTIONS).toContain('prompts (action: get)');
    expect(SERVER_INSTRUCTIONS).toContain('instead of assembling the script yourself');
  });
});

describe('prompt tools over MCP', () => {
  it('registers one prompts tool with the list and get actions, a query and source for list, and a slug for get', async () => {
    await withMcpClient(async (mcp) => {
      const { tools } = await mcp.listTools();
      const prompts = tools.find((tool) => tool.name === 'prompts');
      expect(Object.keys(prompts?.inputSchema.properties ?? {}).sort()).toEqual(['action', 'query', 'slug', 'source']);
      expect(prompts?.inputSchema.required).toEqual(['action']);
      expect(prompts?.description).toContain('get (slug)');
      expect(tools.some((tool) => tool.name === 'list_prompts' || tool.name === 'get_prompt')).toBe(false);
    });
  });

  it('rejects get without a slug before any request is sent', async () => {
    await withMcpClient(async (mcp) => {
      const result = await mcp.callTool({ name: 'prompts', arguments: { action: 'get' } });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('prompts · get');
      expect(requestedPaths()).toEqual([]);
    });
  });

  it('runs list and get end to end, tagging each API request with the tool and the action', async () => {
    await withMcpClient(async (mcp) => {
      const listed = await mcp.callTool({ name: 'prompts', arguments: { action: 'list' } });
      expect(JSON.parse(textOf(listed))).toEqual(CATALOG);
      const fetched = await mcp.callTool({ name: 'prompts', arguments: { action: 'get', slug: 'full-setup' } });
      expect(textOf(fetched)).toBe(recipeRunText({ slug: 'full-setup', prompt: PROMPT_TEXT['full-setup'] ?? '', source: 'own', visibility: 'public', verified: false, versionId: VERSION_ID }));
      expect(toolHeaders()).toEqual(['prompts', 'prompts']);
      expect(actionHeaders()).toEqual(['list', 'get']);
    });
  });

  it('counts the recipes as listed only when the list carried a prompt', async () => {
    fetchMock.mockImplementation(async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/api/prompts' && parsed.searchParams.get('source') === 'own') {
        return json(200, { success: true, prompts: [] });
      }
      return apiResponse(url);
    });
    const knownHeaders = (): Array<string | undefined> =>
      fetchMock.mock.calls.map(([, init]) => (init.headers as Record<string, string>)[MCP_RECIPES_KNOWN_HEADER]);
    await withMcpClient(async (mcp) => {
      await mcp.callTool({ name: 'prompts', arguments: { action: 'list', source: 'own' } });
      await mcp.callTool({ name: 'prompts', arguments: { action: 'list', source: 'own' } });
      await mcp.callTool({ name: 'prompts', arguments: { action: 'list' } });
      await mcp.callTool({ name: 'prompts', arguments: { action: 'list' } });
    });
    expect(knownHeaders()).toEqual(['false', 'false', 'false', 'true']);
  });

  it('keeps generate_video pointing topic-shaped requests back at the recipes', async () => {
    await withMcpClient(async (mcp) => {
      const { tools } = await mcp.listTools();
      const generate = tools.find((tool) => tool.name === 'generate_video');
      expect(generate?.description).toContain('call prompts (action: list) first');
      expect(generate?.description).toContain('prompts (action: get)');
      expect(generate?.description).toContain('(news, a place, a product, GitHub PRs)');
      expect(generate?.description).toContain("pass that prompt's versionId as promptVersionId on each video");
    });
  });

  it('advertises the server instructions', async () => {
    await withMcpClient(async (mcp) => {
      const result = await mcp.request(
        {
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '0.0.0' },
          },
        },
        InitializeResultSchema,
      );
      expect(result.instructions).toBe(SERVER_INSTRUCTIONS);
    });
  });
});

describe('slash commands over MCP', () => {
  it('lists the API catalog as zero-arg prompts, fetched on demand', async () => {
    await withMcpClient(async (mcp) => {
      expect(fetchMock).not.toHaveBeenCalled();
      const { prompts } = await mcp.listPrompts();
      expect(prompts).toEqual(
        CATALOG.map((entry) => ({ name: entry.slug, title: entry.title, description: entry.description })),
      );
      expect(toolHeaders()).toEqual(['slash_list_prompts']);
    });
  });

  it('returns the prompt text plus the declare-the-recipe footer as one user message', async () => {
    await withMcpClient(async (mcp) => {
      const result = await mcp.getPrompt({ name: 'daily-news' });
      expect(result.messages).toEqual([
        { role: 'user', content: { type: 'text', text: recipeRunText({ slug: 'daily-news', prompt: PROMPT_TEXT['daily-news'] ?? '', source: 'own', visibility: 'public', verified: false, versionId: VERSION_ID }) } },
      ]);
      expect(toolHeaders()).toEqual(['slash_get_prompt']);
    });
  });

  it('answers an unknown slug with an invalid-params error naming the valid slugs', async () => {
    await withMcpClient(async (mcp) => {
      await expect(mcp.getPrompt({ name: 'nope' })).rejects.toThrow('daily-news, full-setup');
    });
  });

  it('surfaces an API failure as an MCP error, never an empty list', async () => {
    fetchMock.mockResolvedValueOnce(json(503, { success: false, error: 'down' }));
    await withMcpClient(async (mcp) => {
      await expect(mcp.listPrompts()).rejects.toThrow('Failed to list prompts');
    });
  });

  it('surfaces a non-404 failure on prompts/get as an MCP error', async () => {
    fetchMock.mockResolvedValueOnce(json(503, { success: false, error: 'down' }));
    await withMcpClient(async (mcp) => {
      await expect(mcp.getPrompt({ name: 'daily-news' })).rejects.toThrow('Failed to get prompt');
    });
  });
});

describe('prompts from users', () => {
  function userPrompt(source: 'own' | 'community', verified = false): Response {
    return json(200, {
      success: true,
      prompt: {
        slug: 'their-prompt',
        title: 'Their prompt',
        description: 'About',
        source,
        visibility: source === 'own' ? 'private' : 'public',
        verified,
        prompt: 'Follow these steps.',
        body: 'Follow these steps.',
        versionId: VERSION_ID,
        version: 2,
      },
    });
  }

  it('puts the unverified-content notice in front of a community prompt and asks for its recipe and version', async () => {
    fetchMock.mockResolvedValueOnce(userPrompt('community'));
    const result = await handleGetPrompt(client(), { slug: 'their-prompt' });
    expect(textOf(result).startsWith(`${COMMUNITY_PROMPT_NOTICE}\n\nFollow these steps.\n\n`)).toBe(true);
    expect(textOf(result)).toContain(`pass recipe: "their-prompt" and promptVersionId: "${VERSION_ID}"`);
  });

  it('serves a verified community prompt without the unverified-content notice', async () => {
    fetchMock.mockResolvedValueOnce(userPrompt('community', true));
    const result = await handleGetPrompt(client(), { slug: 'their-prompt' });
    expect(textOf(result).startsWith('Follow these steps.\n\n')).toBe(true);
    expect(textOf(result)).not.toContain(COMMUNITY_PROMPT_NOTICE);
    expect(textOf(result)).toContain(`pass recipe: "their-prompt" and promptVersionId: "${VERSION_ID}"`);
  });

  it('returns the caller own prompt as stored, followed only by its version footer', async () => {
    fetchMock.mockResolvedValueOnce(userPrompt('own'));
    const result = await handleGetPrompt(client(), { slug: 'their-prompt' });
    expect(textOf(result)).toBe(
      `Follow these steps.\n\nWhen you call generate_video with a script written from this prompt, pass promptVersionId: "${VERSION_ID}" on each video, so experiments (action: results) can compare this prompt.`,
    );
  });

  it('labels a community prompt in the slash prompt list so it is not mistaken for one of the caller own', async () => {
    const community = { slug: 'shared', title: 'Shared', description: 'By someone', source: 'community', visibility: 'public', verified: false };
    fetchMock.mockResolvedValueOnce(json(200, { success: true, prompts: [...CATALOG, community] }));
    const { listSlashPrompts } = await import('../prompts.js');
    const listed = await listSlashPrompts(client());
    expect(listed.prompts.map((prompt) => prompt.title)).toEqual([CATALOG[0]?.title, CATALOG[1]?.title, 'Shared (community)']);
  });

  it('does not label a verified community prompt as community in the slash prompt list', async () => {
    const verified = { slug: 'checked', title: 'Checked', description: 'By Post Engineer', source: 'community', visibility: 'public', verified: true };
    fetchMock.mockResolvedValueOnce(json(200, { success: true, prompts: [verified] }));
    const { listSlashPrompts } = await import('../prompts.js');
    const listed = await listSlashPrompts(client());
    expect(listed.prompts.map((prompt) => prompt.title)).toEqual(['Checked']);
  });

  it('does not record a private prompt as a fetched recipe, so its slug never reaches generate_video telemetry', async () => {
    const server = createPostEngineerMcpServer(client(), 'stdio');
    const [a, b] = InMemoryTransport.createLinkedPair();
    const mcp = new Client({ name: 't', version: '0.0.0' });
    await Promise.all([server.connect(b), mcp.connect(a)]);
    try {
      fetchMock.mockResolvedValueOnce(userPrompt('own'));
      await mcp.callTool({ name: 'prompts', arguments: { action: 'get', slug: 'their-prompt' } });
      fetchMock.mockResolvedValueOnce(json(200, { success: true }));
      await mcp.callTool({ name: 'billing', arguments: { action: 'balance' } });
      const lastHeaders = fetchMock.mock.calls.at(-1)?.[1].headers as Record<string, string>;
      expect(Object.values(lastHeaders)).not.toContain('their-prompt');
    } finally {
      await mcp.close();
    }
  });
});

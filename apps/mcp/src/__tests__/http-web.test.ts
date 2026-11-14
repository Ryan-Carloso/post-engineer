import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createPostEngineerMcpServer } from '../index.js';
import type { PostEngineerClient } from '../client.js';
import { handleMcpWebRequest, MAX_MCP_HTTP_BODY_BYTES } from '../http-web.js';

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  // Passthrough stand-in for the real withTracking, which only opens the
  // per-call context: mcp_tool_called is recorded by the web API from the
  // request headers, not by the MCP (see analytics.test.ts).
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => {
    return handler(args);
  },
}));

const FILE_ONLY_TOOLS = ['upload_media', 'add_persona_image', 'publish_video_direct'];

const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.';
const content =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const ctaTake = 'Save this video before your next trip to Porto.';
function photos(count: number, prefix: string): Array<{ url: string }> {
  return Array.from({ length: count }, (_, i) => ({ url: `https://example.com/${prefix}-${i + 1}.jpg` }));
}

const segments = [
  { kind: 'hook' as const, text: hook, media: photos(3, 'hook') },
  { kind: 'content' as const, text: content, media: photos(6, 'content') },
  { kind: 'content' as const, text: ctaTake, media: photos(2, 'ctaTake') },
];

function mockClient() {
  return {
    validateScript: vi.fn().mockResolvedValue({
      success: true,
      segmentCount: 3,
      totalWords: 75,
      hookWords: 24,
      contentWords: 51,
      hookWindowSeconds: { min: 8, max: 12 },
      measuredDurationSeconds: null,
      measured: 'pending',
      measuredReason: 'No hook-only TTS endpoint exists yet.',
    }),
  } as unknown as PostEngineerClient;
}

async function listedNames(client: PostEngineerClient, transport: 'stdio' | 'http'): Promise<string[]> {
  const server = createPostEngineerMcpServer(client, transport);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const memoryClient = new Client({ name: 'memory-test', version: '1.0.0' });
  await memoryClient.connect(clientTransport);
  try {
    const tools = await memoryClient.listTools();
    return tools.tools.map((tool) => tool.name).sort();
  } finally {
    await memoryClient.close();
  }
}

// The SDK client talks to the handler through a custom fetch: no socket,
// no port — the request is a plain Web Standard Request.
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function testFetch(serverFactory: () => McpServer): FetchLike {
  return (input, init) => handleMcpWebRequest(new Request(input, init), serverFactory);
}

async function connectClient(serverFactory: () => McpServer): Promise<Client> {
  const client = new Client({ name: 'http-web-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('https://mcp.test/mcp'), {
    fetch: testFetch(serverFactory),
  });
  await client.connect(transport);
  return client;
}

describe('handleMcpWebRequest', () => {
  it('caps the request body at 1 MiB, the same cap as the node:http transport', () => {
    expect(MAX_MCP_HTTP_BODY_BYTES).toBe(1024 * 1024);
  });

  it('serves the remote JSON tools over a Web Standard request and answers validate_script without tokens', async () => {
    const client = mockClient();
    const mcpClient = await connectClient(() => createPostEngineerMcpServer(client, 'http'));
    try {
      const httpTools = await mcpClient.listTools();
      const httpNames = httpTools.tools.map((tool) => tool.name).sort();
      const memoryNames = await listedNames(client, 'http');
      const stdioNames = await listedNames(client, 'stdio');

      // The hosted endpoint must serve the same tools as the http factory.
      // That set is the stdio set without the three local-file tools.
      expect(httpNames).toEqual(memoryNames);
      for (const tool of FILE_ONLY_TOOLS) {
        expect(httpNames).not.toContain(tool);
        expect(stdioNames).toContain(tool);
      }
      expect(stdioNames.filter((name) => !FILE_ONLY_TOOLS.includes(name))).toEqual(httpNames);
      expect(httpNames).toContain('list_prompts');
      expect(httpNames).toContain('validate_script');

      const result = await mcpClient.callTool({ name: 'validate_script', arguments: { segments } });
      expect(result.isError).toBeUndefined();
      const content = result.content as Array<{ type?: unknown; text?: unknown }> | undefined;
      const block = content?.[0];
      if (block === undefined || block.type !== 'text' || typeof block.text !== 'string') {
        throw new Error('expected a text content block');
      }
      expect(block.text).toContain('Script valid');
      expect(block.text).toContain('3 segment(s)');
      expect(vi.mocked(client.validateScript)).toHaveBeenCalledTimes(1);
    } finally {
      await mcpClient.close();
    }
  });

  it('builds a fresh server per request: the factory runs once per HTTP request', async () => {
    let builds = 0;
    const factory = (): McpServer => {
      builds += 1;
      return createPostEngineerMcpServer(mockClient(), 'http');
    };
    const mcpClient = await connectClient(factory);
    try {
      // connect() sends initialize + the initialized notification (2
      // builds) and opens the standalone GET stream for server messages
      // (1 build); listTools sends a fourth request (1 more build). A
      // shared or reused server would build once.
      await mcpClient.listTools();
      expect(builds).toBe(4);
    } finally {
      await mcpClient.close();
    }
  });

  it('is stateless: responses carry no Mcp-Session-Id header', async () => {
    const response = await testFetch(() => createPostEngineerMcpServer(mockClient(), 'http'))(
      'https://mcp.test/mcp',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'raw-stateless-probe', version: '1.0.0' },
          },
        }),
      },
    );
    await response.arrayBuffer().catch(() => undefined);
    expect(response.headers.get('mcp-session-id')).toBeNull();
  });

  it('rejects a malformed JSON body with 400 instead of crashing', async () => {
    const response = await handleMcpWebRequest(
      new Request('https://mcp.test/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: '{not json',
      }),
      () => createPostEngineerMcpServer(mockClient(), 'http'),
    );
    await response.arrayBuffer().catch(() => undefined);
    expect(response.status).toBe(400);
  });

  it('rejects an empty POST body with 400', async () => {
    const response = await handleMcpWebRequest(
      new Request('https://mcp.test/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      }),
      () => createPostEngineerMcpServer(mockClient(), 'http'),
    );
    await response.arrayBuffer().catch(() => undefined);
    expect(response.status).toBe(400);
  });

  it('rejects an oversized body with 413 before parsing it', async () => {
    const response = await handleMcpWebRequest(
      new Request('https://mcp.test/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: 'a'.repeat(MAX_MCP_HTTP_BODY_BYTES + 1),
      }),
      () => createPostEngineerMcpServer(mockClient(), 'http'),
    );
    await response.arrayBuffer().catch(() => undefined);
    expect(response.status).toBe(413);
  });

  it('rejects a GET without an event-stream Accept header with 406', async () => {
    const response = await handleMcpWebRequest(
      new Request('https://mcp.test/mcp', { method: 'GET' }),
      () => createPostEngineerMcpServer(mockClient(), 'http'),
    );
    await response.arrayBuffer().catch(() => undefined);
    expect(response.status).toBe(406);
  });
});

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
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withToolCall: (_tool: string, _action: string, run: () => Promise<unknown>) => run(),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => {
    return handler(args);
  },
}));

const FILE_ONLY_ACTIONS: Array<[string, string]> = [['publish_video', 'from_file']];

function mockClient() {
  return {
    listPersonas: vi.fn().mockResolvedValue({ authenticated: true, personas: [] }),
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

  it('serves the remote JSON tools over a Web Standard request and answers a tool call', async () => {
    const client = mockClient();
    const mcpClient = await connectClient(() => createPostEngineerMcpServer(client, 'http'));
    try {
      const httpTools = await mcpClient.listTools();
      const httpNames = httpTools.tools.map((tool) => tool.name).sort();
      const memoryNames = await listedNames(client, 'http');
      const stdioNames = await listedNames(client, 'stdio');

      expect(httpNames).toEqual(memoryNames);
      expect(stdioNames).toEqual(httpNames);
      expect(httpNames).toHaveLength(10);
      expect(httpNames).toContain('prompts');
      expect(httpNames).toContain('publish_video');
      const actionsOf = (name: string): string[] =>
        (httpTools.tools.find((tool) => tool.name === name)?.inputSchema.properties as { action?: { enum?: string[] } } | undefined)?.action?.enum ?? [];
      for (const [tool, action] of FILE_ONLY_ACTIONS) {
        expect(actionsOf(tool)).not.toContain(action);
      }

      const result = await mcpClient.callTool({ name: 'personas', arguments: { action: 'list' } });
      expect(result.isError, JSON.stringify(result.content)).toBeUndefined();
      const content = result.content as Array<{ type?: unknown; text?: unknown }> | undefined;
      const block = content?.[0];
      if (block === undefined || block.type !== 'text' || typeof block.text !== 'string') {
        throw new Error('expected a text content block');
      }
      expect(block.text).toContain('"personas": []');
      expect(vi.mocked(client.listPersonas)).toHaveBeenCalledTimes(1);
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

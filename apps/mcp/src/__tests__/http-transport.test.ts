import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPostEngineerMcpServer } from '../index.js';
import type { PostEngineerClient } from '../client.js';
import {
  parseHttpTransportOptions,
  serveHttpTransport,
  type HttpTransportHandle,
} from '../http-transport.js';

const mockTrackEvent = vi.fn();
vi.mock('../analytics.js', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  // Same shape as the real withTracking: track, then run the handler.
  withTracking: (toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => {
    mockTrackEvent('mcp_tool_called', { toolName });
    return handler(args);
  },
}));

const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.';
const body =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const cta = 'Save this video before your next trip to Porto.';
const segments = [
  { kind: 'hook' as const, text: hook },
  { kind: 'body' as const, text: body },
  { kind: 'cta' as const, text: cta },
];

function mockClient() {
  return {
    validateScript: vi.fn().mockResolvedValue({
      success: true,
      segmentCount: 3,
      totalWords: 75,
      hookWords: 24,
      bodyWords: 42,
      ctaWords: 9,
      hookWindowSeconds: { min: 8, max: 12 },
      measuredDurationSeconds: null,
      measured: 'pending',
      measuredReason: 'No hook-only TTS endpoint exists yet.',
    }),
  } as unknown as PostEngineerClient;
}

const handles: HttpTransportHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) {
    const handle = handles.pop();
    if (handle !== undefined) await handle.close();
  }
});

describe('parseHttpTransportOptions', () => {
  it('returns null for the stdio default (no flag)', () => {
    expect(parseHttpTransportOptions([], {})).toBeNull();
  });

  it('returns null for the legacy --http flag: it never enables a port', () => {
    expect(parseHttpTransportOptions(['--http'], {})).toBeNull();
  });

  it('enables loopback HTTP only with the explicit --http-transport flag', () => {
    const options = parseHttpTransportOptions(['--http-transport', '--http-port', '4123'], {});
    expect(options).toEqual({ host: '127.0.0.1', port: 4123, allowRemote: false });
  });

  it('reads host and port from env when no flag value is given', () => {
    const options = parseHttpTransportOptions(['--http-transport'], {
      MCP_HTTP_HOST: '127.0.0.1',
      MCP_HTTP_PORT: '4124',
    });
    expect(options).toEqual({ host: '127.0.0.1', port: 4124, allowRemote: false });
  });

  it('refuses a non-loopback host without --allow-remote', () => {
    expect(() =>
      parseHttpTransportOptions(['--http-transport', '--http-port', '4123', '--host', '0.0.0.0'], {}),
    ).toThrow(/allow-remote/);
  });

  it('allows a non-loopback host with an explicit --allow-remote flag', () => {
    const options = parseHttpTransportOptions(
      ['--http-transport', '--http-port', '4123', '--host', '0.0.0.0', '--allow-remote'],
      {},
    );
    expect(options).toEqual({ host: '0.0.0.0', port: 4123, allowRemote: true });
  });

  it('rejects a non-numeric port', () => {
    expect(() => parseHttpTransportOptions(['--http-transport', '--http-port', 'abc'], {})).toThrow(/port/);
  });

  it('rejects a missing --http-port value', () => {
    expect(() => parseHttpTransportOptions(['--http-transport', '--http-port'], {})).toThrow(/port/);
  });

  it('rejects a missing --host value', () => {
    expect(() => parseHttpTransportOptions(['--http-transport', '--http-port', '4123', '--host'], {})).toThrow(
      /host/,
    );
  });
});

describe('serveHttpTransport', () => {
  it('serves the same 41 tools over Streamable HTTP and answers validate_script without tokens', async () => {
    const client = mockClient();
    const handle = await serveHttpTransport(() => createPostEngineerMcpServer(client), { host: '127.0.0.1', port: 0, allowRemote: false });
    handles.push(handle);

    const mcpClient = new Client({ name: 'http-transport-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(handle.url));
    await mcpClient.connect(transport);
    try {
      const httpTools = await mcpClient.listTools();
      const httpNames = httpTools.tools.map((tool) => tool.name).sort();

      // Parity proof without duplicating the tool list: the same server
      // factory over an in-memory transport must list exactly the same tools.
      const memoryServer = createPostEngineerMcpServer(client);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await memoryServer.connect(serverTransport);
      const memoryClient = new Client({ name: 'memory-test', version: '1.0.0' });
      await memoryClient.connect(clientTransport);
      const memoryTools = await memoryClient.listTools();
      await memoryClient.close();
      const memoryNames = memoryTools.tools.map((tool) => tool.name).sort();

      expect(httpNames).toEqual(memoryNames);
      expect(httpNames).toHaveLength(41);
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

  it('is stateless: responses carry no Mcp-Session-Id header', async () => {
    const handle = await serveHttpTransport(() => createPostEngineerMcpServer(mockClient()), { host: '127.0.0.1', port: 0, allowRemote: false });
    handles.push(handle);

    const response = await fetch(handle.url, {
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
    });
    await response.arrayBuffer().catch(() => undefined);
    expect(response.headers.get('mcp-session-id')).toBeNull();
  });

  it('answers GET /health without an MCP handshake', async () => {
    const handle = await serveHttpTransport(() => createPostEngineerMcpServer(mockClient()), { host: '127.0.0.1', port: 0, allowRemote: false });
    handles.push(handle);
    const healthUrl = handle.url.replace(/\/mcp$/, '/health');
    const response = await fetch(healthUrl);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('rejects a malformed JSON body with 400 instead of crashing', async () => {
    const handle = await serveHttpTransport(() => createPostEngineerMcpServer(mockClient()), { host: '127.0.0.1', port: 0, allowRemote: false });
    handles.push(handle);
    const response = await fetch(handle.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: '{not json',
    });
    await response.arrayBuffer().catch(() => undefined);
    expect(response.status).toBe(400);
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { request as httpRequest } from 'node:http';
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

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  // Passthrough stand-in for the real withTracking, which only opens the
  // per-call context: mcp_tool_called is recorded by the web API from the
  // request headers, not by the MCP (see analytics.test.ts).
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withToolCall: (_tool: string, _action: string, run: () => Promise<unknown>) => run(),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => {
    return handler(args);
  },
}));

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

  it('rejects an empty port instead of silently binding port 0', () => {
    expect(() => parseHttpTransportOptions(['--http-transport', '--http-port='], {})).toThrow(/port/);
    expect(() => parseHttpTransportOptions(['--http-transport'], { MCP_HTTP_PORT: '' })).toThrow(/port/);
    expect(() => parseHttpTransportOptions(['--http-transport'], { MCP_HTTP_PORT: '   ' })).toThrow(/port/);
  });

  it('rejects a missing --http-port value', () => {
    expect(() => parseHttpTransportOptions(['--http-transport', '--http-port'], {})).toThrow(/port/);
  });

  it('accepts the --http-port=value form', () => {
    const options = parseHttpTransportOptions(['--http-transport', '--http-port=4125'], {});
    expect(options).toEqual({ host: '127.0.0.1', port: 4125, allowRemote: false });
  });

  it('rejects a missing port entirely (no flag, no env)', () => {
    expect(() => parseHttpTransportOptions(['--http-transport'], {})).toThrow(/port/);
  });

  it('allows a non-loopback host via the MCP_HTTP_ALLOW_REMOTE env flag', () => {
    const options = parseHttpTransportOptions(['--http-transport', '--http-port', '4123', '--host', '0.0.0.0'], {
      MCP_HTTP_ALLOW_REMOTE: 'true',
    });
    expect(options).toEqual({ host: '0.0.0.0', port: 4123, allowRemote: true });
  });

  it('rejects a missing --host value', () => {
    expect(() => parseHttpTransportOptions(['--http-transport', '--http-port', '4123', '--host'], {})).toThrow(
      /host/,
    );
  });
});

// Actions that read a file from the disk: offered on the stdio server only.
const FILE_ONLY_ACTIONS: Array<[string, string]> = [['media', 'upload'], ['persona_media', 'add_image'], ['publish_video', 'from_file']];

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

describe('serveHttpTransport', () => {
  it('serves the remote JSON tools over Streamable HTTP and answers validate_script without tokens', async () => {
    const client = mockClient();
    const handle = await serveHttpTransport(() => createPostEngineerMcpServer(client, 'http'), {
      host: '127.0.0.1',
      port: 0,
      allowRemote: false,
    });
    handles.push(handle);

    const mcpClient = new Client({ name: 'http-transport-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(handle.url));
    await mcpClient.connect(transport);
    try {
      const httpTools = await mcpClient.listTools();
      const httpNames = httpTools.tools.map((tool) => tool.name).sort();
      const memoryNames = await listedNames(client, 'http');
      const stdioNames = await listedNames(client, 'stdio');

      // The HTTP listener must serve the same tools as the http factory,
      // and the stdio server has the same 16 tools with extra file actions.
      expect(httpNames).toEqual(memoryNames);
      expect(stdioNames).toEqual(httpNames);
      expect(httpNames).toHaveLength(16);
      expect(httpNames).toContain('prompts');
      expect(httpNames).toContain('check_script');
      const actionsOf = (tools: typeof httpTools.tools, name: string): string[] =>
        (tools.find((tool) => tool.name === name)?.inputSchema.properties as { action?: { enum?: string[] } } | undefined)?.action?.enum ?? [];
      for (const [tool, action] of FILE_ONLY_ACTIONS) {
        expect(actionsOf(httpTools.tools, tool)).not.toContain(action);
      }

      const result = await mcpClient.callTool({ name: 'check_script', arguments: { action: 'validate', segments } });
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

  it('rejects an empty POST body with 400', async () => {
    const handle = await serveHttpTransport(() => createPostEngineerMcpServer(mockClient()), { host: '127.0.0.1', port: 0, allowRemote: false });
    handles.push(handle);
    const response = await fetch(handle.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    });
    await response.arrayBuffer().catch(() => undefined);
    expect(response.status).toBe(400);
  });

  it('rejects an oversized body with 413 before parsing it', async () => {
    const handle = await serveHttpTransport(() => createPostEngineerMcpServer(mockClient()), { host: '127.0.0.1', port: 0, allowRemote: false });
    handles.push(handle);
    const response = await fetch(handle.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: 'a'.repeat(1024 * 1024 + 1),
    });
    await response.arrayBuffer().catch(() => undefined);
    expect(response.status).toBe(413);
  });

  it('answers 404 for unknown paths', async () => {
    const handle = await serveHttpTransport(() => createPostEngineerMcpServer(mockClient()), { host: '127.0.0.1', port: 0, allowRemote: false });
    handles.push(handle);
    const response = await fetch(handle.url.replace(/\/mcp$/, '/nope'));
    await response.arrayBuffer().catch(() => undefined);
    expect(response.status).toBe(404);
  });

  // P6-2 changed this behaviour deliberately: --allow-remote without
  // OAuth configured is a startup error, not a warning — an
  // unauthenticated remote endpoint is no longer possible.
  it('refuses to start with --allow-remote and no OAuth configured', async () => {
    await expect(
      serveHttpTransport(() => createPostEngineerMcpServer(mockClient()), {
        host: '127.0.0.1',
        port: 0,
        allowRemote: true,
      }),
    ).rejects.toThrow(/OAuth authentication/);
  });

  // Raw requests: fetch forbids setting Origin and Host headers, and
  // these tests need exactly those headers to exercise the rebinding guard.
  async function rawStatus(url: string, headers: Record<string, string>): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(url, { method: 'GET', headers }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('rejects a non-loopback Origin with 403 (DNS rebinding guard)', async () => {
    const handle = await serveHttpTransport(() => createPostEngineerMcpServer(mockClient()), { host: '127.0.0.1', port: 0, allowRemote: false });
    handles.push(handle);
    const healthUrl = handle.url.replace(/\/mcp$/, '/health');
    expect(await rawStatus(healthUrl, { origin: 'https://evil.example' })).toBe(403);
  });

  it('rejects an unparseable Origin with 403', async () => {
    const handle = await serveHttpTransport(() => createPostEngineerMcpServer(mockClient()), { host: '127.0.0.1', port: 0, allowRemote: false });
    handles.push(handle);
    const healthUrl = handle.url.replace(/\/mcp$/, '/health');
    expect(await rawStatus(healthUrl, { origin: 'not a url' })).toBe(403);
  });

  it('accepts a loopback Origin', async () => {
    const handle = await serveHttpTransport(() => createPostEngineerMcpServer(mockClient()), { host: '127.0.0.1', port: 0, allowRemote: false });
    handles.push(handle);
    const healthUrl = handle.url.replace(/\/mcp$/, '/health');
    expect(await rawStatus(healthUrl, { origin: 'http://localhost:5173' })).toBe(200);
    // URL keeps brackets on IPv6 literals: the [::1] origin must pass
    // the same loopback check as the bare ::1 host.
    expect(await rawStatus(healthUrl, { origin: 'http://[::1]:5173' })).toBe(200);
  });

  it('rejects a non-loopback Host header with 403 while bound to loopback', async () => {
    const handle = await serveHttpTransport(() => createPostEngineerMcpServer(mockClient()), { host: '127.0.0.1', port: 0, allowRemote: false });
    handles.push(handle);
    const healthUrl = handle.url.replace(/\/mcp$/, '/health');
    expect(await rawStatus(healthUrl, { host: 'evil.example' })).toBe(403);
  });

  it('accepts bracketed and bare IPv6 loopback Host headers', async () => {
    const handle = await serveHttpTransport(() => createPostEngineerMcpServer(mockClient()), { host: '127.0.0.1', port: 0, allowRemote: false });
    handles.push(handle);
    const healthUrl = handle.url.replace(/\/mcp$/, '/health');
    expect(await rawStatus(healthUrl, { host: '[::1]:9999' })).toBe(200);
    expect(await rawStatus(healthUrl, { host: '::1' })).toBe(200);
  });

  // P6-2: a non-loopback bind now requires OAuth configured; the Host
  // check is still skipped for that bind. /health needs no token, so a
  // dummy auth config suffices here — no JWKS fetch happens for it.
  it('skips the Host check when bound non-loopback with auth configured', async () => {
    const handle = await serveHttpTransport(
      () => createPostEngineerMcpServer(mockClient()),
      {
        host: '0.0.0.0',
        port: 0,
        allowRemote: true,
      },
      {
        issuer: 'https://auth.example.test',
        resource: 'https://api.example.test/mcp',
        jwksUrl: 'http://127.0.0.1:1/.well-known/jwks.json',
        rateLimitPerMinute: 120,
      },
    );
    handles.push(handle);
    const healthUrl = handle.url.replace(/\/mcp$/, '/health').replace('0.0.0.0', '127.0.0.1');
    expect(await rawStatus(healthUrl, { host: 'example.internal' })).toBe(200);
  });

  it('answers 500 when the server factory throws instead of crashing the listener', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const handle = await serveHttpTransport(
        () => {
          throw new Error('boom');
        },
        { host: '127.0.0.1', port: 0, allowRemote: false },
      );
      handles.push(handle);
      const response = await fetch(handle.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });
      await response.arrayBuffer().catch(() => undefined);
      expect(response.status).toBe(500);
      expect(errorSpy).toHaveBeenCalledWith('MCP HTTP request failed:', expect.anything());
    } finally {
      errorSpy.mockRestore();
    }
  });
});

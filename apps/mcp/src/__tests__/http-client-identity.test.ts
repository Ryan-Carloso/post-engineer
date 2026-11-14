import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AuthContext } from '../http-auth.js';
import { main } from '../index.js';

// Stryker rewrites index.ts, so a test that greps one physical line for
// `new PostEngineerClient` and `'http'` fails the mutation dry run before
// any mutant is scored. Call the HTTP startup instead and read the headers
// the factory's client actually sends.

const serveHttpTransport = vi.hoisted(() =>
  vi.fn(async (_factory: unknown, _options?: unknown, _auth?: unknown) => ({ close: async () => {} })),
);

vi.mock('../http-transport.js', async () => {
  const actual = await vi.importActual<typeof import('../http-transport.js')>('../http-transport.js');
  return { ...actual, serveHttpTransport };
});

const ENV_KEYS = ['POST_ENGINEER_API_KEY', 'POST_ENGINEER_API_URL', 'MCP_OAUTH_ISSUER', 'MCP_RESOURCE'] as const;

function headerMap(headers: RequestInit['headers']): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries());
}

describe('HTTP startup client identity', () => {
  const savedArgv = process.argv.slice();
  const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));

  afterEach(() => {
    process.argv = savedArgv.slice();
    for (const key of ENV_KEYS) {
      const value = savedEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    serveHttpTransport.mockClear();
    vi.unstubAllGlobals();
  });

  it('omits the version header and forwards the bearer, else the process key', async () => {
    delete process.env.MCP_OAUTH_ISSUER;
    delete process.env.MCP_RESOURCE;
    process.env.POST_ENGINEER_API_KEY = 'pe_process';
    process.env.POST_ENGINEER_API_URL = 'https://api.example.test';
    process.argv = ['node', 'post-engineer-mcp', '--http-transport', '--http-port', '0'];

    await main();

    const factory = serveHttpTransport.mock.calls[0]?.[0] as ((auth?: AuthContext) => McpServer) | undefined;
    expect(factory).toEqual(expect.any(Function));
    if (factory === undefined) return;

    const bearerHeaders = await headersFrom(factory({ sub: 'user-1', clientId: 'client-1', bearer: 'pe_user' }));
    expect(bearerHeaders.authorization).toBe('Bearer pe_user');
    expect(bearerHeaders['x-mcp-version']).toBeUndefined();

    const fallbackHeaders = await headersFrom(factory(undefined));
    expect(fallbackHeaders.authorization).toBe('Bearer pe_process');
    expect(fallbackHeaders['x-mcp-version']).toBeUndefined();
  });
});

async function headersFrom(server: McpServer): Promise<Record<string, string>> {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ personas: [] }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name: 'personas', arguments: { action: 'list' } });
    expect(result.isError).toBeFalsy();
  } finally {
    await client.close();
  }
  return headerMap(fetchMock.mock.calls[0]?.[1]?.headers);
}

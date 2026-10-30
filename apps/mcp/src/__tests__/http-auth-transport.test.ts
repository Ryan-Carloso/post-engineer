import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createPostEngineerMcpServer } from '../index.js';
import type { PostEngineerClient } from '../client.js';
import {
  parseHttpAuthOptions,
  type HttpAuthConfig,
  type AuthContext,
} from '../http-auth.js';
import {
  serveHttpTransport,
  type HttpTransportHandle,
} from '../http-transport.js';

const mockTrackEvent = vi.fn();
vi.mock('../analytics.js', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent('mcp_tool_called', args),
  withTracking: (toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => {
    mockTrackEvent('mcp_tool_called', { toolName });
    return handler(args);
  },
}));

const ISSUER = 'https://auth.example.test';
const RESOURCE = 'https://api.example.test/mcp';

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

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let publicJwk: Record<string, unknown>;
let jwksServer: Server;
let jwksUrl: string;

async function mint(overrides: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({ token_use: 'access', scope: 'mcp:tools offline_access', client_id: 'c1', ...overrides })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
    .setIssuer(ISSUER)
    .setSubject('user-123')
    .setAudience(RESOURCE)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600);
  return jwt.sign(privateKey);
}

async function startJwks(): Promise<void> {
  const keypair = await generateKeyPair('ES256');
  privateKey = keypair.privateKey;
  publicJwk = await exportJWK(keypair.publicKey);
  publicJwk.kid = 'test-key-1';
  publicJwk.alg = 'ES256';
  jwksServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise<void>((resolve) => {
    jwksServer.listen(0, '127.0.0.1', () => resolve());
  });
  const address = jwksServer.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  jwksUrl = `http://127.0.0.1:${port}/.well-known/jwks.json`;
}

function authConfig(extra: Record<string, string> = {}): HttpAuthConfig {
  const parsed = parseHttpAuthOptions({
    MCP_OAUTH_ISSUER: ISSUER,
    MCP_RESOURCE: RESOURCE,
    MCP_OAUTH_JWKS_URL: jwksUrl,
    ...extra,
  });
  if (parsed === null) throw new Error('Test auth config did not parse.');
  return parsed;
}

const handles: HttpTransportHandle[] = [];
beforeAll(async () => {
  await startJwks();
});
afterAll(async () => {
  await new Promise<void>((resolve) => {
    jwksServer.close(() => resolve());
  });
});
afterEach(async () => {
  while (handles.length > 0) {
    const handle = handles.pop();
    if (handle !== undefined) await handle.close();
  }
});

describe('HTTP transport with OAuth authentication (P6-2)', () => {
  it('refuses to start a remote listener without OAuth configured', async () => {
    await expect(
      serveHttpTransport(() => createPostEngineerMcpServer(mockClient()), {
        host: '0.0.0.0',
        port: 0,
        allowRemote: true,
      }),
    ).rejects.toThrow(/OAuth authentication/);
  });

  it('refuses --allow-remote on loopback without OAuth configured', async () => {
    await expect(
      serveHttpTransport(() => createPostEngineerMcpServer(mockClient()), {
        host: '127.0.0.1',
        port: 0,
        allowRemote: true,
      }),
    ).rejects.toThrow(/OAuth authentication/);
  });

  it('answers 401 with WWW-Authenticate when no token is presented', async () => {
    
    const handle = await serveHttpTransport(
      () => createPostEngineerMcpServer(mockClient()),
      { host: '127.0.0.1', port: 0, allowRemote: false },
      authConfig(),
    );
    handles.push(handle);
    const response = await fetch(`${handle.url}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(response.status).toBe(401);
    const wwwAuthenticate = response.headers.get('www-authenticate') ?? '';
    expect(wwwAuthenticate).toContain('Bearer');
    expect(wwwAuthenticate).toContain(RESOURCE);
    expect(wwwAuthenticate).toContain('resource_metadata="https://api.example.test/.well-known/oauth-protected-resource"');
    expect(wwwAuthenticate).not.toContain('error="invalid_token"');
    expect(await response.text()).not.toContain('validate_script');
  });

  it('answers 401 for a token without the mcp:tools scope', async () => {
    
    const token = await mint({ scope: 'offline_access' });
    const handle = await serveHttpTransport(
      () => createPostEngineerMcpServer(mockClient()),
      { host: '127.0.0.1', port: 0, allowRemote: false },
      authConfig(),
    );
    handles.push(handle);
    const response = await fetch(`${handle.url}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate') ?? '').toContain('error="invalid_token"');
  });

  it('serves tools to a valid token and hands the factory the verified subject and bearer', async () => {
    
    const token = await mint();
    let seen: AuthContext | undefined;
    const handle = await serveHttpTransport(
      (auth) => {
        seen = auth;
        return createPostEngineerMcpServer(mockClient());
      },
      { host: '127.0.0.1', port: 0, allowRemote: false },
      authConfig(),
    );
    handles.push(handle);
    const client = new Client({ name: 'auth-test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(handle.url), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    const result = await client.callTool({
      name: 'validate_script',
      arguments: { segments },
    });
    expect(seen?.sub).toBe('user-123');
    expect(seen?.bearer).toBe(token);
    expect(result.isError).not.toBe(true);
    await client.close();
  });

  it('enforces the per-subject rate limit with 429 and Retry-After', async () => {
    
    const token = await mint();
    const handle = await serveHttpTransport(
      () => createPostEngineerMcpServer(mockClient()),
      { host: '127.0.0.1', port: 0, allowRemote: false },
      authConfig({ MCP_HTTP_RATE_LIMIT_PER_MINUTE: '2' }),
    );
    handles.push(handle);
    const post = () =>
      fetch(`${handle.url}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } },
        }),
      });
    const first = await post();
    const second = await post();
    const third = await post();
    expect(first.status).not.toBe(429);
    expect(second.status).not.toBe(429);
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toBeTruthy();
  });

  it('serves the OAuth protected-resource document when auth is configured', async () => {
    
    const handle = await serveHttpTransport(
      () => createPostEngineerMcpServer(mockClient()),
      { host: '127.0.0.1', port: 0, allowRemote: false },
      authConfig(),
    );
    handles.push(handle);
    const base = handle.url.replace(/\/mcp$/, '');
    const response = await fetch(`${base}/.well-known/oauth-protected-resource`);
    expect(response.status).toBe(200);
    const doc = (await response.json()) as Record<string, unknown>;
    expect(doc.resource).toBe(RESOURCE);
    expect(doc.authorization_servers).toEqual([ISSUER]);
    expect(doc.scopes_supported).toEqual(['mcp:tools', 'offline_access']);
  });

  it('starts a remote listener with auth configured and still refuses unauthenticated requests', async () => {
    
    const handle = await serveHttpTransport(
      () => createPostEngineerMcpServer(mockClient()),
      { host: '0.0.0.0', port: 0, allowRemote: true },
      authConfig(),
    );
    handles.push(handle);
    // The listener is bound to 0.0.0.0 (proven by serveHttpTransport
    // resolving), but fetch to a 0.0.0.0 URL fails in sandboxed
    // environments with a proxy configured — reach the same listener
    // via loopback instead; the auth check under test is identical.
    const loopbackUrl = handle.url.replace('0.0.0.0', '127.0.0.1');
    const response = await fetch(loopbackUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(response.status).toBe(401);
  });
});

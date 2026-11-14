// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { generateKeyPair, exportPKCS8, SignJWT } from 'jose';
import { POST, GET, DELETE } from '../route';
import { clearOAuthKeysCache, getOAuthKeys } from '@/lib/oauth/keys';
import { getMcpResource, getIssuer } from '@/lib/oauth/config';
import { mintAccessToken } from '@/lib/oauth/tokens';
import { RATE_LIMITS } from '@/lib/rate-limit';

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const APP_URL = 'https://post-engineer.test';
const ENV_KEYS = ['MCP_OAUTH_PRIVATE_KEY_PEM', 'NEXT_PUBLIC_APP_URL'] as const;
const previousEnv: Record<string, string | undefined> = {};

let ipCounter = 0;
function uniqueIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

let subCounter = 0;
function uniqueSub(): string {
  subCounter += 1;
  return `user-mcp-${subCounter}`;
}

beforeAll(async () => {
  for (const key of ENV_KEYS) previousEnv[key] = process.env[key];
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  process.env.MCP_OAUTH_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
  process.env.NEXT_PUBLIC_APP_URL = APP_URL;
  clearOAuthKeysCache();
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
  clearOAuthKeysCache();
});

async function mintToken(input: { sub: string; scope: string; resource: string }): Promise<string> {
  const keys = await getOAuthKeys();
  return mintAccessToken(keys, { ...input, clientId: 'chatgpt-test-client' });
}

// A token signed by a key the server does not trust: the signature fails
// offline verification even though the claims look right.
async function mintForeignToken(input: { sub: string; scope: string; resource: string }): Promise<string> {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  return new SignJWT({ token_use: 'access', scope: input.scope, client_id: 'chatgpt-test-client' })
    .setProtectedHeader({ alg: 'ES256', kid: 'foreign', typ: 'JWT' })
    .setIssuer(getIssuer())
    .setSubject(input.sub)
    .setAudience(input.resource)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

function postRequest(body: unknown, headers?: Record<string, string>): Request {
  return new Request('https://post-engineer.test/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function initializeBody(id: number): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'route-test', version: '1.0.0' },
    },
  };
}

function toolsListBody(id: number): Record<string, unknown> {
  return { jsonrpc: '2.0', id, method: 'tools/list', params: {} };
}

// A POST answer in SSE mode carries one data event with the JSON-RPC
// response. Parse the last data line; the event line carries no payload.
async function readSseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const dataLines = text.split('\n').filter((line) => line.startsWith('data: '));
  if (dataLines.length === 0) throw new Error(`expected SSE data in response body: ${text}`);
  const last = dataLines[dataLines.length - 1];
  if (last === undefined) throw new Error('expected SSE data in response body');
  return JSON.parse(last.slice('data: '.length)) as Record<string, unknown>;
}

function toolNames(result: Record<string, unknown>): string[] {
  const tools = (result as { tools?: Array<{ name?: unknown }> }).tools ?? [];
  return tools.map((tool) => String(tool.name)).sort();
}

describe('POST /mcp', () => {
  it('rejects a request with no token with 401 and a discoverable challenge', async () => {
    const response = await POST(postRequest(initializeBody(1), { 'x-forwarded-for': uniqueIp() }));
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Authentication required.');
    const challenge = response.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain('Bearer realm="post-engineer-mcp"');
    expect(challenge).toContain(`resource="${getMcpResource()}"`);
    expect(challenge).toContain(
      `resource_metadata="${new URL(getMcpResource()).origin}/.well-known/oauth-protected-resource"`,
    );
    expect(challenge).toContain('error_description="A valid OAuth access token is required."');
    // RFC 6750: no error code when no credentials were presented at all.
    expect(challenge).not.toContain('error="invalid_token"');
  });

  it('rejects a non-JWT bearer with 401 and error=invalid_token', async () => {
    const response = await POST(
      postRequest(initializeBody(1), {
        'x-forwarded-for': uniqueIp(),
        authorization: 'Bearer not-a-jwt',
      }),
    );
    await response.arrayBuffer().catch(() => undefined);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it('rejects a token signed by an untrusted key with 401', async () => {
    const token = await mintForeignToken({ sub: uniqueSub(), scope: 'mcp:tools', resource: getMcpResource() });
    const response = await POST(
      postRequest(initializeBody(1), {
        'x-forwarded-for': uniqueIp(),
        authorization: `Bearer ${token}`,
      }),
    );
    await response.arrayBuffer().catch(() => undefined);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it('rejects a token without the mcp:tools scope with 401', async () => {
    const token = await mintToken({ sub: uniqueSub(), scope: 'offline_access', resource: getMcpResource() });
    const response = await POST(
      postRequest(initializeBody(1), {
        'x-forwarded-for': uniqueIp(),
        authorization: `Bearer ${token}`,
      }),
    );
    await response.arrayBuffer().catch(() => undefined);
    expect(response.status).toBe(401);
  });

  it('rejects a token minted for another resource with 401', async () => {
    const token = await mintToken({ sub: uniqueSub(), scope: 'mcp:tools', resource: 'https://other.test' });
    const response = await POST(
      postRequest(initializeBody(1), {
        'x-forwarded-for': uniqueIp(),
        authorization: `Bearer ${token}`,
      }),
    );
    await response.arrayBuffer().catch(() => undefined);
    expect(response.status).toBe(401);
  });

  it('rejects a cross-origin browser request with 403 before auth runs', async () => {
    const response = await POST(
      postRequest(initializeBody(1), {
        'x-forwarded-for': uniqueIp(),
        origin: 'https://evil.test',
      }),
    );
    await response.arrayBuffer().catch(() => undefined);
    expect(response.status).toBe(403);
  });

  it('accepts a same-origin browser request (the guard only rejects foreign origins)', async () => {
    const response = await POST(
      postRequest(initializeBody(1), {
        'x-forwarded-for': uniqueIp(),
        origin: APP_URL,
      }),
    );
    await response.arrayBuffer().catch(() => undefined);
    // Same origin passes the guard, then auth rejects the missing token.
    expect(response.status).toBe(401);
  });

  it('serves the remote JSON tools to an authenticated caller', async () => {
    const ip = uniqueIp();
    const token = await mintToken({ sub: uniqueSub(), scope: 'mcp:tools', resource: getMcpResource() });
    const auth = { authorization: `Bearer ${token}`, 'x-forwarded-for': ip };

    const init = await POST(postRequest(initializeBody(1), auth));
    expect(init.status).toBe(200);
    const initResult = (await readSseJson(init)) as { result?: { serverInfo?: { name?: unknown } } };
    expect(initResult.result?.serverInfo?.name).toBe('post-engineer-mcp');

    const list = await POST(
      postRequest(toolsListBody(2), { ...auth, 'mcp-protocol-version': '2025-06-18' }),
    );
    expect(list.status).toBe(200);
    const listResult = (await readSseJson(list)) as { result?: Record<string, unknown> };
    const names = toolNames(listResult.result ?? {});
    expect(names).toContain('list_personas');
    expect(names).toContain('validate_script');
    expect(names).toContain('publish_uploaded_video');
    // #451: the hosted server must never read a path on its host.
    expect(names).not.toContain('upload_media');
    expect(names).not.toContain('add_persona_image');
    expect(names).not.toContain('publish_video_direct');
  });

  it('rate-limits one subject at 120 requests per minute', async () => {
    const sub = uniqueSub();
    const token = await mintToken({ sub, scope: 'mcp:tools', resource: getMcpResource() });
    const headers = { authorization: `Bearer ${token}`, 'x-forwarded-for': uniqueIp() };
    let lastStatus = 0;
    let lastResponse: Response | null = null;
    for (let i = 0; i < RATE_LIMITS.mcpRemote.limit + 1; i += 1) {
      const response = await POST(postRequest(initializeBody(i), headers));
      await response.arrayBuffer().catch(() => undefined);
      lastStatus = response.status;
      lastResponse = response;
    }
    expect(lastStatus).toBe(429);
    expect(lastResponse?.headers.get('retry-after')).not.toBeNull();
  });

  it('rate-limits one IP before auth at 300 requests per minute', async () => {
    const ip = uniqueIp();
    const headers = { 'x-forwarded-for': ip };
    let lastStatus = 0;
    for (let i = 0; i < RATE_LIMITS.mcpRemotePreAuth.limit + 1; i += 1) {
      const response = await POST(postRequest(initializeBody(i), headers));
      await response.arrayBuffer().catch(() => undefined);
      lastStatus = response.status;
    }
    // The first 300 unauthenticated requests answer 401; the 301st is 429.
    expect(lastStatus).toBe(429);
  });

  it('rejects an unparseable Origin with 403 (DNS-rebinding guard)', async () => {
    const response = await POST(
      postRequest(initializeBody(1), { origin: '::::', 'x-forwarded-for': uniqueIp() }),
    );
    await response.arrayBuffer().catch(() => undefined);
    expect(response.status).toBe(403);
  });

  it('rejects a non-Bearer authorization header with 401 and no invalid_token code', async () => {
    const response = await POST(
      postRequest(initializeBody(1), {
        authorization: 'Basic dXNlcjpwYXNz',
        'x-forwarded-for': uniqueIp(),
      }),
    );
    await response.arrayBuffer().catch(() => undefined);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).not.toContain('error="invalid_token"');
  });

  it('omits resource_metadata from the challenge when the resource is not a URL', async () => {
    const saved = process.env.MCP_RESOURCE;
    vi.stubEnv('MCP_RESOURCE', 'opaque-resource-id');
    try {
      const response = await POST(postRequest(initializeBody(1), { 'x-forwarded-for': uniqueIp() }));
      await response.arrayBuffer().catch(() => undefined);
      expect(response.status).toBe(401);
      const challenge = response.headers.get('www-authenticate') ?? '';
      expect(challenge).toContain('resource="opaque-resource-id"');
      expect(challenge).not.toContain('resource_metadata');
    } finally {
      vi.unstubAllEnvs();
      if (saved !== undefined) process.env.MCP_RESOURCE = saved;
    }
  });

  it('returns 500 when OAuth is not configured', async () => {
    const saved = process.env.MCP_OAUTH_PRIVATE_KEY_PEM;
    vi.stubEnv('MCP_OAUTH_PRIVATE_KEY_PEM', undefined);
    clearOAuthKeysCache();
    try {
      const response = await POST(postRequest(initializeBody(1), { 'x-forwarded-for': uniqueIp() }));
      expect(response.status).toBe(500);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe('MCP is not configured.');
    } finally {
      vi.unstubAllEnvs();
      if (saved !== undefined) process.env.MCP_OAUTH_PRIVATE_KEY_PEM = saved;
      clearOAuthKeysCache();
    }
  });
});

describe('GET /mcp', () => {
  it('delegates to the transport: a GET without an event-stream Accept header answers 406', async () => {
    const token = await mintToken({ sub: uniqueSub(), scope: 'mcp:tools', resource: getMcpResource() });
    const response = await GET(
      new Request('https://post-engineer.test/mcp', {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': uniqueIp() },
      }),
    );
    await response.arrayBuffer().catch(() => undefined);
    expect(response.status).toBe(406);
  });

  it('rejects an unauthenticated GET with 401', async () => {
    const response = await GET(
      new Request('https://post-engineer.test/mcp', {
        method: 'GET',
        headers: { 'x-forwarded-for': uniqueIp() },
      }),
    );
    await response.arrayBuffer().catch(() => undefined);
    expect(response.status).toBe(401);
  });
});

describe('DELETE /mcp', () => {
  it('delegates to the transport: a DELETE with no session answers 200 (idempotent termination)', async () => {
    const token = await mintToken({ sub: uniqueSub(), scope: 'mcp:tools', resource: getMcpResource() });
    const response = await DELETE(
      new Request('https://post-engineer.test/mcp', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': uniqueIp() },
      }),
    );
    await response.arrayBuffer().catch(() => undefined);
    expect(response.status).toBe(200);
  });
});

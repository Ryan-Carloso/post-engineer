import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
import {
  parseHttpAuthOptions,
  createHttpAuthenticator,
  authenticateHttpRequest,
  bearerTokenPresented,
  protectedResourceDocument,
  protectedResourceMetadataUrl,
  unauthorizedHttpResponse,
  type HttpAuthConfig,
} from '../http-auth.js';

// The authorization server in these tests is a loopback JWKS endpoint:
// a real ES256 keypair mints the tokens and the verifier fetches the
// public JWK over HTTP, exactly like production fetches the published
// JWKS. No token is ever a fixture string: every token below is minted
// in-test, so a verification bug cannot hide behind a stale fixture.
const ISSUER = 'https://auth.example.test';
const RESOURCE = 'https://api.example.test/mcp';

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let publicJwk: Record<string, unknown>;
let jwksServer: Server;
let jwksUrl: string;

async function mint(overrides: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    token_use: 'access',
    scope: 'mcp:tools offline_access',
    client_id: 'mcp_client_test',
    ...overrides,
  };
  const jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
    .setIssuer(ISSUER)
    .setSubject('user-123')
    .setAudience(RESOURCE)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600);
  return jwt.sign(privateKey);
}

function authConfig(): HttpAuthConfig {
  return {
    issuer: ISSUER,
    resource: RESOURCE,
    jwksUrl,
    rateLimitPerMinute: 120,
  };
}

beforeAll(async () => {
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
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    jwksServer.close(() => resolve());
  });
});

describe('parseHttpAuthOptions', () => {
  it('returns null when the OAuth env vars are absent (loopback mode stays unauthenticated)', () => {
    expect(parseHttpAuthOptions({})).toBeNull();
  });

  it('returns null when only one of issuer/resource is set', () => {
    expect(parseHttpAuthOptions({ MCP_OAUTH_ISSUER: ISSUER })).toBeNull();
    expect(parseHttpAuthOptions({ MCP_RESOURCE: RESOURCE })).toBeNull();
  });

  it('builds the JWKS URL from the issuer and defaults the rate limit to 120/min', () => {
    expect(
      parseHttpAuthOptions({ MCP_OAUTH_ISSUER: ISSUER, MCP_RESOURCE: RESOURCE }),
    ).toEqual({
      issuer: ISSUER,
      resource: RESOURCE,
      jwksUrl: `${ISSUER}/.well-known/jwks.json`,
      rateLimitPerMinute: 120,
    });
  });

  it('strips trailing slashes like the web, so a slashed env still matches minted tokens', () => {
    expect(
      parseHttpAuthOptions({ MCP_OAUTH_ISSUER: `${ISSUER}/`, MCP_RESOURCE: `${RESOURCE}///` }),
    ).toEqual({
      issuer: ISSUER,
      resource: RESOURCE,
      jwksUrl: `${ISSUER}/.well-known/jwks.json`,
      rateLimitPerMinute: 120,
    });
    expect(parseHttpAuthOptions({ MCP_OAUTH_ISSUER: '///', MCP_RESOURCE: RESOURCE })).toBeNull();
  });

  it('honours an explicit JWKS URL and rate limit override', () => {
    expect(
      parseHttpAuthOptions({
        MCP_OAUTH_ISSUER: ISSUER,
        MCP_RESOURCE: RESOURCE,
        MCP_OAUTH_JWKS_URL: 'https://keys.example.test/jwks',
        MCP_HTTP_RATE_LIMIT_PER_MINUTE: '30',
      }),
    ).toEqual({
      issuer: ISSUER,
      resource: RESOURCE,
      jwksUrl: 'https://keys.example.test/jwks',
      rateLimitPerMinute: 30,
    });
  });

  it('fails fast on a non-integer rate limit', () => {
    expect(() =>
      parseHttpAuthOptions({
        MCP_OAUTH_ISSUER: ISSUER,
        MCP_RESOURCE: RESOURCE,
        MCP_HTTP_RATE_LIMIT_PER_MINUTE: 'lots',
      }),
    ).toThrow(/rate limit/);
  });
});

describe('createHttpAuthenticator', () => {
  it('accepts a valid access token and returns its sub, client, and bearer', async () => {
    const authenticator = createHttpAuthenticator(authConfig());
    const token = await mint();
    const context = await authenticator.verify(token);
    expect(context.sub).toBe('user-123');
    expect(context.clientId).toBe('mcp_client_test');
    expect(context.bearer).toBe(token);
  });

  it('rejects a token for a different audience', async () => {
    const authenticator = createHttpAuthenticator(authConfig());
    const jwt = new SignJWT({ token_use: 'access', scope: 'mcp:tools', client_id: 'c1' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
      .setIssuer(ISSUER)
      .setSubject('user-123')
      .setAudience('https://other.example.test/mcp')
      .setIssuedAt()
      .setExpirationTime('1h');
    await expect(authenticator.verify(await jwt.sign(privateKey))).rejects.toThrow();
  });

  it('rejects a token from a different issuer', async () => {
    const authenticator = createHttpAuthenticator(authConfig());
    const jwt = new SignJWT({ token_use: 'access', scope: 'mcp:tools', client_id: 'c1' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
      .setIssuer('https://evil.example.test')
      .setSubject('user-123')
      .setAudience(RESOURCE)
      .setIssuedAt()
      .setExpirationTime('1h');
    await expect(authenticator.verify(await jwt.sign(privateKey))).rejects.toThrow();
  });

  it('rejects an authorization code presented as an access token', async () => {
    const authenticator = createHttpAuthenticator(authConfig());
    await expect(authenticator.verify(await mint({ token_use: 'auth_code' }))).rejects.toThrow();
  });

  it('rejects a token without the mcp:tools scope', async () => {
    const authenticator = createHttpAuthenticator(authConfig());
    await expect(
      authenticator.verify(await mint({ scope: 'offline_access' })),
    ).rejects.toThrow(/mcp:tools/);
  });

  it('rejects an expired token', async () => {
    const authenticator = createHttpAuthenticator(authConfig());
    const now = Math.floor(Date.now() / 1000);
    const jwt = new SignJWT({ token_use: 'access', scope: 'mcp:tools', client_id: 'c1' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
      .setIssuer(ISSUER)
      .setSubject('user-123')
      .setAudience(RESOURCE)
      .setIssuedAt(now - 7200)
      .setExpirationTime(now - 3600);
    await expect(authenticator.verify(await jwt.sign(privateKey))).rejects.toThrow();
  });

  it('rejects a token whose payload was tampered with after signing', async () => {
    const authenticator = createHttpAuthenticator(authConfig());
    const token = await mint();
    const parts = token.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sub: 'user-999', token_use: 'access', scope: 'mcp:tools' }),
    ).toString('base64url');
    await expect(
      authenticator.verify(`${parts[0]}.${tamperedPayload}.${parts[2]}`),
    ).rejects.toThrow();
  });

  it('rejects a token signed with an unknown kid', async () => {
    const authenticator = createHttpAuthenticator(authConfig());
    const jwt = new SignJWT({ token_use: 'access', scope: 'mcp:tools', client_id: 'c1' })
      .setProtectedHeader({ alg: 'ES256', kid: 'unknown-key' })
      .setIssuer(ISSUER)
      .setSubject('user-123')
      .setAudience(RESOURCE)
      .setIssuedAt()
      .setExpirationTime('1h');
    await expect(authenticator.verify(await jwt.sign(privateKey))).rejects.toThrow();
  });
});

describe('authenticateHttpRequest', () => {
  it('returns null without an Authorization header', async () => {
    const authenticator = createHttpAuthenticator(authConfig());
    expect(
      await authenticateHttpRequest({ headers: {} } as never, authenticator),
    ).toBeNull();
  });

  it('returns null for a non-JWT Bearer value such as an API key', async () => {
    const authenticator = createHttpAuthenticator(authConfig());
    expect(
      await authenticateHttpRequest(
        { headers: { authorization: 'Bearer pe_live_abcdef' } } as never,
        authenticator,
      ),
    ).toBeNull();
  });

  it('returns the claims for a valid Bearer token', async () => {
    const authenticator = createHttpAuthenticator(authConfig());
    const token = await mint();
    const context = await authenticateHttpRequest(
      { headers: { authorization: `Bearer ${token}` } } as never,
      authenticator,
    );
    expect(context?.sub).toBe('user-123');
    expect(context?.bearer).toBe(token);
  });

  it('returns null for an invalid Bearer token, never throwing to the caller', async () => {
    const authenticator = createHttpAuthenticator(authConfig());
    expect(
      await authenticateHttpRequest(
        { headers: { authorization: 'Bearer invalid.invalid.invalid' } } as never,
        authenticator,
      ),
    ).toBeNull();
  });
});

describe('protectedResourceDocument', () => {
  it('advertises the resource, the authorization server, and the supported scopes', () => {
    expect(protectedResourceDocument(authConfig())).toEqual({
      resource: RESOURCE,
      authorization_servers: [ISSUER],
      scopes_supported: ['mcp:tools', 'offline_access'],
    });
  });
});

describe('bearerTokenPresented', () => {
  it('is true only for a non-empty Bearer value', () => {
    expect(bearerTokenPresented({ headers: {} } as never)).toBe(false);
    expect(bearerTokenPresented({ headers: { authorization: 'Basic xyz' } } as never)).toBe(false);
    expect(bearerTokenPresented({ headers: { authorization: 'Bearer ' } } as never)).toBe(false);
    expect(bearerTokenPresented({ headers: { authorization: 'Bearer abc.def.ghi' } } as never)).toBe(true);
    expect(bearerTokenPresented({ headers: { authorization: 'bearer abc.def.ghi' } } as never)).toBe(true);
  });
});

describe('protectedResourceMetadataUrl', () => {
  it('derives the well-known URL from a URL resource and null otherwise', () => {
    expect(protectedResourceMetadataUrl('https://api.example.test/mcp')).toBe(
      'https://api.example.test/.well-known/oauth-protected-resource',
    );
    expect(protectedResourceMetadataUrl('opaque-resource-id')).toBeNull();
  });
});

describe('unauthorizedHttpResponse', () => {
  function capture(config: HttpAuthConfig, tokenPresented: boolean) {
    const res = { writeHead: vi.fn(), end: vi.fn() };
    unauthorizedHttpResponse(res as never, config, tokenPresented);
    return { status: res.writeHead.mock.calls[0]?.[0], headers: res.writeHead.mock.calls[0]?.[1] };
  }

  it('omits error= when no token was presented but keeps resource_metadata', () => {
    const { status, headers } = capture(authConfig(), false);
    expect(status).toBe(401);
    const challenge = (headers as Record<string, string>)['www-authenticate'] ?? '';
    expect(challenge).toContain('resource="https://api.example.test/mcp"');
    expect(challenge).toContain('resource_metadata="https://api.example.test/.well-known/oauth-protected-resource"');
    expect(challenge).not.toContain('error="invalid_token"');
  });

  it('includes error=invalid_token when a token was presented and rejected', () => {
    const { headers } = capture(authConfig(), true);
    expect((headers as Record<string, string>)['www-authenticate']).toContain('error="invalid_token"');
  });

  it('omits resource_metadata for an opaque resource identifier', () => {
    const { headers } = capture({ ...authConfig(), resource: 'opaque-resource-id' }, false);
    expect((headers as Record<string, string>)['www-authenticate']).not.toContain('resource_metadata');
  });
});

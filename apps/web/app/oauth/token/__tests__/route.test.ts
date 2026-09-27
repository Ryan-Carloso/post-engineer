import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from 'vitest';
import { generateKeyPair, exportPKCS8 } from 'jose';
import { POST } from '../route';
import { clearOAuthKeysCache } from '@/lib/oauth/keys';
import { getOAuthKeys } from '@/lib/oauth/keys';
import { mintAuthorizationCode, mintRefreshToken } from '@/lib/oauth/tokens';
import { getMcpResource } from '@/lib/oauth/config';

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

import { createSupabaseServiceClient } from '@/lib/supabase/service';

//---------------
// In-memory stand-in for the 0026 migration RPCs, mirroring their SQL
// semantics: single-use jtis, unknown/expired/consumed → rotation fails.
//---------------
interface RefreshRecord {
  jti: string;
  consumedAt: number | null;
  expiresAt: number;
}

const refreshStore = new Map<string, RefreshRecord>();

function installServiceClientMock(): void {
  vi.mocked(createSupabaseServiceClient).mockReturnValue({
    rpc: vi.fn(async (fn: string, args: Record<string, string>) => {
      if (fn === 'register_mcp_refresh_token') {
        if (!refreshStore.has(args.p_jti)) {
          refreshStore.set(args.p_jti, {
            jti: args.p_jti,
            consumedAt: null,
            expiresAt: Date.parse(args.p_expires_at),
          });
        }
        return { data: null, error: null };
      }
      if (fn === 'rotate_mcp_refresh_token') {
        const record = refreshStore.get(args.p_old_jti);
        const usable =
          record !== undefined && record.consumedAt === null && record.expiresAt > Date.now();
        if (!usable) return { data: false, error: null };
        record.consumedAt = Date.now();
        if (!refreshStore.has(args.p_new_jti)) {
          refreshStore.set(args.p_new_jti, {
            jti: args.p_new_jti,
            consumedAt: null,
            expiresAt: Date.parse(args.p_expires_at),
          });
        }
        return { data: true, error: null };
      }
      return { data: null, error: { message: `unknown rpc ${fn}` } };
    }),
  } as never);
}

const ENV_KEYS = ['MCP_OAUTH_PRIVATE_KEY_PEM', 'NEXT_PUBLIC_APP_URL'] as const;
const previousEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of ENV_KEYS) previousEnv[key] = process.env[key];
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  process.env.MCP_OAUTH_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
  process.env.NEXT_PUBLIC_APP_URL = 'https://post-engineer.test';
  clearOAuthKeysCache();
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
  clearOAuthKeysCache();
});

beforeEach(() => {
  refreshStore.clear();
  installServiceClientMock();
});

function form(body: Record<string, string>): Request {
  return new Request('https://post-engineer.test/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
}

function jsonBody(body: Record<string, string>): Request {
  return new Request('https://post-engineer.test/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

async function freshCode(): Promise<string> {
  const keys = await getOAuthKeys();
  return mintAuthorizationCode(keys, {
    sub: 'user-1',
    clientId: 'mcp_client_abc',
    redirectUri: 'https://chatgpt.com/connector/callback',
    scope: 'mcp:tools offline_access',
    resource: getMcpResource(),
    codeChallenge: CHALLENGE,
  });
}

describe('POST /oauth/token', () => {
  it('exchanges a code+PKCE for access and refresh tokens', async () => {
    const response = await POST(
      form({
        grant_type: 'authorization_code',
        code: await freshCode(),
        redirect_uri: 'https://chatgpt.com/connector/callback',
        client_id: 'mcp_client_abc',
        code_verifier: VERIFIER,
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.token_type).toBe('Bearer');
    expect(typeof body.access_token).toBe('string');
    expect(typeof body.refresh_token).toBe('string');
    expect(body.scope).toBe('mcp:tools offline_access');
  });

  it('rotates refresh tokens', async () => {
    const first = (await (
      await POST(
        form({
          grant_type: 'authorization_code',
          code: await freshCode(),
          redirect_uri: 'https://chatgpt.com/connector/callback',
          client_id: 'mcp_client_abc',
          code_verifier: VERIFIER,
        }),
      )
    ).json()) as Record<string, unknown>;

    const rotated = await POST(
      form({
        grant_type: 'refresh_token',
        refresh_token: first.refresh_token as string,
        client_id: 'mcp_client_abc',
      }),
    );
    expect(rotated.status).toBe(200);
    const body = (await rotated.json()) as Record<string, unknown>;
    expect(typeof body.access_token).toBe('string');
    expect(typeof body.refresh_token).toBe('string');
    expect(body.refresh_token).not.toBe(first.refresh_token);
  });

  it('accepts JSON body like ChatGPT does', async () => {
    const response = await POST(
      jsonBody({
        grant_type: 'authorization_code',
        code: await freshCode(),
        redirect_uri: 'https://chatgpt.com/connector/callback',
        client_id: 'mcp_client_abc',
        code_verifier: VERIFIER,
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.token_type).toBe('Bearer');
    expect(typeof body.access_token).toBe('string');
    expect(typeof body.refresh_token).toBe('string');
  });

  it('rejects wrong verifier, wrong client and unknown grants', async () => {
    const badVerifier = await POST(
      form({
        grant_type: 'authorization_code',
        code: await freshCode(),
        redirect_uri: 'https://chatgpt.com/connector/callback',
        client_id: 'mcp_client_abc',
        code_verifier: 'wrong-verifier-value-which-is-long-enough-1234567890',
      }),
    );
    expect(badVerifier.status).toBe(400);

    const badClient = await POST(
      form({
        grant_type: 'authorization_code',
        code: await freshCode(),
        redirect_uri: 'https://chatgpt.com/connector/callback',
        client_id: 'mcp_client_other',
        code_verifier: VERIFIER,
      }),
    );
    expect(badClient.status).toBe(400);

    const badGrant = await POST(form({ grant_type: 'client_credentials' }));
    expect(badGrant.status).toBe(400);
    expect(((await badGrant.json()) as Record<string, unknown>).error).toBe(
      'unsupported_grant_type',
    );
  });

  it('rejects a replayed refresh token with invalid_grant (single-use rotation)', async () => {
    const first = (await (
      await POST(
        form({
          grant_type: 'authorization_code',
          code: await freshCode(),
          redirect_uri: 'https://chatgpt.com/connector/callback',
          client_id: 'mcp_client_abc',
          code_verifier: VERIFIER,
        }),
      )
    ).json()) as Record<string, unknown>;
    const refreshA = first.refresh_token as string;

    const rotated = await POST(
      form({
        grant_type: 'refresh_token',
        refresh_token: refreshA,
        client_id: 'mcp_client_abc',
      }),
    );
    expect(rotated.status).toBe(200);
    const refreshB = ((await rotated.json()) as Record<string, unknown>).refresh_token;
    expect(refreshB).not.toBe(refreshA);

    // Replaying the consumed token must fail…
    const replay = await POST(
      form({
        grant_type: 'refresh_token',
        refresh_token: refreshA,
        client_id: 'mcp_client_abc',
      }),
    );
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as Record<string, unknown>).error).toBe('invalid_grant');

    // …while the replacement keeps working.
    const second = await POST(
      form({
        grant_type: 'refresh_token',
        refresh_token: refreshB as string,
        client_id: 'mcp_client_abc',
      }),
    );
    expect(second.status).toBe(200);
  });

  it('rejects a validly-signed but unregistered refresh token with invalid_grant', async () => {
    const keys = await getOAuthKeys();
    const stranger = await mintRefreshToken(keys, {
      sub: 'user-1',
      clientId: 'mcp_client_abc',
      scope: 'mcp:tools offline_access',
      resource: getMcpResource(),
    });
    const res = await POST(
      form({
        grant_type: 'refresh_token',
        refresh_token: stranger,
        client_id: 'mcp_client_abc',
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, unknown>).error).toBe('invalid_grant');
  });
});

describe('POST /oauth/token rate limiting', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.stubEnv('VERCEL', '1');
  });
  it('returns 429 after the oauthToken profile limit is exhausted', async () => {
    const { RATE_LIMITS } = await import('@/lib/rate-limit');
    const headers = {
      'Content-Type': 'application/json',
      'x-vercel-forwarded-for': '10.250.0.1',
    };
    const url = 'https://post-engineer.test/oauth/token';
    for (let i = 0; i < RATE_LIMITS.oauthToken.limit; i++) {
      const res = await POST(new Request(url, { method: 'POST', headers, body: '{}' }));
      expect(res.status).not.toBe(429);
    }
    const blocked = await POST(new Request(url, { method: 'POST', headers, body: '{}' }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
  });
});

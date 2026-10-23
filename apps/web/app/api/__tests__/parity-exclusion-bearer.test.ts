// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';

// Behavioural proof of the MCP parity exclusions that are about bearer
// credentials (apps/mcp/src/__tests__/parity-exclusions.json). Each excluded
// handler is imported and called with the real requireSupabaseSession and a
// bearer credential that resolves successfully (a valid API key, then a
// valid MCP OAuth token), with no cookie session:
// - session-only: 401, and the credential is never even resolved.
// - bearer-rejected: the credential resolves and the handler answers 403.
// The static checks in the MCP parity test prove the shape of the code;
// this proves the behaviour, so an auth helper hidden behind another module
// cannot make a session-only claim false.

const resolveApiKey = vi.fn();
const verifyAccessToken = vi.fn();

vi.mock('@/lib/api-keys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-keys')>();
  return { ...actual, resolveApiKey: (...args: unknown[]) => resolveApiKey(...args) };
});
vi.mock('@/lib/oauth/tokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/oauth/tokens')>();
  return { ...actual, verifyAccessToken: (...args: unknown[]) => verifyAccessToken(...args) };
});
vi.mock('@/lib/oauth/keys', () => ({ getOAuthKeys: vi.fn(async () => ({})) }));
vi.mock('@/lib/oauth/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/oauth/config')>();
  return { ...actual, getMcpResource: () => 'https://example.com/mcp' };
});

// No cookie session: getUser() finds no user. Any data access fails loudly
// so a handler that reaches the database before rejecting the caller shows
// up as a 500 instead of passing.
function noDataAccess(): never {
  throw new Error('data access before authentication');
}
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signOut: noDataAccess,
    },
    from: noDataAccess,
    rpc: noDataAccess,
  })),
}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(() => ({ from: noDataAccess, rpc: noDataAccess })),
}));
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn(async () => null) };
});
vi.mock('@/lib/api-error-reporting', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-error-reporting')>();
  return {
    ...actual,
    withApiErrorReporting: (_route: string, handler: unknown) => handler,
    resolveReportingUserId: vi.fn(),
  };
});
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(() => 'log-id'),
    warn: vi.fn(() => 'log-id'),
    info: vi.fn(() => 'log-id'),
    generateLogId: vi.fn(() => 'log-id'),
  },
}));

const repoRoot = findRepoRoot(import.meta.url);
const parity = JSON.parse(
  readFileSync(join(repoRoot, 'apps/mcp/src/__tests__/parity-exclusions.json'), 'utf8'),
) as { exclusions: Record<string, { kind: string }> };

function byKind(kind: string): string[] {
  return Object.entries(parity.exclusions)
    .filter(([, exclusion]) => exclusion.kind === kind)
    .map(([key]) => key)
    .sort();
}

const API_KEY = `pe_live_${'a'.repeat(48)}`;
const OAUTH_JWT = 'header.payload.signature';

type Handler = (request: Request, context: { params: Promise<Record<string, unknown>> }) => Promise<Response>;

async function call(key: string, bearer: string, headerName = 'authorization'): Promise<Response> {
  const [method, path] = key.split(' ');
  const routeModule = (await import(
    /* @vite-ignore */ join(repoRoot, 'apps/web/app', path, 'route.ts')
  )) as Record<string, Handler | undefined>;
  const handler = routeModule[method];
  if (handler === undefined) throw new Error(`${key}: no ${method} export`);
  const request = new Request(`https://example.com${path}`, {
    method,
    headers: { [headerName]: headerName === 'authorization' ? `Bearer ${bearer}` : bearer, 'content-type': 'application/json' },
    body: method === 'GET' || method === 'HEAD' ? undefined : '{}',
  });
  return handler(request, { params: Promise.resolve({}) });
}

describe('parity exclusions: bearer callers', () => {
  beforeEach(() => {
    resolveApiKey.mockReset();
    resolveApiKey.mockResolvedValue({ userId: 'user-1', keyId: 'key-1', personaIds: null });
    verifyAccessToken.mockReset();
    verifyAccessToken.mockResolvedValue({ sub: 'user-1' });
    vi.stubEnv('MONEYPRINT_API_URL', 'http://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'engine-secret');
  });

  it('has session-only and bearer-rejected exclusions to check', () => {
    expect(byKind('session-only').length).toBeGreaterThan(0);
    expect(byKind('bearer-rejected').length).toBeGreaterThan(0);
  });

  it.each(byKind('session-only'))('%s answers 401 to a valid API key and never resolves it', async (key) => {
    const response = await call(key, API_KEY);
    expect(response.status).toBe(401);
    expect(resolveApiKey).not.toHaveBeenCalled();
  });

  it.each(byKind('session-only'))('%s answers 401 to a valid API key in x-api-key and never resolves it', async (key) => {
    const response = await call(key, API_KEY, 'x-api-key');
    expect(response.status).toBe(401);
    expect(resolveApiKey).not.toHaveBeenCalled();
  });

  it.each(byKind('session-only'))('%s answers 401 to a valid OAuth token and never verifies it', async (key) => {
    const response = await call(key, OAUTH_JWT);
    expect(response.status).toBe(401);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it.each(byKind('bearer-rejected'))('%s answers 403 to a valid API key', async (key) => {
    const response = await call(key, API_KEY);
    expect(resolveApiKey).toHaveBeenCalled();
    expect(response.status).toBe(403);
  });

  it.each(byKind('bearer-rejected'))('%s answers 403 to a valid API key in x-api-key', async (key) => {
    const response = await call(key, API_KEY, 'x-api-key');
    expect(resolveApiKey).toHaveBeenCalled();
    expect(response.status).toBe(403);
  });

  it.each(byKind('bearer-rejected'))('%s answers 403 to a valid OAuth token', async (key) => {
    const response = await call(key, OAUTH_JWT);
    expect(verifyAccessToken).toHaveBeenCalled();
    expect(response.status).toBe(403);
  });
});

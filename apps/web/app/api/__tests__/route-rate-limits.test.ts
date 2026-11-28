import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyRateLimit, CALLER_RATE_LIMITS, RATE_LIMITS, type RateLimitProfile } from '@/lib/rate-limit';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getOAuthKeys } from '@/lib/oauth/keys';
import { parseAuthorizeRequest } from '@/lib/oauth/authorize';

vi.mock('@/lib/api-error-reporting', () => ({
  withApiErrorReporting: (_route: string, handler: unknown) => handler,
  resolveReportingUserId: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), generateLogId: vi.fn(() => 'log-1') },
}));
vi.mock('@/lib/request-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/request-auth')>()),
  requireSupabaseSession: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({})) }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock('@/lib/oauth/keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/oauth/keys')>()),
  getOAuthKeys: vi.fn(),
}));
vi.mock('@/lib/oauth/authorize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/oauth/authorize')>()),
  parseAuthorizeRequest: vi.fn(),
}));

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

interface RateLimitCase {
  route: string;
  profile: RateLimitProfile;
  browser?: RateLimitProfile;
  bucket: 'user' | 'ip';
  load: () => Promise<Handler>;
  url: string;
  method: string;
  params?: Record<string, string>;
  body?: string;
}

const USER_ID = '11111111-1111-4111-8111-111111111111';
const UUID = '22222222-2222-4222-8222-222222222222';
const BASE = 'http://localhost:3434';

function handler(value: unknown): Handler {
  if (typeof value !== 'function') throw new Error('route does not export this method');
  return value as Handler;
}

const CASES: RateLimitCase[] = [
  { route: 'GET /api/account', profile: CALLER_RATE_LIMITS.accountList.machine, browser: CALLER_RATE_LIMITS.accountList.browser, bucket: 'user', method: 'GET', url: '/api/account', load: async () => handler((await import('@/app/api/account/route')).GET) },
  { route: 'DELETE /api/account', profile: RATE_LIMITS.accountDisconnect, bucket: 'user', method: 'DELETE', url: `/api/account?id=${UUID}`, load: async () => handler((await import('@/app/api/account/route')).DELETE) },
  { route: 'GET /api/api-keys', profile: RATE_LIMITS.apiKeyList, bucket: 'user', method: 'GET', url: '/api/api-keys', load: async () => handler((await import('@/app/api/api-keys/route')).GET) },
  { route: 'DELETE /api/api-keys/[id]', profile: RATE_LIMITS.apiKeyManage, bucket: 'user', method: 'DELETE', url: `/api/api-keys/${UUID}`, params: { id: UUID }, load: async () => handler((await import('@/app/api/api-keys/[id]/route')).DELETE) },
  { route: 'PATCH /api/api-keys/[id]', profile: RATE_LIMITS.apiKeyManage, bucket: 'user', method: 'PATCH', url: `/api/api-keys/${UUID}`, params: { id: UUID }, body: '{"approvalMode":"yolo"}', load: async () => handler((await import('@/app/api/api-keys/[id]/route')).PATCH) },
  { route: 'GET /api/health', profile: RATE_LIMITS.healthProbe, bucket: 'user', method: 'GET', url: '/api/health', load: async () => handler((await import('@/app/api/health/route')).GET) },
  { route: 'GET /api/version', profile: RATE_LIMITS.versionProbe, bucket: 'ip', method: 'GET', url: '/api/version', load: async () => handler((await import('@/app/api/version/route')).GET) },
  { route: 'GET /api/persona/list', profile: CALLER_RATE_LIMITS.personaList.machine, browser: CALLER_RATE_LIMITS.personaList.browser, bucket: 'user', method: 'GET', url: '/api/persona/list', load: async () => handler((await import('@/app/api/persona/list/route')).GET) },
  { route: 'GET /api/persona/identity-card', profile: CALLER_RATE_LIMITS.personaIdentityCard.machine, browser: CALLER_RATE_LIMITS.personaIdentityCard.browser, bucket: 'user', method: 'GET', url: `/api/persona/identity-card?personaId=${UUID}`, load: async () => handler((await import('@/app/api/persona/identity-card/route')).GET) },
  { route: 'POST /api/persona/identity-card', profile: CALLER_RATE_LIMITS.personaIdentityCard.machine, browser: CALLER_RATE_LIMITS.personaIdentityCard.browser, bucket: 'user', method: 'POST', url: '/api/persona/identity-card', body: `{"personaId":"${UUID}","scene":{"lighting":"studio","framing":"close_up"}}`, load: async () => handler((await import('@/app/api/persona/identity-card/route')).POST) },
  { route: 'GET /api/schedule', profile: CALLER_RATE_LIMITS.scheduleList.machine, browser: CALLER_RATE_LIMITS.scheduleList.browser, bucket: 'user', method: 'GET', url: '/api/schedule', load: async () => handler((await import('@/app/api/schedule/route')).GET) },
  { route: 'DELETE /api/schedule', profile: RATE_LIMITS.scheduleDelete, bucket: 'user', method: 'DELETE', url: `/api/schedule?id=${UUID}`, load: async () => handler((await import('@/app/api/schedule/route')).DELETE) },
  { route: 'GET /api/schedule/status', profile: CALLER_RATE_LIMITS.scheduleStatus.machine, browser: CALLER_RATE_LIMITS.scheduleStatus.browser, bucket: 'user', method: 'GET', url: '/api/schedule/status', load: async () => handler((await import('@/app/api/schedule/status/route')).GET) },
  { route: 'DELETE /api/schedule/slots/[slotId]', profile: RATE_LIMITS.slotWrite, bucket: 'user', method: 'DELETE', url: `/api/schedule/slots/${UUID}`, params: { slotId: UUID }, load: async () => handler((await import('@/app/api/schedule/slots/[slotId]/route')).DELETE) },
  { route: 'PATCH /api/schedule/slots/[slotId]', profile: RATE_LIMITS.slotWrite, bucket: 'user', method: 'PATCH', url: `/api/schedule/slots/${UUID}`, params: { slotId: UUID }, body: '{"title":"x"}', load: async () => handler((await import('@/app/api/schedule/slots/[slotId]/route')).PATCH) },
  { route: 'POST /api/schedule/slots/[slotId]/approve', profile: RATE_LIMITS.slotApprove, bucket: 'user', method: 'POST', url: `/api/schedule/slots/${UUID}/approve`, params: { slotId: UUID }, load: async () => handler((await import('@/app/api/schedule/slots/[slotId]/approve/route')).POST) },
  { route: 'POST /api/schedule/slots/[slotId]/reject', profile: RATE_LIMITS.slotApprove, bucket: 'user', method: 'POST', url: `/api/schedule/slots/${UUID}/reject`, params: { slotId: UUID }, load: async () => handler((await import('@/app/api/schedule/slots/[slotId]/reject/route')).POST) },
  { route: 'GET /api/share-links', profile: RATE_LIMITS.shareLinkList, bucket: 'user', method: 'GET', url: '/api/share-links', load: async () => handler((await import('@/app/api/share-links/route')).GET) },
  { route: 'GET /oauth/authorize', profile: RATE_LIMITS.oauthAuthorize, bucket: 'ip', method: 'GET', url: '/oauth/authorize?client_id=c', load: async () => handler((await import('@/app/oauth/authorize/route')).GET) },
  { route: 'POST /oauth/approve', profile: RATE_LIMITS.oauthApprove, bucket: 'ip', method: 'POST', url: '/oauth/approve', body: 'request=r&decision=approve', load: async () => handler((await import('@/app/oauth/approve/route')).POST) },
];

function makeRequest(entry: RateLimitCase): Request {
  return new Request(`${BASE}${entry.url}`, {
    method: entry.method,
    headers: { 'x-forwarded-for': '203.0.113.9', 'content-type': entry.body?.startsWith('{') === true ? 'application/json' : 'application/x-www-form-urlencoded' },
    body: entry.body,
  });
}

async function exhaust(entry: RateLimitCase, profile: RateLimitProfile = entry.profile): Promise<void> {
  for (let index = 0; index < profile.limit; index += 1) {
    const result = entry.bucket === 'user'
      ? await applyRateLimit(makeRequest(entry), profile, USER_ID)
      : await applyRateLimit(makeRequest(entry), profile);
    expect(result).toBeNull();
  }
}

const fetchMock = vi.fn();

beforeEach(() => {
  Reflect.deleteProperty(globalThis, '__rateLimitStore');
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: { userId: USER_ID, accessToken: 'k', isApiKey: true }, error: null } as never);
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })) },
  } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function emptyPersonaListClient(): unknown {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in']) chain[method] = () => chain;
  chain.order = async () => ({ data: [], error: null });
  return { from: () => chain };
}

describe('rate limits on API-key reachable and expensive routes', () => {
  it.each(CASES.map((entry) => [entry.route, entry] as const))('%s answers 429 with Retry-After once its budget is spent', async (_route, entry) => {
    const route = await entry.load();
    await exhaust(entry);

    const response = await route(makeRequest(entry), { params: Promise.resolve(entry.params ?? {}) });

    expect(response.status).toBe(429);
    const retryAfter = Number(response.headers.get('Retry-After'));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(Math.ceil(entry.profile.windowMs / 1000));
    expect(response.headers.get('X-RateLimit-Limit')).toBe(String(entry.profile.limit));
    await expect(response.json()).resolves.toMatchObject({ success: false, errorType: 'RATE_LIMITED', retryAfterSeconds: retryAfter });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getOAuthKeys).not.toHaveBeenCalled();
    expect(parseAuthorizeRequest).not.toHaveBeenCalled();
  });

  it.each(CASES.filter((entry) => entry.browser !== undefined).map((entry) => [entry.route, entry] as const))('%s gives a browser session its own larger budget', async (_route, entry) => {
    const browser = entry.browser;
    if (browser === undefined) throw new Error('missing browser profile');
    expect(browser.limit).toBeGreaterThan(entry.profile.limit);
    vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: { userId: USER_ID, accessToken: 'session' }, error: null } as never);
    const route = await entry.load();
    await exhaust(entry, browser);

    const response = await route(makeRequest(entry), { params: Promise.resolve(entry.params ?? {}) });

    expect(response.status).toBe(429);
    expect(response.headers.get('X-RateLimit-Limit')).toBe(String(browser.limit));
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('does not spend the browser budget on API-key calls', async () => {
    const entry = CASES.find((candidate) => candidate.route === 'GET /api/persona/list');
    if (entry === undefined) throw new Error('missing case');
    vi.mocked(createSupabaseServiceClient).mockReturnValue(emptyPersonaListClient() as never);
    const route = await entry.load();
    await exhaust(entry);
    vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: { userId: USER_ID, accessToken: 'session' }, error: null } as never);

    const response = await route(makeRequest(entry), { params: Promise.resolve({}) });

    expect(response.status).not.toBe(429);
    expect(response.headers.get('Retry-After')).toBeNull();
  });

  it('keys user-bucketed limits by the caller, so another user is not throttled', async () => {
    const entry = CASES.find((candidate) => candidate.route === 'GET /api/persona/list');
    if (entry === undefined) throw new Error('missing case');
    vi.mocked(createSupabaseServiceClient).mockReturnValue(emptyPersonaListClient() as never);
    const route = await entry.load();
    await exhaust(entry);
    vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: { userId: UUID, accessToken: 'k', isApiKey: true }, error: null } as never);

    const response = await route(makeRequest(entry), { params: Promise.resolve({}) });

    expect(response.status).not.toBe(429);
    expect(response.headers.get('Retry-After')).toBeNull();
  });

  it('keeps browser polling budgets above the UI refetch rates', () => {
    const perMinute = (intervalMs: number): number => Math.ceil(60_000 / intervalMs);
    expect(CALLER_RATE_LIMITS.personaList.browser.limit).toBeGreaterThan(perMinute(30_000));
    expect(CALLER_RATE_LIMITS.scheduleStatus.browser.limit).toBeGreaterThan(3 * perMinute(60_000));
  });
});

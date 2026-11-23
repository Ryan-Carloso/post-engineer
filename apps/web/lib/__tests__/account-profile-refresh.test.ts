import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/session-expiry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/session-expiry')>()),
  notifyIfSessionExpired: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { refreshAccountProfiles, ACCOUNT_PROFILE_REFRESH_URL } from '@/lib/account-profile-refresh';
import { notifyIfSessionExpired } from '@/lib/session-expiry';
import { logger } from '@/lib/logger';

function stubFetch(response: { ok: boolean; status: number; json: () => Promise<unknown> }) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('refreshAccountProfiles', () => {
  beforeEach(() => {
    vi.mocked(logger.error).mockClear();
    vi.mocked(notifyIfSessionExpired).mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the account list with refresh=1 and returns the payload', async () => {
    const payload = { authenticated: true, accounts: [{ provider: 'instagram' }] };
    const fetchMock = stubFetch({ ok: true, status: 200, json: async () => payload });
    const result = await refreshAccountProfiles();
    expect(fetchMock).toHaveBeenCalledWith('/api/account?refresh=1');
    expect(ACCOUNT_PROFILE_REFRESH_URL).toBe('/api/account?refresh=1');
    expect(result).toEqual({ success: true, payload });
    expect(notifyIfSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('returns a failure on a non-2xx status without reading the body', async () => {
    const json = vi.fn(async () => ({}));
    stubFetch({ ok: false, status: 429, json });
    expect(await refreshAccountProfiles()).toEqual({ success: false, error: 'HTTP_429' });
    expect(json).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('[api/account] profile refresh failed', expect.any(Error));
  });

  it('returns a failure on a non-JSON body', async () => {
    stubFetch({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    expect(await refreshAccountProfiles()).toEqual({ success: false, error: 'INVALID_RESPONSE' });
  });

  it.each([null, 'text', { authenticated: false, accounts: [] }, { authenticated: true, accounts: 'x' }])(
    'returns a failure on the unexpected body %j',
    async (body) => {
      stubFetch({ ok: true, status: 200, json: async () => body });
      expect(await refreshAccountProfiles()).toEqual({ success: false, error: 'INVALID_RESPONSE' });
    },
  );

  it('returns a failure when the request never reaches the server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await refreshAccountProfiles()).toEqual({ success: false, error: 'NETWORK_ERROR' });
    expect(logger.error).toHaveBeenCalledWith('[api/account] profile refresh request failed', expect.any(TypeError));
  });
});

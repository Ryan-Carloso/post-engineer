import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeOAuthStateStore } from '@/test/oauth-state-store';

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    generateLogId: vi.fn(() => 'test-log-id'),
  },
}));

// Shared in-memory oauth_states fake: applies every filter of the real
// query chains, including the user_id ownership predicate.
const makeStore = makeOAuthStateStore;

const REDIRECT = 'https://post-engineer.com/api/instagram-auth/callback';

describe('oauth-connect', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('hashOAuthState is deterministic and does not expose the state', async () => {
    const { hashOAuthState } = await import('@/lib/oauth-connect');
    const a = hashOAuthState('state-123');
    const b = hashOAuthState('state-123');
    expect(a).toBe(b);
    expect(a).not.toContain('state-123');
    expect(hashOAuthState('state-456')).not.toBe(a);
  });

  it('storeOAuthState + consumeOAuthState: single-use and returns the data', async () => {
    const { storeOAuthState, consumeOAuthState, hashOAuthState } = await import('@/lib/oauth-connect');
    const store = makeStore();
    await storeOAuthState(store as never, {
      state: 'raw-state-abc',
      userId: 'user-1',
      provider: 'instagram',
      nonce: 'nonce-1',
      redirectUri: REDIRECT,
    });
    const consumed = await consumeOAuthState(store as never, 'raw-state-abc', 'user-1');
    expect(consumed).toMatchObject({
      userId: 'user-1',
      provider: 'instagram',
      nonce: 'nonce-1',
      redirectUri: REDIRECT,
    });
    // single-use: second read returns null (row was deleted on consumption)
    expect(await consumeOAuthState(store as never, 'raw-state-abc', 'user-1')).toBeNull();
    expect(store.rows.has(hashOAuthState('raw-state-abc'))).toBe(false);
  });

  it('consumeOAuthState returns null for expired state and cleans the row', async () => {
    const { storeOAuthState, consumeOAuthState, hashOAuthState } = await import('@/lib/oauth-connect');
    const store = makeStore();
    await storeOAuthState(store as never, {
      state: 'raw-state-exp',
      userId: 'user-1',
      provider: 'youtube',
      nonce: 'nonce-2',
      redirectUri: 'https://post-engineer.com/api/google-oauth/callback',
      expiresInSeconds: -10,
    });
    expect(await consumeOAuthState(store as never, 'raw-state-exp', 'user-1')).toBeNull();
    // expired is not returned, but the row is cleaned (best-effort)
    expect(store.rows.has(hashOAuthState('raw-state-exp'))).toBe(false);
  });

  it('consumeOAuthState leaves a state owned by another user in place', async () => {
    const { storeOAuthState, consumeOAuthState, hashOAuthState } = await import('@/lib/oauth-connect');
    const store = makeStore();
    await storeOAuthState(store as never, {
      state: 'raw-state-owned',
      userId: 'owner-user',
      provider: 'instagram',
      nonce: 'nonce-o',
      redirectUri: REDIRECT,
    });
    const { logger } = await import('@/lib/logger');
    vi.mocked(logger.warn).mockClear();
    expect(await consumeOAuthState(store as never, 'raw-state-owned', 'other-user')).toBeNull();
    // a mismatching caller cannot burn the owner's single-use state
    expect(store.rows.has(hashOAuthState('raw-state-owned'))).toBe(true);
    // logged distinctly from expired/unknown, by state reference only
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/another user/i),
      { stateRef: hashOAuthState('raw-state-owned').slice(0, 12) }
    );
    expect(await consumeOAuthState(store as never, 'raw-state-owned', 'owner-user')).toMatchObject({
      userId: 'owner-user',
    });
  });

  it('consumeOAuthState: atomic DELETE first, diagnostic SELECT only on miss', async () => {
    const { consumeOAuthState } = await import('@/lib/oauth-connect');
    const calls: string[] = [];
    const fake = {
      from: vi.fn(() => ({
        delete: () => {
          calls.push('delete');
          return {
            eq: (_col: string, _val: string) => ({
              // atomic consumption: DELETE ... WHERE user_id = owner AND expires_at > now RETURNING ...
              eq: (col: string, val: string) => {
                calls.push(`owner-filter:${col}=${val}`);
                return {
                  gt: (_c2: string, _nowIso: string) => ({
                    select: async (_cols: string) => {
                      calls.push('select-after-delete');
                      return { data: [], error: null };
                    },
                  }),
                };
              },
              // best-effort cleanup of expired rows
              lte: (_c2: string, _nowIso: string) => {
                calls.push('cleanup-delete');
                return Promise.resolve({ error: null });
              },
            }),
          };
        },
        // diagnostic read on miss: expired vs unknown state
        select: (_cols: string) => {
          calls.push('diagnostic-select');
          return {
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          };
        },
      })),
    };
    await consumeOAuthState(fake as never, 'whatever', 'owner-1');
    // the consumption itself never reads first: single conditional DELETE
    // whose predicate carries the owner; on a miss exactly one diagnostic
    // SELECT follows, and with no expired row there is no cleanup DELETE.
    expect(calls).toEqual([
      'delete',
      'owner-filter:user_id=owner-1',
      'select-after-delete',
      'diagnostic-select',
    ]);
    expect(fake.from).toHaveBeenCalledWith('oauth_states');
  });

  it('buildOAuthConnectUrl generates the Instagram auth URL with embedded state', async () => {
    process.env.INSTAGRAM_CLIENT_ID = 'test-client-id';
    process.env.INSTAGRAM_CLIENT_SECRET = 'test-client-secret';
    const { buildOAuthConnectUrl } = await import('@/lib/oauth-connect');
    const result = await buildOAuthConnectUrl('instagram', REDIRECT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.authUrl).toContain('instagram.com');
      expect(result.authUrl).toContain(encodeURIComponent(result.state).slice(0, 8));
      expect(result.state).toBeTruthy();
      expect(result.nonce).toBeTruthy();
    }
    delete process.env.INSTAGRAM_CLIENT_ID;
    delete process.env.INSTAGRAM_CLIENT_SECRET;
  });

  it('buildOAuthConnectUrl rejects an unknown provider', async () => {
    const { buildOAuthConnectUrl } = await import('@/lib/oauth-connect');
    const result = await buildOAuthConnectUrl('tiktok' as never, 'https://post-engineer.com/api/x/callback');
    expect(result.ok).toBe(false);
  });

  it('buildOAuthConnectUrl fails without configured credentials', async () => {
    delete process.env.INSTAGRAM_CLIENT_ID;
    delete process.env.INSTAGRAM_CLIENT_SECRET;
    const { buildOAuthConnectUrl } = await import('@/lib/oauth-connect');
    const result = await buildOAuthConnectUrl('instagram', REDIRECT);
    expect(result.ok).toBe(false);
  });

  it('buildOAuthConnectUrl for Threads uses the Threads app id, not the Instagram one', async () => {
    vi.stubEnv('INSTAGRAM_CLIENT_ID', 'ig-app-id');
    vi.stubEnv('INSTAGRAM_CLIENT_SECRET', 'ig-app-secret');
    vi.stubEnv('THREADS_CLIENT_ID', 'threads-app-id');
    vi.stubEnv('THREADS_CLIENT_SECRET', 'threads-app-secret');
    const { buildOAuthConnectUrl } = await import('@/lib/oauth-connect');
    const result = await buildOAuthConnectUrl('threads', 'https://app.example/threads/callback');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new URL(result.authUrl).searchParams.get('client_id')).toBe('threads-app-id');
    }
    vi.unstubAllEnvs();
  });

  it('buildOAuthConnectUrl for Threads fails without Threads credentials even if Instagram vars are set', async () => {
    vi.stubEnv('INSTAGRAM_CLIENT_ID', 'ig-app-id');
    vi.stubEnv('INSTAGRAM_CLIENT_SECRET', 'ig-app-secret');
    vi.stubEnv('THREADS_CLIENT_ID', undefined);
    vi.stubEnv('THREADS_CLIENT_SECRET', undefined);
    const { buildOAuthConnectUrl } = await import('@/lib/oauth-connect');
    const result = await buildOAuthConnectUrl('threads', 'https://app.example/threads/callback');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('THREADS_CLIENT_ID');
    vi.unstubAllEnvs();
  });
});

describe('buildOAuthConnectUrl — facebook', () => {
  it('builds the Facebook Pages consent URL with the Facebook app id and a facebook state', async () => {
    vi.stubEnv('FACEBOOK_CLIENT_ID', 'fb-app-id');
    vi.stubEnv('FACEBOOK_CLIENT_SECRET', 'fb-app-secret');
    const { buildOAuthConnectUrl } = await import('@/lib/oauth-connect');
    const { decodeOAuthState } = await import('@/lib/oauth-utils');
    const result = await buildOAuthConnectUrl('facebook', 'https://app.example/facebook/callback');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const url = new URL(result.authUrl);
      expect(url.hostname).toBe('www.facebook.com');
      expect(url.searchParams.get('client_id')).toBe('fb-app-id');
      expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/facebook/callback');
      expect(url.searchParams.get('scope')).toContain('pages_manage_posts');
      expect(url.searchParams.get('state')).toBe(result.state);
      expect(decodeOAuthState(result.state)).toMatchObject({ provider: 'facebook', redirectUri: 'https://app.example/facebook/callback' });
    }
    vi.unstubAllEnvs();
  });

  it.each(['FACEBOOK_CLIENT_ID', 'FACEBOOK_CLIENT_SECRET'])('fails naming the credentials when %s is missing', async (name) => {
    vi.stubEnv('FACEBOOK_CLIENT_ID', 'fb-app-id');
    vi.stubEnv('FACEBOOK_CLIENT_SECRET', 'fb-app-secret');
    vi.stubEnv(name, undefined);
    const { buildOAuthConnectUrl } = await import('@/lib/oauth-connect');
    const result = await buildOAuthConnectUrl('facebook', 'https://app.example/facebook/callback');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('FACEBOOK_CLIENT_ID / FACEBOOK_CLIENT_SECRET');
    vi.unstubAllEnvs();
  });
});

describe('resolveOAuthCallbackAuth', () => {
  async function webRequest(state: string, nonce: string | null) {
    const { NextRequest } = await import('next/server');
    return new NextRequest('https://post-engineer.com/api/instagram-auth/callback', {
      headers: nonce ? { cookie: `oauth_state_nonce=${nonce}` } : {},
    });
  }

  async function storedState(store: ReturnType<typeof makeStore>, overrides: Partial<{
    state: string; userId: string; provider: string; nonce: string; redirectUri: string;
  }> = {}) {
    const { storeOAuthState, hashOAuthState } = await import('@/lib/oauth-connect');
    const { createOAuthState } = await import('@/lib/oauth-utils');
    const created = createOAuthState({
      provider: (overrides.provider ?? 'instagram') as 'instagram',
      redirectUri: overrides.redirectUri ?? REDIRECT,
    });
    const state = overrides.state ?? created.state;
    const nonce = overrides.nonce ?? created.nonce;
    await storeOAuthState(store as never, {
      state,
      userId: overrides.userId ?? 'api-key-owner',
      provider: overrides.provider ?? 'instagram',
      nonce,
      redirectUri: overrides.redirectUri ?? REDIRECT,
    });
    return { state, nonce, hash: hashOAuthState(state) };
  }

  it('web flow: valid cookie + session returns the session userId (viaMcp false)', async () => {
    const { resolveOAuthCallbackAuth } = await import('@/lib/oauth-connect');
    const { createOAuthState } = await import('@/lib/oauth-utils');
    const { state, nonce } = createOAuthState({ provider: 'instagram', redirectUri: REDIRECT });
    const request = await webRequest(state, nonce);
    const result = await resolveOAuthCallbackAuth(request, state, 'session-user', () => makeStore() as never, 'instagram');
    expect(result).toEqual({ ok: true, userId: 'session-user', viaMcp: false, redirectUri: REDIRECT });
  });

  it('web flow: valid cookie without session returns 401', async () => {
    const { resolveOAuthCallbackAuth } = await import('@/lib/oauth-connect');
    const { createOAuthState } = await import('@/lib/oauth-utils');
    const { state, nonce } = createOAuthState({ provider: 'instagram', redirectUri: REDIRECT });
    const request = await webRequest(state, nonce);
    const result = await resolveOAuthCallbackAuth(request, state, null, () => makeStore() as never, 'instagram');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it('web flow: state from another provider in the cookie is rejected (403)', async () => {
    const { resolveOAuthCallbackAuth } = await import('@/lib/oauth-connect');
    const { createOAuthState } = await import('@/lib/oauth-utils');
    // state created for instagram, but the expected callback is youtube's
    const { state, nonce } = createOAuthState({ provider: 'instagram', redirectUri: REDIRECT });
    const request = await webRequest(state, nonce);
    const result = await resolveOAuthCallbackAuth(request, state, 'session-user', () => makeStore() as never, 'youtube');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toMatch(/mismatch/i);
    }
  });

  it('MCP flow: no cookie, owner session consumes the stored state and returns the owner userId', async () => {
    const { resolveOAuthCallbackAuth } = await import('@/lib/oauth-connect');
    const store = makeStore();
    const { state, hash } = await storedState(store);
    const request = await webRequest(state, null);
    const result = await resolveOAuthCallbackAuth(request, state, 'api-key-owner', () => store as never, 'instagram');
    expect(result).toEqual({
      ok: true,
      userId: 'api-key-owner',
      viaMcp: true,
      redirectUri: REDIRECT,
    });
    expect(store.rows.has(hash)).toBe(false);
  });

  it('MCP flow: no session returns 401 without touching the stored state', async () => {
    const { resolveOAuthCallbackAuth } = await import('@/lib/oauth-connect');
    const store = makeStore();
    const { state, hash } = await storedState(store);
    store.tables.length = 0;
    const request = await webRequest(state, null);
    const result = await resolveOAuthCallbackAuth(request, state, null, () => store as never, 'instagram');
    expect(result).toEqual({
      ok: false,
      error: 'Authentication required. Please log in.',
      status: 401,
    });
    // the owner can still finish the flow after signing in
    expect(store.rows.has(hash)).toBe(true);
    expect(store.tables).toEqual([]);
  });

  it('MCP flow: a session of another user is rejected (403) and the owner state survives', async () => {
    const { resolveOAuthCallbackAuth } = await import('@/lib/oauth-connect');
    const store = makeStore();
    const { state, hash } = await storedState(store, { userId: 'attacker-user' });
    const request = await webRequest(state, 'victim-cookie-not-the-state-nonce');
    const result = await resolveOAuthCallbackAuth(
      request,
      state,
      'victim-session-user',
      () => store as never,
      'instagram'
    );
    expect(result).toEqual({ ok: false, error: 'Invalid or expired OAuth state.', status: 403 });
    expect(store.rows.has(hash)).toBe(true);
    // the real owner, signed in, still completes the flow
    const ownerResult = await resolveOAuthCallbackAuth(
      await webRequest(state, null),
      state,
      'attacker-user',
      () => store as never,
      'instagram'
    );
    expect(ownerResult).toMatchObject({ ok: true, userId: 'attacker-user' });
  });

  it('MCP flow: state from another provider is rejected (403) and consumed', async () => {
    const { resolveOAuthCallbackAuth, hashOAuthState } = await import('@/lib/oauth-connect');
    const store = makeStore();
    const { state, hash } = await storedState(store, { provider: 'instagram' });
    const request = await webRequest(state, null);
    const result = await resolveOAuthCallbackAuth(request, state, 'api-key-owner', () => store as never, 'youtube');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    // single-use: the state was consumed even though it was rejected
    expect(store.rows.has(hash)).toBe(false);
    expect(hashOAuthState(state)).toBe(hash);
  });

  it('MCP flow: stored nonce different from the state nonce is rejected (403)', async () => {
    const { resolveOAuthCallbackAuth, storeOAuthState } = await import('@/lib/oauth-connect');
    const { createOAuthState } = await import('@/lib/oauth-utils');
    const store = makeStore();
    const { state } = createOAuthState({ provider: 'instagram', redirectUri: REDIRECT });
    // the state carries nonce X, but the (tampered) store says the nonce is Y
    await storeOAuthState(store as never, {
      state,
      userId: 'api-key-owner',
      provider: 'instagram',
      nonce: 'tampered-nonce',
      redirectUri: REDIRECT,
    });
    const request = await webRequest(state, null);
    const result = await resolveOAuthCallbackAuth(request, state, 'api-key-owner', () => store as never, 'instagram');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toMatch(/mismatch/i);
    }
  });

  it('MCP flow: unknown state returns 403', async () => {
    const { resolveOAuthCallbackAuth } = await import('@/lib/oauth-connect');
    const { createOAuthState } = await import('@/lib/oauth-utils');
    const { state } = createOAuthState({ provider: 'instagram', redirectUri: REDIRECT });
    const request = await webRequest(state, null);
    const result = await resolveOAuthCallbackAuth(request, state, 'session-user', () => makeStore() as never, 'instagram');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it('MCP flow: store read error fails closed (403, no throw)', async () => {
    const { resolveOAuthCallbackAuth } = await import('@/lib/oauth-connect');
    const { createOAuthState } = await import('@/lib/oauth-utils');
    const { state } = createOAuthState({ provider: 'instagram', redirectUri: REDIRECT });
    const request = await webRequest(state, null);
    const brokenStore = {
      from: () => {
        throw new Error('db down');
      },
    };
    const result = await resolveOAuthCallbackAuth(
      request,
      state,
      'session-user',
      () => brokenStore as never,
      'instagram'
    );
    expect(result).toEqual({
      ok: false,
      error: 'Invalid or expired OAuth state.',
      status: 403,
    });
  });

  it('MCP flow: store read error is logged with the detail', async () => {
    const { resolveOAuthCallbackAuth } = await import('@/lib/oauth-connect');
    const { logger } = await import('@/lib/logger');
    const { createOAuthState } = await import('@/lib/oauth-utils');
    const { state } = createOAuthState({ provider: 'instagram', redirectUri: REDIRECT });
    const request = await webRequest(state, null);
    const brokenStore = {
      from: () => {
        throw new Error('db down');
      },
    };
    await resolveOAuthCallbackAuth(
      request,
      state,
      'session-user',
      () => brokenStore as never,
      'instagram'
    );
    const errorCalls = vi.mocked(logger.error).mock.calls;
    const storeErrorCall = errorCalls.find(
      (call) => typeof call[0] === 'string' && /store error/i.test(call[0])
    );
    expect(storeErrorCall).toBeDefined();
    if (!storeErrorCall) return;
    expect((storeErrorCall[1] as Error).message).toBe('db down');
    expect(storeErrorCall[2]).toEqual(expect.objectContaining({ provider: 'instagram' }));
  });

  it('invalid state returns 400', async () => {
    const { resolveOAuthCallbackAuth } = await import('@/lib/oauth-connect');
    const request = await webRequest('x', null);
    const result = await resolveOAuthCallbackAuth(request, 'not-a-state', null, () => makeStore() as never, 'instagram');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});

describe('oauth-connect logging', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('oauthStateRef is a 12-char hex prefix of the state hash', async () => {
    const { oauthStateRef, hashOAuthState } = await import('@/lib/oauth-connect');
    const ref = oauthStateRef('some-raw-state');
    expect(ref).toMatch(/^[0-9a-f]{12}$/);
    expect(ref).toBe(hashOAuthState('some-raw-state').slice(0, 12));
    expect(ref).not.toContain('some-raw-state');
  });

  it('storeOAuthState logs the issuance with provider, userId and state reference', async () => {
    const { storeOAuthState, oauthStateRef } = await import('@/lib/oauth-connect');
    const { logger } = await import('@/lib/logger');
    const store = makeStore();
    await storeOAuthState(store as never, {
      state: 'raw-state-log-1',
      userId: 'user-9',
      provider: 'instagram',
      nonce: 'nonce-9',
      redirectUri: REDIRECT,
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('stored'),
      expect.objectContaining({
        provider: 'instagram',
        userId: 'user-9',
        stateRef: oauthStateRef('raw-state-log-1'),
      })
    );
  });

  it('storeOAuthState surfaces the underlying database error detail', async () => {
    const { storeOAuthState } = await import('@/lib/oauth-connect');
    const brokenStore = {
      from: () => ({
        insert: async () => ({
          error: { message: 'relation "oauth_states" does not exist', code: '42P01' },
        }),
      }),
    };
    await expect(
      storeOAuthState(brokenStore as never, {
        state: 's',
        userId: 'u',
        provider: 'instagram',
        nonce: 'n',
        redirectUri: REDIRECT,
      })
    ).rejects.toThrow(/relation "oauth_states" does not exist/);
  });

  it('consumeOAuthState logs the consumption with provider and userId', async () => {
    const { storeOAuthState, consumeOAuthState } = await import('@/lib/oauth-connect');
    const { logger } = await import('@/lib/logger');
    const store = makeStore();
    await storeOAuthState(store as never, {
      state: 'raw-state-log-2',
      userId: 'user-2',
      provider: 'youtube',
      nonce: 'n2',
      redirectUri: REDIRECT,
    });
    vi.clearAllMocks();
    await consumeOAuthState(store as never, 'raw-state-log-2', 'user-2');
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('consumed'),
      expect.objectContaining({ provider: 'youtube', userId: 'user-2' })
    );
  });

  it('consumeOAuthState logs expired states distinctly from unknown states', async () => {
    const { storeOAuthState, consumeOAuthState, oauthStateRef } = await import(
      '@/lib/oauth-connect'
    );
    const { logger } = await import('@/lib/logger');
    const store = makeStore();
    await storeOAuthState(store as never, {
      state: 'raw-state-exp-log',
      userId: 'user-3',
      provider: 'linkedin',
      nonce: 'n3',
      redirectUri: REDIRECT,
      expiresInSeconds: -10,
    });
    vi.clearAllMocks();
    expect(await consumeOAuthState(store as never, 'raw-state-exp-log', 'user-3')).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/expired/i),
      expect.objectContaining({ stateRef: oauthStateRef('raw-state-exp-log') })
    );
  });

  it('consumeOAuthState logs unknown states distinctly', async () => {
    const { consumeOAuthState, oauthStateRef } = await import('@/lib/oauth-connect');
    const { logger } = await import('@/lib/logger');
    expect(await consumeOAuthState(makeStore() as never, 'never-stored-state', 'user-1')).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/unknown/i),
      expect.objectContaining({ stateRef: oauthStateRef('never-stored-state') })
    );
  });

  it('consumeOAuthState logs the database error detail when the conditional delete fails', async () => {
    const { consumeOAuthState, oauthStateRef } = await import('@/lib/oauth-connect');
    const { logger } = await import('@/lib/logger');
    // Atomic DELETE fails with a database error: this must not be misreported
    // as "unknown or expired state".
    const failingStore = {
      from: () => ({
        delete: () => ({
          eq: () => ({
            eq: () => ({
              gt: () => ({
                select: async () => ({
                  data: null,
                  error: { code: 'PGRST301', message: 'jwt expired' },
                }),
              }),
            }),
          }),
        }),
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    };
    expect(await consumeOAuthState(failingStore as never, 'db-error-state', 'user-1')).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/state consumption failed/i),
      expect.any(Error),
      expect.objectContaining({
        stateRef: oauthStateRef('db-error-state'),
        dbCode: 'PGRST301',
      })
    );
    // The raw state never appears in the logs.
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('db-error-state');
  });

  it('resolveOAuthCallbackAuth logs the web flow branch', async () => {
    const { resolveOAuthCallbackAuth } = await import('@/lib/oauth-connect');
    const { createOAuthState } = await import('@/lib/oauth-utils');
    const { logger } = await import('@/lib/logger');
    const { NextRequest } = await import('next/server');
    const { state, nonce } = createOAuthState({ provider: 'instagram', redirectUri: REDIRECT });
    const request = new NextRequest(
      'https://post-engineer.com/api/instagram-auth/callback',
      { headers: { cookie: `oauth_state_nonce=${nonce}` } }
    );
    const result = await resolveOAuthCallbackAuth(
      request,
      state,
      'session-user',
      () => makeStore() as never,
      'instagram'
    );
    expect(result.ok).toBe(true);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('web'),
      expect.objectContaining({ provider: 'instagram' })
    );
  });

  it('resolveOAuthCallbackAuth logs the MCP fallback branch', async () => {
    const { resolveOAuthCallbackAuth, storeOAuthState } = await import('@/lib/oauth-connect');
    const { createOAuthState } = await import('@/lib/oauth-utils');
    const { logger } = await import('@/lib/logger');
    const { NextRequest } = await import('next/server');
    const store = makeStore();
    const { state, nonce } = createOAuthState({ provider: 'instagram', redirectUri: REDIRECT });
    await storeOAuthState(store as never, {
      state,
      userId: 'api-key-owner',
      provider: 'instagram',
      nonce,
      redirectUri: REDIRECT,
    });
    vi.clearAllMocks();
    const request = new NextRequest('https://post-engineer.com/api/instagram-auth/callback');
    const result = await resolveOAuthCallbackAuth(
      request,
      state,
      'api-key-owner',
      () => store as never,
      'instagram'
    );
    expect(result.ok).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('MCP'),
      expect.objectContaining({ userId: 'api-key-owner' })
    );
  });

  it('resolveOAuthCallbackAuth logs auth failures with the reason', async () => {
    const { resolveOAuthCallbackAuth } = await import('@/lib/oauth-connect');
    const { logger } = await import('@/lib/logger');
    const { NextRequest } = await import('next/server');
    const request = new NextRequest('https://post-engineer.com/api/instagram-auth/callback');
    const result = await resolveOAuthCallbackAuth(
      request,
      'not-a-state',
      null,
      () => makeStore() as never,
      'instagram'
    );
    expect(result.ok).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/invalid/i),
      expect.objectContaining({ provider: 'instagram' })
    );
  });
});

//---------------
// Fanvue PKCE — the code verifier must survive from /start (or from the
// connect-url store) to the callback, in both flows. The shared
// test/oauth-state-store fake carries the code_verifier column (migration
// 057), so the round-trips below use it.
//---------------

describe('oauth-connect — fanvue PKCE', () => {
  const FANVUE_REDIRECT = 'https://post-engineer.com/api/fanvue-auth/callback';

  it('buildOAuthConnectUrl for Fanvue returns the auth URL plus the PKCE verifier', async () => {
    vi.stubEnv('FANVUE_CLIENT_ID', 'fan-app-id');
    vi.stubEnv('FANVUE_CLIENT_SECRET', 'fan-app-secret');
    const { createHash } = await import('node:crypto');
    const { buildOAuthConnectUrl } = await import('@/lib/oauth-connect');
    const { decodeOAuthState } = await import('@/lib/oauth-utils');
    const result = await buildOAuthConnectUrl('fanvue', FANVUE_REDIRECT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const url = new URL(result.authUrl);
      expect(`${url.origin}${url.pathname}`).toBe('https://auth.fanvue.com/oauth2/auth');
      expect(url.searchParams.get('client_id')).toBe('fan-app-id');
      expect(url.searchParams.get('redirect_uri')).toBe(FANVUE_REDIRECT);
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('state')).toBe(result.state);
      expect(result.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
      // The challenge in the URL is the S256 of the returned verifier.
      // False positive: this hashes the PKCE code verifier (a random
      // 43-char string) to assert the RFC 7636 S256 challenge, not a
      // password. SHA-256 is the mandated hash here.
      expect(url.searchParams.get('code_challenge')).toBe(
        // codeql[js/insufficient-password-hash]
        createHash('sha256').update(result.codeVerifier as string, 'utf8').digest('base64url'),
      );
      expect(decodeOAuthState(result.state)).toMatchObject({ provider: 'fanvue', redirectUri: FANVUE_REDIRECT });
    }
    vi.unstubAllEnvs();
  });

  it('buildOAuthConnectUrl for Fanvue fails without Fanvue credentials', async () => {
    vi.stubEnv('FANVUE_CLIENT_ID', undefined);
    vi.stubEnv('FANVUE_CLIENT_SECRET', undefined);
    const { buildOAuthConnectUrl } = await import('@/lib/oauth-connect');
    const result = await buildOAuthConnectUrl('fanvue', FANVUE_REDIRECT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('FANVUE_CLIENT_ID');
    vi.unstubAllEnvs();
  });

  it('storeOAuthState + consumeOAuthState round-trips the Fanvue code verifier', async () => {
    const { storeOAuthState, consumeOAuthState } = await import('@/lib/oauth-connect');
    const store = makeStore();
    await storeOAuthState(store as never, {
      state: 'raw-state-fan',
      userId: 'user-1',
      provider: 'fanvue',
      nonce: 'nonce-fan',
      redirectUri: FANVUE_REDIRECT,
      codeVerifier: 'verifier-fan-1',
    });
    const consumed = await consumeOAuthState(store as never, 'raw-state-fan', 'user-1');
    expect(consumed).toMatchObject({
      userId: 'user-1',
      provider: 'fanvue',
      nonce: 'nonce-fan',
      redirectUri: FANVUE_REDIRECT,
      codeVerifier: 'verifier-fan-1',
    });
    // Single-use: the verifier is gone with the row.
    expect(await consumeOAuthState(store as never, 'raw-state-fan', 'user-1')).toBeNull();
  });

  it('consumeOAuthState returns no verifier for a state stored without one', async () => {
    const { storeOAuthState, consumeOAuthState } = await import('@/lib/oauth-connect');
    const store = makeStore();
    await storeOAuthState(store as never, {
      state: 'raw-state-pin',
      userId: 'user-1',
      provider: 'pinterest',
      nonce: 'nonce-pin',
      redirectUri: 'https://post-engineer.com/api/pinterest-auth/callback',
    });
    const consumed = await consumeOAuthState(store as never, 'raw-state-pin', 'user-1');
    expect(consumed).toMatchObject({ provider: 'pinterest' });
    expect(consumed?.codeVerifier).toBeUndefined();
  });

  it('resolveOAuthCallbackAuth web flow returns the Fanvue verifier from its cookie', async () => {
    const { createOAuthState } = await import('@/lib/oauth-utils');
    const { NextRequest } = await import('next/server');
    const { resolveOAuthCallbackAuth } = await import('@/lib/oauth-connect');
    const { state, nonce } = createOAuthState({ provider: 'fanvue', redirectUri: FANVUE_REDIRECT });
    const request = new NextRequest(FANVUE_REDIRECT, {
      headers: { cookie: `oauth_state_nonce=${nonce}; fanvue_code_verifier=verifier-cookie-1` },
    });
    const resolved = await resolveOAuthCallbackAuth(request, state, 'user-1', () => {
      throw new Error('web flow must not touch the store');
    }, 'fanvue');
    expect(resolved).toEqual({
      ok: true,
      userId: 'user-1',
      viaMcp: false,
      redirectUri: FANVUE_REDIRECT,
      codeVerifier: 'verifier-cookie-1',
    });
  });

  it('resolveOAuthCallbackAuth MCP flow returns the Fanvue verifier from the stored state', async () => {
    const { storeOAuthState, resolveOAuthCallbackAuth } = await import('@/lib/oauth-connect');
    const { createOAuthState } = await import('@/lib/oauth-utils');
    const { NextRequest } = await import('next/server');
    const store = makeStore();
    const { state, nonce } = createOAuthState({ provider: 'fanvue', redirectUri: FANVUE_REDIRECT });
    // The verifier the start stored: the nonce cookie is absent here
    // (API-key flow), so the stored row is the only source.
    await storeOAuthState(store as never, {
      state,
      userId: 'api-key-owner',
      provider: 'fanvue',
      nonce,
      redirectUri: FANVUE_REDIRECT,
      codeVerifier: 'verifier-stored-1',
    });
    const request = new NextRequest(FANVUE_REDIRECT);
    const resolved = await resolveOAuthCallbackAuth(request, state, 'api-key-owner', () => store as never, 'fanvue');
    expect(resolved).toEqual({
      ok: true,
      userId: 'api-key-owner',
      viaMcp: true,
      redirectUri: FANVUE_REDIRECT,
      codeVerifier: 'verifier-stored-1',
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    generateLogId: vi.fn(() => 'test-log-id'),
  },
}));

interface OAuthStateRow {
  state_hash: string;
  user_id: string;
  provider: string;
  nonce: string;
  redirect_uri: string;
  expires_at: string;
}

// Minimal supabase fake for the oauth_states table.
// Implements the chain used by the atomic consume:
//   delete().eq('state_hash', h).gt('expires_at', now).select(...)
// and the best-effort cleanup:
//   delete().eq('state_hash', h).lte('expires_at', now)
function makeStore(rows: Map<string, OAuthStateRow> = new Map()) {
  return {
    rows,
    from() {
      return {
        insert: async (row: Record<string, string>) => {
          rows.set(row.state_hash, row as unknown as OAuthStateRow);
          return { error: null };
        },
        // diagnostic read used on consume miss: was the state expired or unknown?
        select: (_cols: string) => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: async () => {
              const row = rows.get(val);
              return {
                data: row ? { expires_at: row.expires_at } : null,
                error: null,
              };
            },
          }),
        }),
        delete: () => ({
          eq: (_col: string, val: string) => ({
            // DELETE ... WHERE expires_at > now RETURNING ... (atomic)
            gt: (_c2: string, nowIso: string) => ({
              select: async (_cols: string) => {
                const row = rows.get(val);
                if (row && row.expires_at > nowIso) {
                  rows.delete(val);
                  return { data: [row], error: null };
                }
                return { data: [], error: null };
              },
            }),
            // best-effort cleanup of expired rows
            lte: (_c2: string, nowIso: string) => {
              const row = rows.get(val);
              if (row && row.expires_at <= nowIso) rows.delete(val);
              return Promise.resolve({ error: null });
            },
          }),
        }),
      };
    },
  };
}

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
    const consumed = await consumeOAuthState(store as never, 'raw-state-abc');
    expect(consumed).toMatchObject({
      userId: 'user-1',
      provider: 'instagram',
      nonce: 'nonce-1',
      redirectUri: REDIRECT,
    });
    // single-use: second read returns null (row was deleted on consumption)
    expect(await consumeOAuthState(store as never, 'raw-state-abc')).toBeNull();
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
    expect(await consumeOAuthState(store as never, 'raw-state-exp')).toBeNull();
    // expired is not returned, but the row is cleaned (best-effort)
    expect(store.rows.has(hashOAuthState('raw-state-exp'))).toBe(false);
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
              // atomic consumption: DELETE ... WHERE expires_at > now RETURNING ...
              gt: (_c2: string, _nowIso: string) => ({
                select: async (_cols: string) => {
                  calls.push('select-after-delete');
                  return { data: [], error: null };
                },
              }),
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
    await consumeOAuthState(fake as never, 'whatever');
    // the consumption itself never reads first: single conditional DELETE;
    // on a miss exactly one diagnostic SELECT follows, and with no expired
    // row there is no cleanup DELETE.
    expect(calls).toEqual(['delete', 'select-after-delete', 'diagnostic-select']);
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

  it('MCP flow: no cookie, consumes the stored state and returns the API key owner userId', async () => {
    const { resolveOAuthCallbackAuth } = await import('@/lib/oauth-connect');
    const store = makeStore();
    const { state } = await storedState(store);
    const request = await webRequest(state, null);
    const result = await resolveOAuthCallbackAuth(request, state, null, () => store as never, 'instagram');
    expect(result).toEqual({
      ok: true,
      userId: 'api-key-owner',
      viaMcp: true,
      redirectUri: REDIRECT,
    });
  });

  it('MCP flow: state from another provider is rejected (403) and consumed', async () => {
    const { resolveOAuthCallbackAuth, hashOAuthState } = await import('@/lib/oauth-connect');
    const store = makeStore();
    const { state, hash } = await storedState(store, { provider: 'instagram' });
    const request = await webRequest(state, null);
    const result = await resolveOAuthCallbackAuth(request, state, null, () => store as never, 'youtube');
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
      nonce: 'nonce-adulterado',
      redirectUri: REDIRECT,
    });
    const request = await webRequest(state, null);
    const result = await resolveOAuthCallbackAuth(request, state, null, () => store as never, 'instagram');
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
    const result = await resolveOAuthCallbackAuth(request, state, null, () => makeStore() as never, 'instagram');
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
    await consumeOAuthState(store as never, 'raw-state-log-2');
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
    expect(await consumeOAuthState(store as never, 'raw-state-exp-log')).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/expired/i),
      expect.objectContaining({ stateRef: oauthStateRef('raw-state-exp-log') })
    );
  });

  it('consumeOAuthState logs unknown states distinctly', async () => {
    const { consumeOAuthState, oauthStateRef } = await import('@/lib/oauth-connect');
    const { logger } = await import('@/lib/logger');
    expect(await consumeOAuthState(makeStore() as never, 'never-stored-state')).toBeNull();
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
            gt: () => ({
              select: async () => ({
                data: null,
                error: { code: 'PGRST301', message: 'jwt expired' },
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
    expect(await consumeOAuthState(failingStore as never, 'db-error-state')).toBeNull();
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
      null,
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

import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import {
  createOAuthState,
  decodeOAuthState,
  verifyOAuthNonce,
} from './oauth-utils';

//---------------
// oauth-connect — helpers for the "connect via MCP/API key" flow.
//
// The traditional /start requires a browser session (httpOnly cookie for the nonce).
// When the flow is initiated via API key (MCP server), there is no browser: the
// state is stored server-side in the oauth_states table and the callback
// consumes it as a fallback when the cookie does not exist.
//---------------

export const OAUTH_CONNECT_PROVIDERS = ['youtube', 'instagram', 'linkedin'] as const;
export type OAuthConnectProvider = (typeof OAUTH_CONNECT_PROVIDERS)[number];

export function isOAuthConnectProvider(value: unknown): value is OAuthConnectProvider {
  return (
    typeof value === 'string' &&
    (OAUTH_CONNECT_PROVIDERS as readonly string[]).includes(value)
  );
}

export interface StoredOAuthState {
  userId: string;
  provider: string;
  nonce: string;
  redirectUri: string;
}

const OAUTH_STATE_TTL_SECONDS = 15 * 60;

export function hashOAuthState(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex');
}

//---------------
// oauthStateRef — short, non-secret correlation id for a state value.
// The raw state must never hit the logs; this 12-char hash prefix lets us
// trace one OAuth flow (connect-url issuance -> callback) across log lines.
//---------------
export function oauthStateRef(state: string): string {
  return hashOAuthState(state).slice(0, 12);
}

export async function storeOAuthState(
  supabase: SupabaseClient,
  input: {
    state: string;
    userId: string;
    provider: string;
    nonce: string;
    redirectUri: string;
    expiresInSeconds?: number;
  }
): Promise<void> {
  const ttl = input.expiresInSeconds ?? OAUTH_STATE_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const { error } = await supabase.from('oauth_states').insert({
    state_hash: hashOAuthState(input.state),
    user_id: input.userId,
    provider: input.provider,
    nonce: input.nonce,
    redirect_uri: input.redirectUri,
    expires_at: expiresAt,
  });
  if (error) {
    // The message stays server-side (the route maps it to a stable error
    // code), so include the underlying database detail for debugging.
    throw new Error(
      `Failed to store OAuth state (code=${error.code ?? 'unknown'}): ${error.message}`
    );
  }
  logger.info('[oauth-connect] state stored', {
    provider: input.provider,
    userId: input.userId,
    stateRef: oauthStateRef(input.state),
    ttlSeconds: ttl,
  });
}

// Atomic single-use: a single DELETE with an expiry condition.
// The row is only returned (and removed) if it exists AND is not expired —
// two concurrent callbacks can never consume the same state,
// because Postgres executes the DELETE as an atomic operation.
export async function consumeOAuthState(
  supabase: SupabaseClient,
  state: string
): Promise<StoredOAuthState | null> {
  const stateHash = hashOAuthState(state);
  const stateRef = stateHash.slice(0, 12);
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('oauth_states')
    .delete()
    .eq('state_hash', stateHash)
    .gt('expires_at', nowIso)
    .select('state_hash,user_id,provider,nonce,redirect_uri');
  if (!error && data && data.length > 0) {
    const row = data[0];
    logger.info('[oauth-connect] state consumed', {
      provider: row.provider,
      userId: row.user_id,
      stateRef,
    });
    return {
      userId: row.user_id,
      provider: row.provider,
      nonce: row.nonce,
      redirectUri: row.redirect_uri,
    };
  }
  if (error) {
    // A database failure is not a miss: report it distinctly so an expired or
    // unknown state is never blamed for a storage outage.
    logger.error(
      '[oauth-connect] state consumption failed',
      new Error(`Supabase error ${error.code ?? 'unknown'}: ${error.message}`),
      { stateRef, dbCode: error.code }
    );
    return null;
  }
  // Miss path only: distinguish "the state existed but expired" from
  // "unknown or already-consumed state" — the single most useful answer
  // when a user authorizes and no account appears.
  let expiredAt: string | undefined;
  try {
    const { data: existing } = await supabase
      .from('oauth_states')
      .select('expires_at')
      .eq('state_hash', stateHash)
      .maybeSingle();
    expiredAt = existing?.expires_at;
  } catch {
    expiredAt = undefined;
  }
  if (expiredAt) {
    logger.warn('[oauth-connect] state expired', { stateRef, expiredAt });
    // Best-effort cleanup of the expired row (not critical).
    try {
      await supabase
        .from('oauth_states')
        .delete()
        .eq('state_hash', stateHash)
        .lte('expires_at', nowIso);
    } catch {
      // ignore: the expiry already denied the consumption above
    }
  } else {
    logger.warn('[oauth-connect] unknown or already-consumed state', { stateRef });
  }
  return null;
}

export type BuildOAuthConnectUrlResult =
  | { ok: true; authUrl: string; state: string; nonce: string }
  | { ok: false; error: string };

// Generates the OAuth auth URL for a provider, without depending on a session.
// Reuses the builders already used by the web app /start routes.
export async function buildOAuthConnectUrl(
  provider: OAuthConnectProvider,
  redirectUri: string
): Promise<BuildOAuthConnectUrlResult> {
  if (!isOAuthConnectProvider(provider)) {
    return { ok: false, error: `Unsupported provider: ${String(provider)}.` };
  }
  try {
    if (provider === 'instagram') {
      if (!process.env.INSTAGRAM_CLIENT_ID || !process.env.INSTAGRAM_CLIENT_SECRET) {
        return {
          ok: false,
          error:
            'Instagram credentials are not configured (INSTAGRAM_CLIENT_ID / INSTAGRAM_CLIENT_SECRET).',
        };
      }
      const { InstagramService } = await import('./instagram');
      const { state, nonce } = createOAuthState({ provider: 'instagram', redirectUri });
      const authUrl = new InstagramService(redirectUri).getAuthorizationUrl(state);
      return { ok: true, authUrl, state, nonce };
    }
    if (provider === 'youtube') {
      const { createGoogleOAuth2Client, generateGoogleAuthUrl } = await import('./youtube');
      const { state, nonce } = createOAuthState({ provider: 'youtube', redirectUri });
      const oauth2Client = await createGoogleOAuth2Client(redirectUri);
      const authUrl = generateGoogleAuthUrl(oauth2Client, state);
      return { ok: true, authUrl, state, nonce };
    }
    // linkedin
    if (!process.env.LINKEDIN_CLIENT_ID || !process.env.LINKEDIN_CLIENT_SECRET) {
      return {
        ok: false,
        error:
          'LinkedIn credentials are not configured (LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET).',
      };
    }
    const { buildLinkedInAuthorizationUrl } = await import('./linkedin');
    const { state, nonce } = createOAuthState({ provider: 'linkedin', redirectUri });
    const authUrl = buildLinkedInAuthorizationUrl(state, redirectUri);
    return { ok: true, authUrl, state, nonce };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    return { ok: false, error: message };
  }
}

export type ResolveOAuthCallbackAuthResult =
  | { ok: true; userId: string; viaMcp: boolean; redirectUri?: string }
  | { ok: false; error: string; status: number };

// Resolves who is completing the OAuth in the callback.
// 1st: traditional web flow (httpOnly nonce cookie + session).
// 2nd: fallback for the flow initiated via API key (state stored in oauth_states).
// The store is only built (getStore) if the fallback is needed.
// expectedProvider binds the callback to the provider: an Instagram state
// is never accepted in the YouTube callback (and vice-versa), in both flows.
export async function resolveOAuthCallbackAuth(
  request: NextRequest,
  rawState: string | null,
  sessionUserId: string | null,
  getStore: () => SupabaseClient,
  expectedProvider: OAuthConnectProvider
): Promise<ResolveOAuthCallbackAuthResult> {
  const stateRef = rawState ? oauthStateRef(rawState) : 'none';
  const payload = decodeOAuthState(rawState);
  if (!payload) {
    logger.warn('[oauth-connect] invalid state encoding', {
      provider: expectedProvider,
      stateRef,
    });
    return { ok: false, error: 'Invalid OAuth state.', status: 400 };
  }

  if (verifyOAuthNonce(request, payload)) {
    if (payload.provider !== expectedProvider) {
      logger.warn('[oauth-connect] web flow provider mismatch', {
        provider: payload.provider,
        expectedProvider,
        stateRef,
      });
      return { ok: false, error: 'OAuth state provider mismatch.', status: 403 };
    }
    if (!sessionUserId) {
      logger.warn('[oauth-connect] web flow without session', {
        provider: expectedProvider,
        stateRef,
      });
      return { ok: false, error: 'Authentication required. Please log in.', status: 401 };
    }
    logger.debug('[oauth-connect] web flow auth ok', {
      provider: expectedProvider,
      stateRef,
    });
    return { ok: true, userId: sessionUserId, viaMcp: false, redirectUri: payload.redirectUri };
  }

  // MCP fallback: the state was created via API key and stored server-side.
  // Fail closed: any store read error becomes "invalid state"
  // instead of crashing the callback — the fallback must never break the web flow.
  logger.debug('[oauth-connect] trying MCP fallback', {
    provider: expectedProvider,
    stateRef,
  });
  let stored: StoredOAuthState | null = null;
  if (rawState) {
    try {
      stored = await consumeOAuthState(getStore(), rawState);
    } catch (err) {
      // A thrown store failure (e.g. network) must be visible in the logs:
      // otherwise a failed authorization looks identical to an invalid state.
      logger.error(
        '[oauth-connect] MCP fallback store error',
        err instanceof Error ? err : new Error(String(err)),
        { provider: expectedProvider, stateRef }
      );
      stored = null;
    }
  }
  if (!stored) {
    logger.warn('[oauth-connect] MCP fallback failed: no stored state', {
      provider: expectedProvider,
      stateRef,
    });
    return { ok: false, error: 'Invalid or expired OAuth state.', status: 403 };
  }
  // Binds to this callback provider and to the stored nonce (not the payload,
  // which is client-controlled). The redirectUri used in the code exchange comes
  // from the store (server-side), never from the decoded state.
  if (stored.provider !== expectedProvider || stored.nonce !== payload.nonce) {
    logger.warn('[oauth-connect] MCP fallback mismatch', {
      provider: stored.provider,
      expectedProvider,
      stateRef,
    });
    return { ok: false, error: 'OAuth state mismatch.', status: 403 };
  }
  logger.info('[oauth-connect] MCP flow auth ok', {
    provider: expectedProvider,
    userId: stored.userId,
    stateRef,
  });
  return { ok: true, userId: stored.userId, viaMcp: true, redirectUri: stored.redirectUri };
}

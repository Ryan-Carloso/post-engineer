import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import {
  createOAuthState,
  decodeOAuthState,
  getFanvueCodeVerifier,
  verifyOAuthNonce,
} from './oauth-utils';

import { OAUTH_CONNECT_PROVIDERS, isOAuthConnectProvider, type OAuthConnectProvider } from '@/lib/contracts/providers';

export { OAUTH_CONNECT_PROVIDERS, isOAuthConnectProvider, type OAuthConnectProvider };

export interface StoredOAuthState {
  userId: string;
  provider: string;
  nonce: string;
  redirectUri: string;
  codeVerifier?: string;
}

const OAUTH_STATE_TTL_SECONDS = 15 * 60;

export function hashOAuthState(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex');
}

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
    codeVerifier?: string;
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
    ...(input.codeVerifier !== undefined ? { code_verifier: input.codeVerifier } : {}),
  });
  if (error) {
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

export async function consumeOAuthState(
  supabase: SupabaseClient,
  state: string,
  ownerUserId: string
): Promise<StoredOAuthState | null> {
  const stateHash = hashOAuthState(state);
  const stateRef = stateHash.slice(0, 12);
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('oauth_states')
    .delete()
    .eq('state_hash', stateHash)
    .eq('user_id', ownerUserId)
    .gt('expires_at', nowIso)
    .select('state_hash,user_id,provider,nonce,redirect_uri,code_verifier');
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
      ...(typeof row.code_verifier === 'string' && row.code_verifier !== ''
        ? { codeVerifier: row.code_verifier }
        : {}),
    };
  }
  if (error) {
    logger.error(
      '[oauth-connect] state consumption failed',
      new Error(`Supabase error ${error.code ?? 'unknown'}: ${error.message}`),
      { stateRef, dbCode: error.code }
    );
    return null;
  }
  let expiredAt: string | undefined;
  let ownedByAnotherUser = false;
  try {
    const { data: existing } = await supabase
      .from('oauth_states')
      .select('expires_at,user_id')
      .eq('state_hash', stateHash)
      .maybeSingle();
    if (existing !== null && existing !== undefined) {
      ownedByAnotherUser = existing.user_id !== ownerUserId;
      expiredAt = existing.expires_at;
    }
  } catch {
    expiredAt = undefined;
  }
  if (ownedByAnotherUser) {
    logger.warn('[oauth-connect] state belongs to another user', { stateRef });
    return null;
  }
  if (expiredAt) {
    logger.warn('[oauth-connect] state expired', { stateRef, expiredAt });
    try {
      await supabase
        .from('oauth_states')
        .delete()
        .eq('state_hash', stateHash)
        .lte('expires_at', nowIso);
    } catch {
    }
  } else {
    logger.warn('[oauth-connect] unknown or already-consumed state', { stateRef });
  }
  return null;
}

export type BuildOAuthConnectUrlResult =
  | { ok: true; authUrl: string; state: string; nonce: string; codeVerifier?: string }
  | { ok: false; error: string };

type OAuthConnectUrlBuilder = (redirectUri: string) => Promise<BuildOAuthConnectUrlResult>;

const OAUTH_CONNECT_URL_BUILDERS: Record<OAuthConnectProvider, OAuthConnectUrlBuilder> = {
  instagram: async (redirectUri) => {
    if (!process.env.INSTAGRAM_CLIENT_ID || !process.env.INSTAGRAM_CLIENT_SECRET) {
      return {
        ok: false,
        error: 'Instagram credentials are not configured (INSTAGRAM_CLIENT_ID / INSTAGRAM_CLIENT_SECRET).',
      };
    }
    const { InstagramService } = await import('./instagram');
    const { state, nonce } = createOAuthState({ provider: 'instagram', redirectUri });
    const authUrl = new InstagramService(redirectUri).getAuthorizationUrl(state);
    return { ok: true, authUrl, state, nonce };
  },
  youtube: async (redirectUri) => {
    const { createGoogleOAuth2Client, generateGoogleAuthUrl } = await import('./youtube');
    const { state, nonce } = createOAuthState({ provider: 'youtube', redirectUri });
    const oauth2Client = await createGoogleOAuth2Client(redirectUri);
    const authUrl = generateGoogleAuthUrl(oauth2Client, state);
    return { ok: true, authUrl, state, nonce };
  },
  linkedin: async (redirectUri) => {
    if (!process.env.LINKEDIN_CLIENT_ID || !process.env.LINKEDIN_CLIENT_SECRET) {
      return {
        ok: false,
        error: 'LinkedIn credentials are not configured (LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET).',
      };
    }
    const { buildLinkedInAuthorizationUrl } = await import('./linkedin');
    const { state, nonce } = createOAuthState({ provider: 'linkedin', redirectUri });
    const authUrl = buildLinkedInAuthorizationUrl(state, redirectUri);
    return { ok: true, authUrl, state, nonce };
  },
  threads: async (redirectUri) => {
    if (!process.env.THREADS_CLIENT_ID || !process.env.THREADS_CLIENT_SECRET) {
      return {
        ok: false,
        error: 'Threads credentials are not configured (THREADS_CLIENT_ID / THREADS_CLIENT_SECRET).',
      };
    }
    const { buildThreadsAuthorizationUrl } = await import('./threads');
    const { state, nonce } = createOAuthState({ provider: 'threads', redirectUri });
    const authUrl = buildThreadsAuthorizationUrl(state, redirectUri);
    return { ok: true, authUrl, state, nonce };
  },
  facebook: async (redirectUri) => {
    if (!process.env.FACEBOOK_CLIENT_ID || !process.env.FACEBOOK_CLIENT_SECRET) {
      return {
        ok: false,
        error: 'Facebook credentials are not configured (FACEBOOK_CLIENT_ID / FACEBOOK_CLIENT_SECRET).',
      };
    }
    const { buildFacebookAuthorizationUrl } = await import('./facebook');
    const { state, nonce } = createOAuthState({ provider: 'facebook', redirectUri });
    const authUrl = buildFacebookAuthorizationUrl(state, redirectUri);
    return { ok: true, authUrl, state, nonce };
  },
  pinterest: async (redirectUri) => {
    if (!process.env.PINTEREST_CLIENT_ID || !process.env.PINTEREST_CLIENT_SECRET) {
      return {
        ok: false,
        error: 'Pinterest credentials are not configured (PINTEREST_CLIENT_ID / PINTEREST_CLIENT_SECRET).',
      };
    }
    const { buildPinterestAuthorizationUrl } = await import('./pinterest');
    const { state, nonce } = createOAuthState({ provider: 'pinterest', redirectUri });
    const authUrl = buildPinterestAuthorizationUrl(state, redirectUri);
    return { ok: true, authUrl, state, nonce };
  },
  fanvue: async (redirectUri) => {
    if (!process.env.FANVUE_CLIENT_ID || !process.env.FANVUE_CLIENT_SECRET) {
      return {
        ok: false,
        error: 'Fanvue credentials are not configured (FANVUE_CLIENT_ID / FANVUE_CLIENT_SECRET).',
      };
    }
    const { buildFanvueAuthUrl } = await import('./fanvue');
    const { state, nonce } = createOAuthState({ provider: 'fanvue', redirectUri });
    const { authUrl, codeVerifier } = buildFanvueAuthUrl(state, redirectUri);
    return { ok: true, authUrl, state, nonce, codeVerifier };
  },
};

export async function buildOAuthConnectUrl(
  provider: OAuthConnectProvider,
  redirectUri: string
): Promise<BuildOAuthConnectUrlResult> {
  if (!isOAuthConnectProvider(provider)) {
    return { ok: false, error: `Unsupported provider: ${String(provider)}.` };
  }
  try {
    return await OAUTH_CONNECT_URL_BUILDERS[provider](redirectUri);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    return { ok: false, error: message };
  }
}

export type ResolveOAuthCallbackAuthResult =
  | { ok: true; userId: string; viaMcp: boolean; redirectUri?: string; codeVerifier?: string }
  | { ok: false; error: string; status: number };

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
    const codeVerifier =
      expectedProvider === 'fanvue' ? (getFanvueCodeVerifier(request) ?? undefined) : undefined;
    return {
      ok: true,
      userId: sessionUserId,
      viaMcp: false,
      redirectUri: payload.redirectUri,
      ...(codeVerifier !== undefined ? { codeVerifier } : {}),
    };
  }

  if (sessionUserId === null) {
    logger.warn('[oauth-connect] MCP fallback without session', {
      provider: expectedProvider,
      stateRef,
    });
    return { ok: false, error: 'Authentication required. Please log in.', status: 401 };
  }
  logger.debug('[oauth-connect] trying MCP fallback', {
    provider: expectedProvider,
    stateRef,
  });
  let stored: StoredOAuthState | null = null;
  if (rawState) {
    try {
      stored = await consumeOAuthState(getStore(), rawState, sessionUserId);
    } catch (err) {
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
    userId: sessionUserId,
    stateRef,
  });
  return {
    ok: true,
    userId: sessionUserId,
    viaMcp: true,
    redirectUri: stored.redirectUri,
    ...(stored.codeVerifier !== undefined ? { codeVerifier: stored.codeVerifier } : {}),
  };
}

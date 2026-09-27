import { NextRequest } from 'next/server';
import {
  upsertSocialAccount,
  touchSocialAccount,
} from '@/lib/social-accounts';
import { oauthPopupResponse } from '@/lib/oauth-utils';
import { resolveOAuthCallbackAuth, oauthStateRef } from '@/lib/oauth-connect';
import { logger } from '@/lib/logger';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

//---------------
// getSessionUserId — session user_id or null
//---------------
async function getSessionUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return user.id;
}

//---------------
// GET /api/instagram-auth/callback — exchanges code for a long-lived token, encrypts
// and persists in Supabase as provider 'instagram' (direct Instagram Login).
//
// CRITICAL: ALWAYS returns the popup HTML (oauthPopupResponse). If it returns
// anything else (JSON, default Next.js error), the popup never receives
// postMessage and gets stuck.
//---------------
export async function GET(request: NextRequest) {
  const logId = logger.generateLogId();
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');
  const state = searchParams.get('state');
  // Correlation id only: the raw state (and code) must never hit the logs.
  const stateRef = state ? oauthStateRef(state) : 'none';
  logger.info('[instagram-callback] received', {
    logId,
    stateRef,
    hasCode: !!code,
    hasState: !!state,
    hasError: !!error,
  });

  // Direct error from Instagram (e.g.: user denied permissions)
  if (error) {
    logger.warn('[instagram-callback] provider error', {
      logId,
      stateRef,
      error,
      errorDescription,
    });
    return oauthPopupResponse('instagram-oauth-error', {
      error: `Instagram OAuth error: ${error}`,
      detail: errorDescription,
    });
  }

  if (!code) {
    logger.warn('[instagram-callback] missing authorization code', { logId, stateRef });
    return oauthPopupResponse('instagram-oauth-error', {
      error: 'Missing authorization code',
    });
  }

  // Step 1+2: callback auth — web flow (session + httpOnly nonce cookie)
  // or MCP fallback (state stored server-side via POST /api/account/connect-url).
  const callbackAuth = await resolveOAuthCallbackAuth(
    request,
    state,
    await getSessionUserId(),
    () => createSupabaseServiceClient(),
    'instagram'
  );
  if (!callbackAuth.ok) {
    logger.warn('[instagram-callback] auth failed', {
      logId,
      stateRef,
      status: callbackAuth.status,
      error: callbackAuth.error,
    });
    return oauthPopupResponse('instagram-oauth-error', { error: callbackAuth.error });
  }
  const userId = callbackAuth.userId;
  logger.info('[instagram-callback] auth ok', {
    logId,
    stateRef,
    viaMcp: callbackAuth.viaMcp,
    userId,
  });


  // Step 3: import InstagramService
  let InstagramService: typeof import('@/lib/instagram').InstagramService;
  try {
    const mod = await import('@/lib/instagram');
    InstagramService = mod.InstagramService;
  } catch (importErr) {
    const err = importErr instanceof Error ? importErr : new Error(String(importErr));
    logger.error('[instagram-callback] module import failed', err, { logId, stateRef });
    return oauthPopupResponse('instagram-oauth-error', {
      error: `Failed to import Instagram module: ${err.message}`,
    });
  }

  // Step 4: create instance (validates env vars). The redirect_uri used in the
  // code exchange MUST be exactly the one registered in the Meta Developer Dashboard —
  // any other value makes Instagram reject the exchange (the vague "Unsupported
  // request - method type: get"). Fail closed here instead of leaving
  // the vague error.
  // The redirectUri comes from the resolver (#45): in the MCP flow it is the stored
  // server-side value, never the one from the client state; the equality guard is from #46.
  const allowedRedirectUris = [
    process.env.INSTAGRAM_REDIRECT_URI,
    process.env.INSTAGRAM_REDIRECT_URI_LOCAL,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);
  const effectiveRedirectUri =
    callbackAuth.redirectUri ?? process.env.INSTAGRAM_REDIRECT_URI;
  if (!effectiveRedirectUri || !allowedRedirectUris.includes(effectiveRedirectUri)) {
    logger.warn('[instagram-callback] redirect URI mismatch', {
      logId,
      stateRef,
      viaMcp: callbackAuth.viaMcp,
      effectiveRedirectUri,
    });
    return oauthPopupResponse('instagram-oauth-error', {
      error:
        'OAuth redirect URI mismatch: the callback URI does not match the value registered in the Meta Developer Dashboard.',
    });
  }

  let instagram: InstanceType<typeof InstagramService>;
  try {
    instagram = new InstagramService(effectiveRedirectUri);
  } catch (constructErr) {
    const err = constructErr instanceof Error ? constructErr : new Error(String(constructErr));
    logger.error('[instagram-callback] service construction failed', err, { logId, stateRef });
    return oauthPopupResponse('instagram-oauth-error', {
      error: `Instagram credentials not configured: ${err.message}`,
    });
  }

  // Step 5: exchange code for long-lived token
  let token: { accessToken: string; expiresIn: number; tokenType: string };
  logger.debug('[instagram-callback] exchanging code for token', {
    logId,
    stateRef,
    viaMcp: callbackAuth.viaMcp,
  });
  try {
    token = await instagram.exchangeCodeForLongLivedToken(code);
  } catch (tokenErr) {
    const err = tokenErr instanceof Error ? tokenErr : new Error(String(tokenErr));
    logger.error('[instagram-callback] token exchange failed', err, { logId, stateRef });
    const msg = err.message;
    return oauthPopupResponse('instagram-oauth-error', {
      error: `Failed to obtain Instagram token: ${msg}`,
    });
  }

  // Step 6: fetch profile
  let profile: Awaited<ReturnType<typeof instagram.getProfile>>;
  try {
    profile = await instagram.getProfile(token.accessToken);
    logger.info('[instagram-callback] profile fetched', {
      logId,
      stateRef,
      igUserId: profile.userdId,
      username: profile.username,
    });
  } catch (profileErr) {
    const err = profileErr instanceof Error ? profileErr : new Error(String(profileErr));
    logger.error('[instagram-callback] profile fetch failed', err, { logId, stateRef });
    const msg = err.message;
    return oauthPopupResponse('instagram-oauth-error', {
      error: `Failed to fetch Instagram profile: ${msg}`,
    });
  }

  // Step 7: persist in Supabase.
  // MCP (no browser session): the session client would have no valid RLS,
  // so it persists with service role — the owner is the userId resolved from the state.
  // Web: persists with the session client (RLS as the user).
  const tokenExpiresAt = new Date(Date.now() + token.expiresIn * 1000);

  try {
    const supabase = callbackAuth.viaMcp
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();

    await upsertSocialAccount(supabase, {
      userId,
      provider: 'instagram',
      providerAccountId: profile.userdId,
      accountName: profile.username,
      accountMetadata: {
        username: profile.username,
        name: profile.name,
        profilePictureUrl: profile.profilePictureUrl,
        followersCount: profile.followersCount,
        mediaCount: profile.mediaCount,
      },
      tokens: {
        access_token: token.accessToken,
        token_type: token.tokenType,
        expiry_date: tokenExpiresAt.getTime(),
      },
      tokenExpiresAt,
    });

    await touchSocialAccount(supabase, userId, 'instagram', profile.userdId);
    logger.info('[instagram-callback] account persisted', {
      logId,
      stateRef,
      viaMcp: callbackAuth.viaMcp,
      userId,
      igUserId: profile.userdId,
      username: profile.username,
    });
  } catch (dbErr) {
    const err = dbErr instanceof Error ? dbErr : new Error(String(dbErr));
    logger.error('[instagram-callback] database save failed', err, {
      logId,
      stateRef,
      userId,
      igUserId: profile.userdId,
      username: profile.username,
    });
    const msg = err.message;
    return oauthPopupResponse('instagram-oauth-error', {
      error: `Failed to save account to database: ${msg}`,
    });
  }

  // Step 8: success — returns public data
  logger.info('[instagram-callback] success', {
    logId,
    stateRef,
    igUserId: profile.userdId,
    username: profile.username,
  });
  return oauthPopupResponse('instagram-oauth-success', {
    account: {
      igUserId: profile.userdId,
      username: profile.username,
      name: profile.name,
      profilePictureUrl: profile.profilePictureUrl,
      followersCount: profile.followersCount,
      mediaCount: profile.mediaCount,
      provider: 'instagram',
      connectedAt: Date.now(),
      lastUsed: Date.now(),
    },
  });
}

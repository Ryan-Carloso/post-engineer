import { NextRequest } from 'next/server';
import {
  upsertSocialAccount,
  touchSocialAccount,
} from '@/lib/social-accounts';
import { oauthPopupResponse } from '@/lib/oauth-utils';
import { resolveOAuthCallbackAuth, oauthStateRef } from '@/lib/oauth-connect';
import { logger } from '@/lib/logger';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { sessionUserId } from '@/lib/oauth/session-user';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { reportProfileFetched, reportProfileFetchFailed } from '@/lib/account-profile-telemetry';
import { INSTAGRAM_USERNAME_FALLBACK } from '@/lib/providers/registry';

async function getHandler(request: NextRequest) {
  const logId = logger.generateLogId();
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');
  const state = searchParams.get('state');
  const stateRef = state ? oauthStateRef(state) : 'none';
  logger.info('[instagram-callback] received', {
    logId,
    stateRef,
    hasCode: !!code,
    hasState: !!state,
    hasError: !!error,
  });

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
    return oauthPopupResponse('instagram-oauth-error', {
      error: 'Missing authorization code',
    });
  }

  const callbackAuth = await resolveOAuthCallbackAuth(
    request,
    state,
    await sessionUserId(),
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

  let profile: Awaited<ReturnType<typeof instagram.getProfile>>;
  try {
    profile = await instagram.getProfile(token.accessToken);
    reportProfileFetched('instagram', 'connect', {
      accountName: profile.username === INSTAGRAM_USERNAME_FALLBACK ? null : profile.username,
      pictureUrl: profile.profilePictureUrl ?? null,
    });
    logger.info('[instagram-callback] profile fetched', {
      logId,
      stateRef,
      igUserId: profile.userdId,
      username: profile.username,
    });
  } catch (profileErr) {
    const err = profileErr instanceof Error ? profileErr : new Error(String(profileErr));
    logger.error('[instagram-callback] profile fetch failed', err, { logId, stateRef });
    reportProfileFetchFailed('instagram', 'connect', err);
    const msg = err.message;
    return oauthPopupResponse('instagram-oauth-error', {
      error: `Failed to fetch Instagram profile: ${msg}`,
    });
  }

  const tokenExpiresAt = new Date(Date.now() + token.expiresIn * 1000);

  try {
    const supabase = await createSupabaseServerClient();

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
        profileSyncedAt: new Date().toISOString(),
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

export const GET = withApiErrorReporting('GET /api/instagram-auth/callback', getHandler);

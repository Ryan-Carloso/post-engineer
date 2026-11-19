import { NextRequest } from 'next/server';
import { oauthPopupResponse } from '@/lib/oauth-utils';
import { resolveOAuthCallbackAuth } from '@/lib/oauth-connect';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/logger';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { reportProfileFetched, reportProfileFetchFailed } from '@/lib/account-profile-telemetry';

async function getSessionUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) return null;
  return user.id;
}

async function getHandler(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (searchParams.get('error')) {
    return oauthPopupResponse('fanvue-oauth-error', { error: 'Fanvue authorization was not completed.' });
  }
  if (!code) {
    return oauthPopupResponse('fanvue-oauth-error', { error: 'Missing authorization code' });
  }

  const callbackAuth = await resolveOAuthCallbackAuth(
    request,
    state,
    await getSessionUserId(),
    () => createSupabaseServiceClient(),
    'fanvue'
  );
  if (!callbackAuth.ok) {
    return oauthPopupResponse('fanvue-oauth-error', { error: callbackAuth.error });
  }

  const codeVerifier = callbackAuth.codeVerifier;
  if (codeVerifier === undefined || codeVerifier === '') {
    logger.error('[fanvue-auth/callback] PKCE code verifier missing for this flow');
    return oauthPopupResponse('fanvue-oauth-error', { error: 'Fanvue authorization could not be completed. Please try connecting again.' });
  }

  try {
    const { exchangeFanvueCode, fetchFanvueProfile } = await import('@/lib/fanvue');
    const token = await exchangeFanvueCode(code, codeVerifier, callbackAuth.redirectUri);
    const profile = await fetchFanvueProfile(token.access_token);
    const accountName = profile.displayName ?? profile.username;
    reportProfileFetched('fanvue', 'connect', {
      accountName,
      pictureUrl: profile.avatarUrl,
    });

    const tokenExpiresAt = new Date(Date.now() + token.expires_in * 1000);
    const supabase = await createSupabaseServerClient();
    const { upsertSocialAccount } = await import('@/lib/social-accounts');

    await upsertSocialAccount(supabase, {
      userId: callbackAuth.userId,
      provider: 'fanvue',
      providerAccountId: profile.uuid,
      accountName,
      accountMetadata: {
        name: accountName,
        username: profile.username ?? undefined,
        profilePictureUrl: profile.avatarUrl ?? undefined,
        isCreator: profile.isCreator,
        profileSyncedAt: new Date().toISOString(),
      },
      tokens: {
        access_token: token.access_token,
        refresh_token: token.refresh_token ?? undefined,
        token_type: token.token_type,
        expiry_date: tokenExpiresAt.getTime(),
      },
      tokenExpiresAt,
    });

    return oauthPopupResponse('fanvue-oauth-success', {
      account: {
        providerAccountId: profile.uuid,
        accountName,
        provider: 'fanvue',
        connectedAt: Date.now(),
        lastUsed: Date.now(),
      },
    });
  } catch (connectError) {
    reportProfileFetchFailed('fanvue', 'connect', connectError);
    logger.error('[fanvue-auth/callback] connect failed', connectError);
    return oauthPopupResponse('fanvue-oauth-error', { error: 'Failed to connect the Fanvue account.' });
  }
}

export const GET = withApiErrorReporting('GET /api/fanvue-auth/callback', getHandler);

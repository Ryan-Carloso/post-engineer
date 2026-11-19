import { NextRequest } from 'next/server';
import { oauthPopupResponse } from '@/lib/oauth-utils';
import { resolveOAuthCallbackAuth } from '@/lib/oauth-connect';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/logger';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { reportProfileFetched } from '@/lib/account-profile-telemetry';

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
    return oauthPopupResponse('threads-oauth-error', { error: 'Threads authorization was not completed.' });
  }
  if (!code) {
    return oauthPopupResponse('threads-oauth-error', { error: 'Missing authorization code' });
  }

  const callbackAuth = await resolveOAuthCallbackAuth(
    request,
    state,
    await getSessionUserId(),
    () => createSupabaseServiceClient(),
    'threads'
  );
  if (!callbackAuth.ok) {
    return oauthPopupResponse('threads-oauth-error', { error: callbackAuth.error });
  }

  try {
    const { exchangeThreadsCodeForToken, fetchThreadsProfile } = await import('@/lib/threads');
    const token = await exchangeThreadsCodeForToken(code, callbackAuth.redirectUri);
    const profile = await fetchThreadsProfile(token.access_token);
    reportProfileFetched('threads', 'connect', {
      accountName: profile.username,
      pictureUrl: profile.profilePictureUrl,
    });
    const tokenExpiresAt = new Date(Date.now() + token.expires_in * 1000);

    const supabase = await createSupabaseServerClient();
    const { upsertSocialAccount } = await import('@/lib/social-accounts');

    await upsertSocialAccount(supabase, {
      userId: callbackAuth.userId,
      provider: 'threads',
      providerAccountId: profile.id,
      accountName: profile.username,
      accountMetadata: {
        profilePictureUrl: profile.profilePictureUrl,
        profileSyncedAt: new Date().toISOString(),
      },
      tokens: {
        access_token: token.access_token,
        token_type: 'bearer',
        expiry_date: tokenExpiresAt.getTime(),
      },
      tokenExpiresAt,
    });

    return oauthPopupResponse('threads-oauth-success', {
      account: {
        providerAccountId: profile.id,
        accountName: profile.username,
        provider: 'threads',
        connectedAt: Date.now(),
        lastUsed: Date.now(),
      },
    });
  } catch (connectError) {
    logger.error('[threads-auth/callback] connect failed', connectError);
    return oauthPopupResponse('threads-oauth-error', { error: 'Failed to connect the Threads account.' });
  }
}

export const GET = withApiErrorReporting('GET /api/threads-auth/callback', getHandler);

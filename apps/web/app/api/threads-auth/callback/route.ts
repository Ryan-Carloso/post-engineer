import { NextRequest } from 'next/server';
import { oauthPopupResponse } from '@/lib/oauth-utils';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { readSocialCallback } from '@/lib/oauth/social-callback';
import { logger } from '@/lib/logger';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { reportProfileFetched } from '@/lib/account-profile-telemetry';

async function getHandler(request: NextRequest) {
  const callbackAuth = await readSocialCallback(request, 'threads', 'Threads authorization was not completed.');
  if (!callbackAuth.ok) {
    return oauthPopupResponse('threads-oauth-error', { error: callbackAuth.error });
  }
  const code = callbackAuth.code;

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

import { NextRequest } from 'next/server';
import { oauthPopupResponse } from '@/lib/oauth-utils';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { readSocialCallback } from '@/lib/oauth/social-callback';
import { logger } from '@/lib/logger';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { reportProfileFetched, reportProfileFetchFailed } from '@/lib/account-profile-telemetry';

async function getHandler(request: NextRequest) {
  const callbackAuth = await readSocialCallback(request, 'pinterest', 'Pinterest authorization was not completed.');
  if (!callbackAuth.ok) {
    return oauthPopupResponse('pinterest-oauth-error', { error: callbackAuth.error });
  }
  const code = callbackAuth.code;

  try {
    const { exchangePinterestCodeForToken, fetchPinterestUserProfile } = await import('@/lib/pinterest');
    const token = await exchangePinterestCodeForToken(code, callbackAuth.redirectUri);
    const profile = await fetchPinterestUserProfile(token.access_token);
    reportProfileFetched('pinterest', 'connect', {
      accountName: profile.username,
      pictureUrl: profile.profileImage,
    });

    const tokenExpiresAt = new Date(Date.now() + token.expires_in * 1000);
    const supabase = await createSupabaseServerClient();
    const { upsertSocialAccount } = await import('@/lib/social-accounts');

    await upsertSocialAccount(supabase, {
      userId: callbackAuth.userId,
      provider: 'pinterest',
      providerAccountId: profile.id,
      accountName: profile.username,
      accountMetadata: {
        name: profile.username,
        profilePictureUrl: profile.profileImage ?? undefined,
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

    return oauthPopupResponse('pinterest-oauth-success', {
      account: {
        providerAccountId: profile.id,
        accountName: profile.username,
        provider: 'pinterest',
        connectedAt: Date.now(),
        lastUsed: Date.now(),
      },
    });
  } catch (connectError) {
    reportProfileFetchFailed('pinterest', 'connect', connectError);
    logger.error('[pinterest-auth/callback] connect failed', connectError);
    return oauthPopupResponse('pinterest-oauth-error', { error: 'Failed to connect the Pinterest account.' });
  }
}

export const GET = withApiErrorReporting('GET /api/pinterest-auth/callback', getHandler);

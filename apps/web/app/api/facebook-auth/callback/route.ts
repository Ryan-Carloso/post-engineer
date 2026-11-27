import { NextRequest } from 'next/server';
import { oauthPopupResponse } from '@/lib/oauth-utils';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { readSocialCallback } from '@/lib/oauth/social-callback';
import { logger } from '@/lib/logger';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { reportProfileFetched, reportProfileFetchFailed } from '@/lib/account-profile-telemetry';

async function getHandler(request: NextRequest) {
  const callbackAuth = await readSocialCallback(request, 'facebook', 'Facebook authorization was not completed.');
  if (!callbackAuth.ok) {
    return oauthPopupResponse('facebook-oauth-error', { error: callbackAuth.error });
  }
  const code = callbackAuth.code;

  try {
    const { exchangeFacebookCodeForToken, fetchFacebookPages } = await import('@/lib/facebook');
    const userAccessToken = await exchangeFacebookCodeForToken(code, callbackAuth.redirectUri);
    const pages = await fetchFacebookPages(userAccessToken);
    if (pages.length === 0) {
      return oauthPopupResponse('facebook-oauth-error', {
        error: 'No Facebook Pages were found for this account. Create or manage a Page and try again.',
      });
    }
    const supabase = await createSupabaseServerClient();
    const { upsertSocialAccount } = await import('@/lib/social-accounts');

    for (const page of pages) {
      reportProfileFetched('facebook', 'connect', {
        accountName: page.name,
        pictureUrl: page.pictureUrl,
      });
      await upsertSocialAccount(supabase, {
        userId: callbackAuth.userId,
        provider: 'facebook',
        providerAccountId: page.id,
        accountName: page.name,
        accountMetadata: {
          name: page.name,
          category: page.category,
          profilePictureUrl: page.pictureUrl,
          followersCount: page.followersCount ?? undefined,
          profileSyncedAt: new Date().toISOString(),
        },
        tokens: {
          access_token: page.pageAccessToken,
          token_type: 'bearer',
        },
        tokenExpiresAt: null,
      });
    }

    return oauthPopupResponse('facebook-oauth-success', {
      account: {
        pages: pages.map((page) => ({
          providerAccountId: page.id,
          accountName: page.name,
        })),
        provider: 'facebook',
        connectedAt: Date.now(),
        lastUsed: Date.now(),
      },
    });
  } catch (connectError) {
    reportProfileFetchFailed('facebook', 'connect', connectError);
    logger.error('[facebook-auth/callback] connect failed', connectError);
    return oauthPopupResponse('facebook-oauth-error', { error: 'Failed to connect the Facebook Page.' });
  }
}

export const GET = withApiErrorReporting('GET /api/facebook-auth/callback', getHandler);

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
    return oauthPopupResponse('facebook-oauth-error', { error: 'Facebook authorization was not completed.' });
  }
  if (!code) {
    return oauthPopupResponse('facebook-oauth-error', { error: 'Missing authorization code' });
  }

  const callbackAuth = await resolveOAuthCallbackAuth(
    request,
    state,
    await getSessionUserId(),
    () => createSupabaseServiceClient(),
    'facebook'
  );
  if (!callbackAuth.ok) {
    return oauthPopupResponse('facebook-oauth-error', { error: callbackAuth.error });
  }

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

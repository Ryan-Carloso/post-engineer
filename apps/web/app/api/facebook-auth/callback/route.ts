import { NextRequest } from 'next/server';
import { oauthPopupResponse } from '@/lib/oauth-utils';
import { resolveOAuthCallbackAuth } from '@/lib/oauth-connect';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/logger';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { reportProfileFetched, reportProfileFetchFailed } from '@/lib/account-profile-telemetry';

//---------------
// getSessionUserId — session user_id or null
//---------------
async function getSessionUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  // Single-line destructuring: the API naming lint only exempts
  // destructured names on one line, and `data` here is the Supabase
  // SDK shape, not a contract field we chose.
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) return null;
  return user.id;
}

//---------------
// GET /api/facebook-auth/callback — exchanges the code for a long-lived
// user token, lists the Pages the user manages and persists EACH Page as
// its own provider='facebook' account with its Page token. The user token
// is never stored, and a Page token derived from it carries no expiry, so
// the account stores no expiry date.
// ALWAYS returns the popup HTML (oauthPopupResponse). The client gets
// generic errors; the details stay in the server logs.
//---------------
async function getHandler(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  // Direct error from Facebook (e.g.: user denied permissions)
  if (searchParams.get('error')) {
    return oauthPopupResponse('facebook-oauth-error', { error: 'Facebook authorization was not completed.' });
  }
  if (!code) {
    return oauthPopupResponse('facebook-oauth-error', { error: 'Missing authorization code' });
  }

  // Callback auth — web flow (session + httpOnly nonce cookie) or MCP fallback
  // (state stored server-side via POST /api/account/connect-url).
  const callbackAuth = await resolveOAuthCallbackAuth(
    request,
    state,
    await getSessionUserId(),
    // Service role only for the server-side oauth_states table; ownership is
    // enforced by the user_id predicate on the consume (session user only).
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
    // Both flows resolve to the signed-in session user (the connect-url
    // fallback only accepts the state owner), so persistence always runs
    // with the session client (RLS as the user), never the service role.
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

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/facebook-auth/callback', getHandler);

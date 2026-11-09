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
// GET /api/pinterest-auth/callback — exchanges the code for an access
// token (30 days) + refresh token (60 days, continuous) and persists the
// account (provider='pinterest', providerAccountId = the v5 user_account
// id) with the encrypted token pair. The profile read is the username
// and profile picture; the boards a pin needs come from
// GET /api/pinterest/boards at schedule time, never from this callback.
// ALWAYS returns the popup HTML (oauthPopupResponse).
//---------------
async function getHandler(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  // Direct error from Pinterest (e.g.: user denied permissions)
  if (searchParams.get('error')) {
    return oauthPopupResponse('pinterest-oauth-error', { error: 'Pinterest authorization was not completed.' });
  }
  if (!code) {
    return oauthPopupResponse('pinterest-oauth-error', { error: 'Missing authorization code' });
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
    'pinterest'
  );
  if (!callbackAuth.ok) {
    return oauthPopupResponse('pinterest-oauth-error', { error: callbackAuth.error });
  }

  try {
    const { exchangePinterestCodeForToken, fetchPinterestUserProfile } = await import('@/lib/pinterest');
    const token = await exchangePinterestCodeForToken(code, callbackAuth.redirectUri);
    const profile = await fetchPinterestUserProfile(token.access_token);
    reportProfileFetched('pinterest', 'connect', {
      accountName: profile.username,
      pictureUrl: profile.profileImage,
    });

    const tokenExpiresAt = new Date(Date.now() + token.expires_in * 1000);
    // Both flows resolve to the signed-in session user (the connect-url
    // fallback only accepts the state owner), so persistence always runs
    // with the session client (RLS as the user), never the service role.
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

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/pinterest-auth/callback', getHandler);

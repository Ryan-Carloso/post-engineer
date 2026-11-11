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
// GET /api/fanvue-auth/callback — exchanges the code for an access
// token (~1 hour) + refresh token and persists the account
// (provider='fanvue', providerAccountId = the /users/me uuid) with the
// encrypted token pair. The profile read is the display name / username
// and avatar; avatar/cover/bio are NOT managed (no endpoints for them).
// The PKCE code verifier comes from the httpOnly cookie (web flow) or
// the stored oauth_states row (MCP flow); without it the code cannot be
// exchanged. ALWAYS returns the popup HTML (oauthPopupResponse).
//---------------
async function getHandler(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  // Direct error from Fanvue (e.g.: user denied permissions)
  if (searchParams.get('error')) {
    return oauthPopupResponse('fanvue-oauth-error', { error: 'Fanvue authorization was not completed.' });
  }
  if (!code) {
    return oauthPopupResponse('fanvue-oauth-error', { error: 'Missing authorization code' });
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
    'fanvue'
  );
  if (!callbackAuth.ok) {
    return oauthPopupResponse('fanvue-oauth-error', { error: callbackAuth.error });
  }

  // The PKCE verifier must have survived from /start (cookie) or from
  // the connect-url store (oauth_states row): without it the token
  // exchange cannot run, so fail as an incomplete authorization rather
  // than exchanging without it.
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
    // Both flows resolve to the signed-in session user (the connect-url
    // fallback only accepts the state owner), so persistence always runs
    // with the session client (RLS as the user), never the service role.
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

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/fanvue-auth/callback', getHandler);

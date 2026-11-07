import { NextRequest } from 'next/server';
import { oauthPopupResponse } from '@/lib/oauth-utils';
import { resolveOAuthCallbackAuth } from '@/lib/oauth-connect';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/logger';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { reportProfileFetched } from '@/lib/account-profile-telemetry';

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
// GET /api/threads-auth/callback — exchanges the code for a long-lived token
// (60d), fetches the profile and persists it as a provider='threads' account.
// ALWAYS returns the popup HTML (oauthPopupResponse). The client gets generic
// errors; the details stay in the server logs.
//---------------
async function getHandler(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  // Direct error from Threads (e.g.: user denied permissions)
  if (searchParams.get('error')) {
    return oauthPopupResponse('threads-oauth-error', { error: 'Threads authorization was not completed.' });
  }
  if (!code) {
    return oauthPopupResponse('threads-oauth-error', { error: 'Missing authorization code' });
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

    // Both flows resolve to the signed-in session user (the connect-url
    // fallback only accepts the state owner), so persistence always runs
    // with the session client (RLS as the user), never the service role.
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

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/threads-auth/callback', getHandler);

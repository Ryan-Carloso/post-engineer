import { NextRequest } from 'next/server';
import {
  upsertSocialAccount,
  touchSocialAccount,
} from '@/lib/social-accounts';
import { oauthPopupResponse } from '@/lib/oauth-utils';
import { resolveOAuthCallbackAuth } from '@/lib/oauth-connect';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/logger';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { reportProfileFetched, reportProfileFetchFailed } from '@/lib/account-profile-telemetry';
import { YOUTUBE_CHANNEL_NAME_FALLBACK } from '@/lib/providers/registry';
import { resetYouTubeRetentionWindows } from '@/lib/metrics/reset-retention';

//---------------
// getSessionUserId — session user_id or null
//---------------
async function getSessionUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return user.id;
}

//---------------
// GET /api/google-oauth/callback — exchanges code for tokens, encrypts
// and persists in Supabase (owner: session user_id).
//---------------
async function getHandler(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const state = searchParams.get('state');

  if (error) {
    return oauthPopupResponse('youtube-oauth-error', { error: `OAuth error: ${error}` });
  }

  if (!code) {
    return oauthPopupResponse('youtube-oauth-error', { error: 'Missing authorization code' });
  }

  // Callback auth — web flow (session + httpOnly nonce cookie)
  // or MCP fallback (state stored server-side via POST /api/account/connect-url).
  const callbackAuth = await resolveOAuthCallbackAuth(
    request,
    state,
    await getSessionUserId(),
    () => createSupabaseServiceClient(),
    'youtube'
  );
  if (!callbackAuth.ok) {
    return oauthPopupResponse('youtube-oauth-error', { error: callbackAuth.error });
  }
  const userId = callbackAuth.userId;
  // redirectUri validated by the resolver (in the MCP flow it comes from the server-side store)

  try {
    const { createGoogleOAuth2Client } = await import('@/lib/youtube');
    const { fetchYouTubeChannel } = await import('@/lib/youtube-channel');

    const oauth2Client = await createGoogleOAuth2Client(callbackAuth.redirectUri);
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // The channel is the account identity: a failed read or a Google
    // account without a channel fails the connect instead of saving a
    // placeholder id/name (two placeholder rows would overwrite each other).
    let channel: Awaited<ReturnType<typeof fetchYouTubeChannel>>;
    try {
      channel = await fetchYouTubeChannel(oauth2Client, { mine: true });
    } catch (channelError) {
      logger.error('[youtube-oauth] channel read failed', channelError);
      reportProfileFetchFailed('youtube', 'connect', channelError);
      return oauthPopupResponse('youtube-oauth-error', {
        error: 'Could not read your YouTube channel. Please try again.',
      });
    }
    if (channel === null) {
      logger.warn('[youtube-oauth] Google account has no YouTube channel', { userId });
      reportProfileFetchFailed('youtube', 'connect', new Error('YOUTUBE_NO_CHANNEL: no channel'));
      return oauthPopupResponse('youtube-oauth-error', {
        error: 'This Google account has no YouTube channel. Create one on YouTube, then connect again.',
      });
    }
    reportProfileFetched('youtube', 'connect', { accountName: channel.title, pictureUrl: channel.thumbnail });

    const channelId = channel.id;
    const channelName = channel.title ?? YOUTUBE_CHANNEL_NAME_FALLBACK;
    const thumbnail = channel.thumbnail ?? undefined;
    const customUrl = channel.customUrl ?? undefined;
    const statistics = channel.statistics ?? undefined;

    // MCP (no browser session): persists with service role, owner = userId
    // resolved from the state. Web: session client (RLS as the user).
    const supabase = callbackAuth.viaMcp
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();

    await upsertSocialAccount(supabase, {
      userId,
      provider: 'youtube',
      providerAccountId: channelId,
      accountName: channelName,
      accountMetadata: {
        thumbnail,
        customUrl,
        statistics,
        profileSyncedAt: new Date().toISOString(),
      },
      tokens: {
        access_token: tokens.access_token || '',
        refresh_token: tokens.refresh_token || '',
        token_type: tokens.token_type || 'Bearer',
        expiry_date: tokens.expiry_date || undefined,
      },
      tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    });

    await touchSocialAccount(supabase, userId, 'youtube', channelId);

    // A token granted before yt-analytics.readonly left those windows
    // marked done. Clearing them lets the hourly metrics job backfill
    // retention while each window is still open.
    await resetYouTubeRetentionWindows(userId, channelId);

    // Returns only public data — tokens NEVER go to the client
    return oauthPopupResponse('youtube-oauth-success', {
      account: {
        channelId,
        channelName,
        thumbnail,
        customUrl,
        statistics,
        provider: 'youtube',
        connectedAt: Date.now(),
        lastUsed: Date.now(),
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[youtube-oauth] callback failed', error);
    return oauthPopupResponse('youtube-oauth-error', { error: errorMessage });
  }
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/google-oauth/callback', getHandler);

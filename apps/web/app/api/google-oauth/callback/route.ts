import { NextRequest } from 'next/server';
import {
  upsertSocialAccount,
  touchSocialAccount,
} from '@/lib/social-accounts';
import { oauthPopupResponse } from '@/lib/oauth-utils';
import { resolveOAuthCallbackAuth } from '@/lib/oauth-connect';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { sessionUserId } from '@/lib/oauth/session-user';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/logger';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { reportProfileFetched, reportProfileFetchFailed } from '@/lib/account-profile-telemetry';
import { YOUTUBE_CHANNEL_NAME_FALLBACK } from '@/lib/providers/registry';
import { resetYouTubeRetentionWindows } from '@/lib/metrics/reset-retention';

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

  const callbackAuth = await resolveOAuthCallbackAuth(
    request,
    state,
    await sessionUserId(),
    () => createSupabaseServiceClient(),
    'youtube'
  );
  if (!callbackAuth.ok) {
    return oauthPopupResponse('youtube-oauth-error', { error: callbackAuth.error });
  }
  const userId = callbackAuth.userId;

  try {
    const { createGoogleOAuth2Client } = await import('@/lib/youtube');
    const { fetchYouTubeChannel } = await import('@/lib/youtube-channel');

    const oauth2Client = await createGoogleOAuth2Client(callbackAuth.redirectUri);
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

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

    const supabase = await createSupabaseServerClient();

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

    await resetYouTubeRetentionWindows(userId, channelId);

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

export const GET = withApiErrorReporting('GET /api/google-oauth/callback', getHandler);

import { NextRequest } from 'next/server';
import {
  upsertSocialAccount,
  touchSocialAccount,
} from '@/lib/social-accounts';
import { oauthPopupResponse } from '@/lib/oauth-utils';
import { resolveOAuthCallbackAuth } from '@/lib/oauth-connect';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

//---------------
//---------------

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
export async function GET(request: NextRequest) {
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
    const { google } = await import('googleapis');

    const oauth2Client = await createGoogleOAuth2Client(callbackAuth.redirectUri);
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Fetches channel info (with fallback to minimal data)
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client } as never);

    let channelId = 'unknown';
    let channelName = 'YouTube Account';
    let thumbnail: string | undefined;
    let customUrl: string | undefined;
    let statistics: Record<string, unknown> | undefined;

    try {
      const response = await youtube.channels.list({
        part: ['snippet', 'statistics'],
        mine: true,
      });

      if (response.data.items && response.data.items.length > 0) {
        const channel = response.data.items[0];
        channelId = channel.id || 'unknown';
        channelName = channel.snippet?.title || 'YouTube Account';
        thumbnail = channel.snippet?.thumbnails?.default?.url || undefined;
        customUrl = channel.snippet?.customUrl || undefined;
        if (channel.statistics) {
          statistics = {
            subscriberCount: channel.statistics.subscriberCount || undefined,
            viewCount: channel.statistics.viewCount || undefined,
            videoCount: channel.statistics.videoCount || undefined,
            hiddenSubscriberCount: channel.statistics.hiddenSubscriberCount || false,
          };
        }
      }
    } catch {
    }

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
    return oauthPopupResponse('youtube-oauth-error', { error: errorMessage });
  }
}

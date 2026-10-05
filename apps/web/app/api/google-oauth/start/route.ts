import { NextRequest, NextResponse } from 'next/server';
import { createGoogleOAuth2Client, generateGoogleAuthUrl } from '@/lib/youtube';
import { logger } from '@/lib/logger';
import { createOAuthState, resolveOAuthRedirectUri, setOAuthNonceCookie } from '@/lib/oauth-utils';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { withApiErrorReporting } from '@/lib/api-error-reporting';

//---------------
// getSessionUser — returns the session's user_id (null when not logged in)
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
// GET /api/google-oauth/start — generates the authorization URL.
// Requires an authenticated user (Supabase session).
//---------------
async function getHandler(request: NextRequest = new NextRequest('https://post-engineer.com/api/google-oauth/start')) {
  const limited = await applyRateLimit(request, RATE_LIMITS.oauthStart);
  if (limited) return limited;

  const logId = logger.generateLogId();

  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required. Please log in.' },
        { status: 401 }
      );
    }

    const redirectUri = resolveOAuthRedirectUri(request, 'GOOGLE_REDIRECT_URI_LOCAL', 'GOOGLE_REDIRECT_URI');
    const oauth2Client = await createGoogleOAuth2Client(redirectUri);
    const { state, nonce } = createOAuthState({
      provider: 'youtube',
      redirectUri,
    });
    const authUrl = generateGoogleAuthUrl(oauth2Client, state);

    const response = {
      success: true,
      message: 'Authorization URL generated',
      auth_url: authUrl,
    };

    const json = NextResponse.json(response);
    setOAuthNonceCookie(json, nonce);
    return json;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error generating authorization URL';
    // Internal details stay in the server logs — the client only gets a
    // stable, generic error.
    logger.logOAuthError(logId, new Error(errorMessage));
    return NextResponse.json(
      { success: false, error: 'Failed to generate the authorization URL.' },
      { status: 500 }
    );
  }
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/google-oauth/start', getHandler);

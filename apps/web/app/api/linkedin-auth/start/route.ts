import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createOAuthState, resolveOAuthRedirectUri, setOAuthNonceCookie } from '@/lib/oauth-utils';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { withApiErrorReporting } from '@/lib/api-error-reporting';

//---------------
// getSessionUserId — returns the session's user_id (null when not logged in)
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
// GET /api/linkedin-auth/start — generates the LinkedIn authorization URL
// (openid + profile + w_member_social scopes). Requires a session.
//---------------
async function getHandler(request: NextRequest = new NextRequest('https://post-engineer.com/api/linkedin-auth/start')) {
  const limited = await applyRateLimit(request, RATE_LIMITS.oauthStart);
  if (limited) return limited;

  const logId = logger.generateLogId();

  try {
    if (!process.env.LINKEDIN_CLIENT_ID || !process.env.LINKEDIN_CLIENT_SECRET) {
      return NextResponse.json(
        {
          success: false,
          error: 'LinkedIn credentials are not configured (LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET).',
        },
        { status: 500 }
      );
    }

    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required. Please log in.' },
        { status: 401 }
      );
    }

    const { buildLinkedInAuthorizationUrl } = await import('@/lib/linkedin');
    const redirectUri = resolveOAuthRedirectUri(request, 'LINKEDIN_REDIRECT_URI_LOCAL', 'LINKEDIN_REDIRECT_URI');
    const { state, nonce } = createOAuthState({ provider: 'linkedin', redirectUri });
    const authUrl = buildLinkedInAuthorizationUrl(state, redirectUri);

    const json = NextResponse.json({
      success: true,
      message: 'Authorization URL generated',
      auth_url: authUrl,
    });
    setOAuthNonceCookie(json, nonce);
    return json;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error generating authorization URL';
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
export const GET = withApiErrorReporting('GET /api/linkedin-auth/start', getHandler);

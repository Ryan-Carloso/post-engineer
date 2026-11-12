import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createOAuthState, resolveOAuthRedirectUri, setOAuthNonceCookie } from '@/lib/oauth-utils';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { markApiErrorReported, withApiErrorReporting } from '@/lib/api-error-reporting';

//---------------
// GET /api/pinterest-auth/start — generates the Pinterest authorization URL
// (boards:read + boards:write + pins:read + pins:write + user_accounts:read).
// Requires a session.
//---------------
async function getHandler(request: NextRequest) {
  const limited = await applyRateLimit(request, RATE_LIMITS.oauthStart);
  if (limited) return limited;

  const logId = logger.generateLogId();

  try {
    if (!process.env.PINTEREST_CLIENT_ID || !process.env.PINTEREST_CLIENT_SECRET) {
      const message = 'Pinterest credentials are not configured (PINTEREST_CLIENT_ID / PINTEREST_CLIENT_SECRET).';
      const response = NextResponse.json({ success: false, error: message }, { status: 500 });
      // The cause would otherwise reach PostHog only as the wrapper's
      // generic "[route] 500" — log the reason here, and mark the response
      // so the wrapper does not report a second synthetic exception.
      logger.logOAuthError(logId, new Error(message));
      markApiErrorReported(response);
      return response;
    }

    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required. Please log in.' },
        { status: 401 }
      );
    }

    const { buildPinterestAuthorizationUrl } = await import('@/lib/pinterest');
    const redirectUri = resolveOAuthRedirectUri(request, 'PINTEREST_REDIRECT_URI_LOCAL', 'PINTEREST_REDIRECT_URI');
    const { state, nonce } = createOAuthState({ provider: 'pinterest', redirectUri });
    const authUrl = buildPinterestAuthorizationUrl(state, redirectUri);

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
export const GET = withApiErrorReporting('GET /api/pinterest-auth/start', getHandler);

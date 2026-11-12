import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createOAuthState, resolveOAuthRedirectUri, setOAuthNonceCookie, setFanvueCodeVerifierCookie } from '@/lib/oauth-utils';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { markApiErrorReported, withApiErrorReporting } from '@/lib/api-error-reporting';

//---------------
// GET /api/fanvue-auth/start — generates the Fanvue authorization URL
// (OAuth 2.0 + PKCE S256; scopes read:self + read:post + write:post +
// read:media + write:media + offline_access).
// Requires a session. The PKCE code verifier is stored in an httpOnly
// cookie (mirroring the nonce cookie) so the callback can present it at
// the token exchange; it is never embedded in the client-visible state.
//---------------
async function getHandler(request: NextRequest) {
  const limited = await applyRateLimit(request, RATE_LIMITS.oauthStart);
  if (limited) return limited;

  const logId = logger.generateLogId();

  try {
    if (!process.env.FANVUE_CLIENT_ID || !process.env.FANVUE_CLIENT_SECRET) {
      const message = 'Fanvue credentials are not configured (FANVUE_CLIENT_ID / FANVUE_CLIENT_SECRET).';
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

    const { buildFanvueAuthUrl } = await import('@/lib/fanvue');
    const redirectUri = resolveOAuthRedirectUri(request, 'FANVUE_REDIRECT_URI_LOCAL', 'FANVUE_REDIRECT_URI');
    const { state, nonce } = createOAuthState({ provider: 'fanvue', redirectUri });
    const { authUrl, codeVerifier } = buildFanvueAuthUrl(state, redirectUri);

    const json = NextResponse.json({
      success: true,
      message: 'Authorization URL generated',
      auth_url: authUrl,
    });
    setOAuthNonceCookie(json, nonce);
    setFanvueCodeVerifierCookie(json, codeVerifier);
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
export const GET = withApiErrorReporting('GET /api/fanvue-auth/start', getHandler);

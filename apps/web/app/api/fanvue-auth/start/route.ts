import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createOAuthState, resolveOAuthRedirectUri, setOAuthNonceCookie, setFanvueCodeVerifierCookie } from '@/lib/oauth-utils';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { markApiErrorReported, withApiErrorReporting } from '@/lib/api-error-reporting';

async function getHandler(request: NextRequest) {
  const limited = await applyRateLimit(request, RATE_LIMITS.oauthStart);
  if (limited) return limited;

  const logId = logger.generateLogId();

  try {
    if (!process.env.FANVUE_CLIENT_ID || !process.env.FANVUE_CLIENT_SECRET) {
      const message = 'Fanvue credentials are not configured (FANVUE_CLIENT_ID / FANVUE_CLIENT_SECRET).';
      const response = NextResponse.json({ success: false, error: message }, { status: 500 });
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
    logger.logOAuthError(logId, new Error(errorMessage));
    const response = NextResponse.json(
      { success: false, error: 'Failed to generate the authorization URL.' },
      { status: 500 }
    );
    markApiErrorReported(response);
    return response;
  }
}

export const GET = withApiErrorReporting('GET /api/fanvue-auth/start', getHandler);

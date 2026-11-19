import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createOAuthState, resolveOAuthRedirectUri, setOAuthNonceCookie } from '@/lib/oauth-utils';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { markApiErrorReported, withApiErrorReporting } from '@/lib/api-error-reporting';

async function getSessionUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return user.id;
}

async function getHandler(request: NextRequest = new NextRequest('https://post-engineer.com/api/linkedin-auth/start')) {
  const limited = await applyRateLimit(request, RATE_LIMITS.oauthStart);
  if (limited) return limited;

  const logId = logger.generateLogId();

  try {
    if (!process.env.LINKEDIN_CLIENT_ID || !process.env.LINKEDIN_CLIENT_SECRET) {
      const message = 'LinkedIn credentials are not configured (LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET).';
      const response = NextResponse.json({ success: false, error: message }, { status: 500 });
      logger.logOAuthError(logId, new Error(message));
      markApiErrorReported(response);
      return response;
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
    logger.logOAuthError(logId, new Error(errorMessage));
    const response = NextResponse.json(
      { success: false, error: 'Failed to generate the authorization URL.' },
      { status: 500 }
    );
    markApiErrorReported(response);
    return response;
  }
}

export const GET = withApiErrorReporting('GET /api/linkedin-auth/start', getHandler);

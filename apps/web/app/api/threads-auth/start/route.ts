import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createOAuthState, resolveOAuthRedirectUri, setOAuthNonceCookie } from '@/lib/oauth-utils';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { markApiErrorReported, withApiErrorReporting } from '@/lib/api-error-reporting';

async function getHandler(request: NextRequest) {
  const limited = await applyRateLimit(request, RATE_LIMITS.oauthStart);
  if (limited) return limited;

  const logId = logger.generateLogId();

  try {
    if (!process.env.THREADS_CLIENT_ID || !process.env.THREADS_CLIENT_SECRET) {
      const message = 'Threads credentials are not configured (THREADS_CLIENT_ID / THREADS_CLIENT_SECRET).';
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

    const { buildThreadsAuthorizationUrl } = await import('@/lib/threads');
    const redirectUri = resolveOAuthRedirectUri(request, 'THREADS_REDIRECT_URI_LOCAL', 'THREADS_REDIRECT_URI');
    const { state, nonce } = createOAuthState({ provider: 'threads', redirectUri });
    const authUrl = buildThreadsAuthorizationUrl(state, redirectUri);

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

export const GET = withApiErrorReporting('GET /api/threads-auth/start', getHandler);

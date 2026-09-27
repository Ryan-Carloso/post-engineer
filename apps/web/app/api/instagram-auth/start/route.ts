import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createOAuthState, resolveOAuthRedirectUri, setOAuthNonceCookie } from '@/lib/oauth-utils';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

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
// GET /api/instagram-auth/start — generates the authorization URL (Instagram Login)
// Requires an authenticated user (Supabase session).
//---------------
export async function GET(request: NextRequest = new NextRequest('https://post-engineer.com/api/instagram-auth/start')) {
  const limited = await applyRateLimit(request, RATE_LIMITS.oauthStart);
  if (limited) return limited;

  const logId = logger.generateLogId();

  try {
    if (!process.env.INSTAGRAM_CLIENT_ID || !process.env.INSTAGRAM_CLIENT_SECRET) {
      return NextResponse.json(
        {
          success: false,
          error: 'Instagram credentials are not configured (INSTAGRAM_CLIENT_ID / INSTAGRAM_CLIENT_SECRET).',
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


    const { InstagramService } = await import('@/lib/instagram');
    const redirectUri = resolveOAuthRedirectUri(request, 'INSTAGRAM_REDIRECT_URI_LOCAL', 'INSTAGRAM_REDIRECT_URI');
    const instagram = new InstagramService(redirectUri);
    const { state, nonce } = createOAuthState({
      provider: 'instagram',
      redirectUri,
    });
    const authUrl = instagram.getAuthorizationUrl(state);

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

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { apiErrorResponse } from '@/lib/api-error';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { resolveOAuthRedirectUri } from '@/lib/oauth-utils';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
  buildOAuthConnectUrl,
  isOAuthConnectProvider,
  storeOAuthState,
  oauthStateRef,
  type OAuthConnectProvider,
} from '@/lib/oauth-connect';
import { withApiErrorReporting } from '@/lib/api-error-reporting';

//---------------
// POST /api/account/connect-url — generates the OAuth auth URL to connect
// a new social account. Built for the MCP flow: authenticates via API key
// (or session), without depending on the browser's httpOnly nonce cookie.
// The state is stored server-side (oauth_states table) and the callback
// consumes it as a fallback. Body: { provider: 'youtube' | 'instagram' | 'linkedin' }.
// Bluesky uses an app password: POST /api/bluesky-connect.
//
// Error contract (agent/MCP-consumed API): failures return
//   { success: false, error: '<stable-code>' }
// with the error class in the HTTP status. The codes are machine-readable
// on purpose — the caller (an AI agent) presents them in the user's
// language, so no English prose is hardcoded here.
// Internal details go to the server-side log, never to the client.
//---------------

export const CONNECT_URL_ERRORS = {
  AUTHENTICATION_REQUIRED: 'authentication_required',
  INVALID_JSON_BODY: 'invalid_json_body',
  BLUESKY_REQUIRES_APP_PASSWORD: 'bluesky_requires_app_password',
  INVALID_PROVIDER: 'invalid_provider',
  REDIRECT_URI_UNAVAILABLE: 'redirect_uri_unavailable',
  PROVIDER_NOT_CONFIGURED: 'provider_not_configured',
  STATE_STORE_FAILED: 'state_store_failed',
  INTERNAL_ERROR: 'internal_error',
} as const;

export type ConnectUrlErrorCode =
  (typeof CONNECT_URL_ERRORS)[keyof typeof CONNECT_URL_ERRORS];

function errorResponse(
  status: number,
  error: ConnectUrlErrorCode,
  route: string,
  cause?: unknown,
): NextResponse {
  // The cause is threaded through apiErrorResponse (which logs it once),
  // never pre-logged here: pre-logging would emit two PostHog events for
  // one failure.
  return apiErrorResponse(status, error, { route, cause });
}

const REDIRECT_ENV: Record<OAuthConnectProvider, [string, string]> = {
  instagram: ['INSTAGRAM_REDIRECT_URI_LOCAL', 'INSTAGRAM_REDIRECT_URI'],
  youtube: ['GOOGLE_REDIRECT_URI_LOCAL', 'GOOGLE_REDIRECT_URI'],
  linkedin: ['LINKEDIN_REDIRECT_URI_LOCAL', 'LINKEDIN_REDIRECT_URI'],
};

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const limited = await applyRateLimit(request, RATE_LIMITS.connectUrl);
  if (limited) return limited;

  const logId = logger.generateLogId();
  try {
    const { auth, error: authError } = await requireSupabaseSession(request);
    if (authError || !auth) {
      return errorResponse(401, CONNECT_URL_ERRORS.AUTHENTICATION_REQUIRED, 'POST /api/account/connect-url');
    }

    let provider: unknown;
    try {
      provider = (await request.json()).provider;
    } catch {
      return errorResponse(400, CONNECT_URL_ERRORS.INVALID_JSON_BODY, 'POST /api/account/connect-url');
    }

    if (provider === 'bluesky') {
      return errorResponse(400, CONNECT_URL_ERRORS.BLUESKY_REQUIRES_APP_PASSWORD, 'POST /api/account/connect-url');
    }
    if (!isOAuthConnectProvider(provider)) {
      return errorResponse(400, CONNECT_URL_ERRORS.INVALID_PROVIDER, 'POST /api/account/connect-url');
    }

    const [localEnv, prodEnv] = REDIRECT_ENV[provider];
    let redirectUri: string;
    try {
      redirectUri = resolveOAuthRedirectUri(request, localEnv, prodEnv);
    } catch (redirectError) {
      return errorResponse(500, CONNECT_URL_ERRORS.REDIRECT_URI_UNAVAILABLE, 'POST /api/account/connect-url', redirectError);
    }

    const built = await buildOAuthConnectUrl(provider, redirectUri);
    if (!built.ok) {
      return errorResponse(
        500,
        CONNECT_URL_ERRORS.PROVIDER_NOT_CONFIGURED,
        'POST /api/account/connect-url',
        new Error(`OAuth connect URL build failed: ${built.error}`),
      );
    }

    const supabase = createSupabaseServiceClient();
    try {
      await storeOAuthState(supabase, {
        state: built.state,
        userId: auth.userId,
        provider,
        nonce: built.nonce,
        redirectUri,
      });
    } catch (storeError) {
      return errorResponse(
        500,
        CONNECT_URL_ERRORS.STATE_STORE_FAILED,
        'POST /api/account/connect-url',
        storeError instanceof Error ? storeError : new Error('Failed to store OAuth state.'),
      );
    }

    // Correlation id for the callback logs: the raw state never leaves
    // the server unhashed.
    logger.info('[oauth-connect] connect URL issued', {
      logId,
      provider,
      userId: auth.userId,
      stateRef: oauthStateRef(built.state),
      viaApiKey: auth.isApiKey === true,
      redirectUri,
    });

    return NextResponse.json({ success: true, auth_url: built.authUrl });
  } catch (error) {
    const cause = error instanceof Error ? error : new Error('Unknown error.');
    return errorResponse(500, CONNECT_URL_ERRORS.INTERNAL_ERROR, 'POST /api/account/connect-url', cause);
  }
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const POST = withApiErrorReporting('POST /api/account/connect-url', postHandler);

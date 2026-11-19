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
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { DIRECT_CONNECT_PROVIDERS, type DirectConnectProvider } from '@/lib/contracts/providers';

export const CONNECT_URL_ERRORS = {
  AUTHENTICATION_REQUIRED: 'authentication_required',
  INVALID_JSON_BODY: 'invalid_json_body',
  BLUESKY_REQUIRES_APP_PASSWORD: 'bluesky_requires_app_password',
  RUMBLE_REQUIRES_ACCESS_TOKEN: 'rumble_requires_access_token',
  TELEGRAM_REQUIRES_BOT_TOKEN: 'telegram_requires_bot_token',
  INVALID_PROVIDER: 'invalid_provider',
  REDIRECT_URI_UNAVAILABLE: 'redirect_uri_unavailable',
  PROVIDER_NOT_CONFIGURED: 'provider_not_configured',
  STATE_STORE_FAILED: 'state_store_failed',
  INTERNAL_ERROR: 'internal_error',
} as const;

export type ConnectUrlErrorCode =
  (typeof CONNECT_URL_ERRORS)[keyof typeof CONNECT_URL_ERRORS];

const DIRECT_CONNECT_ERRORS: Record<DirectConnectProvider, ConnectUrlErrorCode> = {
  bluesky: CONNECT_URL_ERRORS.BLUESKY_REQUIRES_APP_PASSWORD,
  '3speak': CONNECT_URL_ERRORS.INVALID_PROVIDER,
  rumble: CONNECT_URL_ERRORS.RUMBLE_REQUIRES_ACCESS_TOKEN,
  telegram: CONNECT_URL_ERRORS.TELEGRAM_REQUIRES_BOT_TOKEN,
};

function isDirectConnectProvider(value: unknown): value is DirectConnectProvider {
  return typeof value === 'string' && (DIRECT_CONNECT_PROVIDERS as readonly string[]).includes(value);
}

function errorResponse(
  status: number,
  error: ConnectUrlErrorCode,
  route: string,
  cause?: unknown,
): NextResponse {
  return apiErrorResponse(status, error, { route, cause });
}

const REDIRECT_ENV: Record<OAuthConnectProvider, [string, string]> = {
  instagram: ['INSTAGRAM_REDIRECT_URI_LOCAL', 'INSTAGRAM_REDIRECT_URI'],
  youtube: ['GOOGLE_REDIRECT_URI_LOCAL', 'GOOGLE_REDIRECT_URI'],
  linkedin: ['LINKEDIN_REDIRECT_URI_LOCAL', 'LINKEDIN_REDIRECT_URI'],
  threads: ['THREADS_REDIRECT_URI_LOCAL', 'THREADS_REDIRECT_URI'],
  facebook: ['FACEBOOK_REDIRECT_URI_LOCAL', 'FACEBOOK_REDIRECT_URI'],
  pinterest: ['PINTEREST_REDIRECT_URI_LOCAL', 'PINTEREST_REDIRECT_URI'],
  fanvue: ['FANVUE_REDIRECT_URI_LOCAL', 'FANVUE_REDIRECT_URI'],
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

    if (isDirectConnectProvider(provider)) {
      return errorResponse(400, DIRECT_CONNECT_ERRORS[provider], 'POST /api/account/connect-url');
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
        ...(built.codeVerifier !== undefined ? { codeVerifier: built.codeVerifier } : {}),
      });
    } catch (storeError) {
      return errorResponse(
        500,
        CONNECT_URL_ERRORS.STATE_STORE_FAILED,
        'POST /api/account/connect-url',
        storeError instanceof Error ? storeError : new Error('Failed to store OAuth state.'),
      );
    }

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

export const POST = withApiErrorReporting('POST /api/account/connect-url', postHandler, { getUserId: resolveReportingUserId });

import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';
import { logger } from '@/lib/logger';
import { resolveOAuthRedirectUri } from '@/lib/oauth-utils';
import { sessionUserId } from '@/lib/oauth/session-user';
import { applyRateLimit, type RateLimitProfile } from '@/lib/rate-limit';
import { markApiErrorReported } from '@/lib/api-error-reporting';

export interface SocialOAuthApp {
  label: string;
  envPrefix: string;
  sessionBeforeCredentials?: boolean;
}

function missingCredentialsResponse(app: SocialOAuthApp, logId: string): NextResponse | null {
  const idName = `${app.envPrefix}_CLIENT_ID`;
  const secretName = `${app.envPrefix}_CLIENT_SECRET`;
  if (process.env[idName] && process.env[secretName]) return null;
  const message = `${app.label} credentials are not configured (${idName} / ${secretName}).`;
  const response = NextResponse.json({ success: false, error: message }, { status: 500 });
  logger.logOAuthError(logId, new Error(message));
  markApiErrorReported(response);
  return response;
}

export function authorizationUrlResponse(authUrl: string): NextResponse {
  return NextResponse.json({
    success: true,
    message: 'Authorization URL generated',
    auth_url: authUrl,
  });
}

export async function startSocialOAuth(
  request: NextRequest,
  profile: RateLimitProfile,
  app: SocialOAuthApp,
  authorize: (redirectUri: string) => Promise<NextResponse>,
): Promise<NextResponse> {
  const limited = await applyRateLimit(request, profile);
  if (limited) return limited;

  const logId = logger.generateLogId();

  try {
    if (app.sessionBeforeCredentials !== true) {
      const missing = missingCredentialsResponse(app, logId);
      if (missing) return missing;
    }

    if ((await sessionUserId()) === null) {
      return NextResponse.json(
        { success: false, error: 'Authentication required. Please log in.' },
        { status: 401 }
      );
    }

    if (app.sessionBeforeCredentials === true) {
      const missing = missingCredentialsResponse(app, logId);
      if (missing) return missing;
    }

    const redirectUri = resolveOAuthRedirectUri(request, `${app.envPrefix}_REDIRECT_URI_LOCAL`, `${app.envPrefix}_REDIRECT_URI`);
    return await authorize(redirectUri);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error generating authorization URL';
    logger.logOAuthError(logId, new Error(errorMessage));
    const response = NextResponse.json(
      { success: false, error: 'Failed to generate the authorization URL.' },
      { status: 500 }
    );
    markApiErrorReported(response);
    return response;
  }
}

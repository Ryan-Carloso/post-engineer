import { NextRequest } from 'next/server';
import { createOAuthState, setOAuthNonceCookie } from '@/lib/oauth-utils';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { authorizationUrlResponse, startSocialOAuth } from '@/lib/oauth/social-start';

const APP = { label: 'Pinterest', envPrefix: 'PINTEREST' };

async function getHandler(request: NextRequest) {
  return startSocialOAuth(request, RATE_LIMITS.oauthStart, APP, async (redirectUri) => {
    const { buildPinterestAuthorizationUrl } = await import('@/lib/pinterest');
    const { state, nonce } = createOAuthState({ provider: 'pinterest', redirectUri });
    const json = authorizationUrlResponse(buildPinterestAuthorizationUrl(state, redirectUri));
    setOAuthNonceCookie(json, nonce);
    return json;
  });
}

export const GET = withApiErrorReporting('GET /api/pinterest-auth/start', getHandler);

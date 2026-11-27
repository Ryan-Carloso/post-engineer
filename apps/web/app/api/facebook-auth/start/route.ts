import { NextRequest } from 'next/server';
import { createOAuthState, setOAuthNonceCookie } from '@/lib/oauth-utils';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { authorizationUrlResponse, startSocialOAuth } from '@/lib/oauth/social-start';

const APP = { label: 'Facebook', envPrefix: 'FACEBOOK' };

async function getHandler(request: NextRequest) {
  return startSocialOAuth(request, RATE_LIMITS.oauthStart, APP, async (redirectUri) => {
    const { buildFacebookAuthorizationUrl } = await import('@/lib/facebook');
    const { state, nonce } = createOAuthState({ provider: 'facebook', redirectUri });
    const json = authorizationUrlResponse(buildFacebookAuthorizationUrl(state, redirectUri));
    setOAuthNonceCookie(json, nonce);
    return json;
  });
}

export const GET = withApiErrorReporting('GET /api/facebook-auth/start', getHandler);

import { NextRequest } from 'next/server';
import { createOAuthState, setOAuthNonceCookie, setFanvueCodeVerifierCookie } from '@/lib/oauth-utils';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { authorizationUrlResponse, startSocialOAuth } from '@/lib/oauth/social-start';

const APP = { label: 'Fanvue', envPrefix: 'FANVUE' };

async function getHandler(request: NextRequest) {
  return startSocialOAuth(request, RATE_LIMITS.oauthStart, APP, async (redirectUri) => {
    const { buildFanvueAuthUrl } = await import('@/lib/fanvue');
    const { state, nonce } = createOAuthState({ provider: 'fanvue', redirectUri });
    const { authUrl, codeVerifier } = buildFanvueAuthUrl(state, redirectUri);
    const json = authorizationUrlResponse(authUrl);
    setOAuthNonceCookie(json, nonce);
    setFanvueCodeVerifierCookie(json, codeVerifier);
    return json;
  });
}

export const GET = withApiErrorReporting('GET /api/fanvue-auth/start', getHandler);

import { NextRequest } from 'next/server';
import { createOAuthState, setOAuthNonceCookie } from '@/lib/oauth-utils';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { authorizationUrlResponse, startSocialOAuth } from '@/lib/oauth/social-start';

const APP = { label: 'LinkedIn', envPrefix: 'LINKEDIN' };

async function getHandler(request: NextRequest = new NextRequest('https://post-engineer.com/api/linkedin-auth/start')) {
  return startSocialOAuth(request, RATE_LIMITS.oauthStart, APP, async (redirectUri) => {
    const { buildLinkedInAuthorizationUrl } = await import('@/lib/linkedin');
    const { state, nonce } = createOAuthState({ provider: 'linkedin', redirectUri });
    const json = authorizationUrlResponse(buildLinkedInAuthorizationUrl(state, redirectUri));
    setOAuthNonceCookie(json, nonce);
    return json;
  });
}

export const GET = withApiErrorReporting('GET /api/linkedin-auth/start', getHandler);

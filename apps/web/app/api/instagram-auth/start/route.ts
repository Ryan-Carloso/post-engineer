import { NextRequest } from 'next/server';
import { createOAuthState, setOAuthNonceCookie } from '@/lib/oauth-utils';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { authorizationUrlResponse, startSocialOAuth } from '@/lib/oauth/social-start';

const APP = { label: 'Instagram', envPrefix: 'INSTAGRAM' };

async function getHandler(request: NextRequest = new NextRequest('https://post-engineer.com/api/instagram-auth/start')) {
  return startSocialOAuth(request, RATE_LIMITS.oauthStart, APP, async (redirectUri) => {
    const { InstagramService } = await import('@/lib/instagram');
    const instagram = new InstagramService(redirectUri);
    const { state, nonce } = createOAuthState({ provider: 'instagram', redirectUri });
    const json = authorizationUrlResponse(instagram.getAuthorizationUrl(state));
    setOAuthNonceCookie(json, nonce);
    return json;
  });
}

export const GET = withApiErrorReporting('GET /api/instagram-auth/start', getHandler);

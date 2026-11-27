import { NextRequest } from 'next/server';
import { createOAuthState, setOAuthNonceCookie } from '@/lib/oauth-utils';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { authorizationUrlResponse, startSocialOAuth } from '@/lib/oauth/social-start';
import { createGoogleOAuth2Client, generateGoogleAuthUrl } from '@/lib/youtube';

const APP = { label: 'Google', envPrefix: 'GOOGLE', sessionBeforeCredentials: true };

async function getHandler(request: NextRequest = new NextRequest('https://post-engineer.com/api/google-oauth/start')) {
  return startSocialOAuth(request, RATE_LIMITS.oauthStart, APP, async (redirectUri) => {
    const oauth2Client = await createGoogleOAuth2Client(redirectUri);
    const { state, nonce } = createOAuthState({ provider: 'youtube', redirectUri });
    const json = authorizationUrlResponse(generateGoogleAuthUrl(oauth2Client, state));
    setOAuthNonceCookie(json, nonce);
    return json;
  });
}

export const GET = withApiErrorReporting('GET /api/google-oauth/start', getHandler);

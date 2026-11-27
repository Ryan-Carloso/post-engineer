import { NextRequest } from 'next/server';
import { createOAuthState, setOAuthNonceCookie } from '@/lib/oauth-utils';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { authorizationUrlResponse, startSocialOAuth } from '@/lib/oauth/social-start';

const APP = { label: 'Threads', envPrefix: 'THREADS' };

async function getHandler(request: NextRequest) {
  return startSocialOAuth(request, RATE_LIMITS.oauthStart, APP, async (redirectUri) => {
    const { buildThreadsAuthorizationUrl } = await import('@/lib/threads');
    const { state, nonce } = createOAuthState({ provider: 'threads', redirectUri });
    const json = authorizationUrlResponse(buildThreadsAuthorizationUrl(state, redirectUri));
    setOAuthNonceCookie(json, nonce);
    return json;
  });
}

export const GET = withApiErrorReporting('GET /api/threads-auth/start', getHandler);

'use client';

import { useOAuthFlow } from './oauth-flow';

//---------------
// usePinterestOAuth — Pinterest OAuth flow.
//---------------
export function usePinterestOAuth() {
  return useOAuthFlow({
    startUrl: '/api/pinterest-auth/start',
    popupTitle: 'Pinterest OAuth',
    successType: 'pinterest-oauth-success',
    errorType: 'pinterest-oauth-error',
    queryKey: ['social-accounts'],
  });
}

'use client';

import { useOAuthFlow } from './oauth-flow';

//---------------
// useFacebookOAuth — Facebook OAuth flow.
//---------------
export function useFacebookOAuth() {
  return useOAuthFlow({
    startUrl: '/api/facebook-auth/start',
    popupTitle: 'Facebook OAuth',
    successType: 'facebook-oauth-success',
    errorType: 'facebook-oauth-error',
    queryKey: ['social-accounts'],
  });
}

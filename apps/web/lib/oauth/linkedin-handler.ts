'use client';

import { useOAuthFlow } from './oauth-flow';

//---------------
// useLinkedInOAuth — LinkedIn OAuth flow (profile + company pages).
//---------------
export function useLinkedInOAuth() {
  return useOAuthFlow({
    startUrl: '/api/linkedin-auth/start',
    popupTitle: 'LinkedIn OAuth',
    successType: 'linkedin-oauth-success',
    errorType: 'linkedin-oauth-error',
    queryKey: ['linkedin-accounts'],
  });
}

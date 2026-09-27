'use client';

import { useOAuthFlow } from './oauth-flow';

//---------------
// useInstagramOAuth — Instagram OAuth flow (direct Login).
//---------------
export function useInstagramOAuth() {
  return useOAuthFlow({
    startUrl: '/api/instagram-auth/start',
    popupTitle: 'Instagram OAuth',
    successType: 'instagram-oauth-success',
    errorType: 'instagram-oauth-error',
    queryKey: ['instagram-accounts'],
  });
}

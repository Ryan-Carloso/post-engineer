'use client';

import { useOAuthFlow } from './oauth-flow';

export function useInstagramOAuth() {
  return useOAuthFlow({
    startUrl: '/api/instagram-auth/start',
    popupTitle: 'Instagram OAuth',
    successType: 'instagram-oauth-success',
    errorType: 'instagram-oauth-error',
    queryKey: ['social-accounts'],
  });
}

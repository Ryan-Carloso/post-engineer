'use client';

import { useOAuthFlow } from './oauth-flow';

//---------------
// useFanvueOAuth — Fanvue OAuth flow.
//---------------
export function useFanvueOAuth() {
  return useOAuthFlow({
    startUrl: '/api/fanvue-auth/start',
    popupTitle: 'Fanvue OAuth',
    successType: 'fanvue-oauth-success',
    errorType: 'fanvue-oauth-error',
    queryKey: ['social-accounts'],
  });
}

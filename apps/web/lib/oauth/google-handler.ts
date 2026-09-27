'use client';

import { useOAuthFlow } from './oauth-flow';

//---------------
// useYouTubeOAuth — Google (YouTube) OAuth flow.
//---------------
export function useYouTubeOAuth() {
  return useOAuthFlow({
    startUrl: '/api/google-oauth/start',
    popupTitle: 'YouTube OAuth',
    successType: 'youtube-oauth-success',
    errorType: 'youtube-oauth-error',
    queryKey: ['youtube-accounts'],
  });
}

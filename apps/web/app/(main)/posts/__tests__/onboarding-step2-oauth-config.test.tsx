import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/lib/oauth/oauth-flow', () => ({
  useOAuthFlow: vi.fn(() => ({ startOAuth: vi.fn(), isLoading: false, error: null })),
}));

import { useOAuthFlow } from '@/lib/oauth/oauth-flow';
import { ONBOARDING_OAUTH_CONFIG } from '../onboarding-step2';
import { useYouTubeOAuth } from '@/lib/oauth/google-handler';
import { useInstagramOAuth } from '@/lib/oauth/instagram-handler';
import { useLinkedInOAuth } from '@/lib/oauth/linkedin-handler';
import { useThreadsOAuth } from '@/lib/oauth/threads-handler';
import { useFacebookOAuth } from '@/lib/oauth/facebook-handler';
import { usePinterestOAuth } from '@/lib/oauth/pinterest-handler';
import { useFanvueOAuth } from '@/lib/oauth/fanvue-handler';

const HANDLERS = {
  youtube: useYouTubeOAuth,
  instagram: useInstagramOAuth,
  linkedin: useLinkedInOAuth,
  threads: useThreadsOAuth,
  facebook: useFacebookOAuth,
  pinterest: usePinterestOAuth,
  fanvue: useFanvueOAuth,
} as const;

describe('onboarding step 2 OAuth config', () => {
  it('matches the /accounts handler config for every OAuth provider', () => {
    const mockedFlow = vi.mocked(useOAuthFlow);
    for (const [provider, hook] of Object.entries(HANDLERS)) {
      mockedFlow.mockClear();
      renderHook(() => hook());
      expect(mockedFlow).toHaveBeenCalledTimes(1);
      expect(mockedFlow).toHaveBeenCalledWith(
        ONBOARDING_OAUTH_CONFIG[provider as keyof typeof ONBOARDING_OAUTH_CONFIG],
      );
    }
  });
});

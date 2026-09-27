//---------------
// types — SOCIAL_PROVIDERS has a SINGLE source of truth
// (lib/providers/registry). No duplicated list.
//---------------

import { describe, it, expect } from 'vitest';
import {
  SOCIAL_PROVIDERS as socialProvidersFromTypes,
  type SocialProvider as SocialProviderFromTypes,
} from '@/lib/types';
import {
  SOCIAL_PROVIDERS as socialProvidersFromRegistry,
  type SocialProvider as SocialProviderFromRegistry,
} from '@/lib/providers/registry';

describe('social providers — single source', () => {
  it('lib/types re-exports the registry list (same reference, no duplication)', () => {
    expect(socialProvidersFromTypes).toBe(socialProvidersFromRegistry);
  });

  it('cobre youtube, instagram, bluesky e linkedin', () => {
    expect([...socialProvidersFromTypes]).toEqual(['youtube', 'instagram', 'bluesky', 'linkedin']);
  });

  it('the SocialProvider types are interchangeable', () => {
    const a: SocialProviderFromTypes = 'linkedin';
    const b: SocialProviderFromRegistry = a;
    expect(b).toBe('linkedin');
  });
});

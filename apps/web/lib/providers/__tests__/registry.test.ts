import { describe, it, expect } from 'vitest';
import {
  SOCIAL_PROVIDERS,
  PROVIDER_REGISTRY,
  isSocialProvider,
  isOAuthProvider,
} from '@/lib/providers/registry';

describe('provider registry', () => {
  it('registry is exhaustive: every provider in the union has an entry', () => {
    expect(Object.keys(PROVIDER_REGISTRY).sort()).toEqual([...SOCIAL_PROVIDERS].sort());
  });

  it('every provider exposes toPublicAccount and supportsOAuthCallback', () => {
    for (const provider of SOCIAL_PROVIDERS) {
      const def = PROVIDER_REGISTRY[provider];
      expect(typeof def.toPublicAccount).toBe('function');
      expect(typeof def.supportsOAuthCallback).toBe('boolean');
    }
  });

  it('isSocialProvider accepts known providers and rejects unknown ones', () => {
    for (const provider of SOCIAL_PROVIDERS) {
      expect(isSocialProvider(provider)).toBe(true);
    }
    expect(isSocialProvider('tiktok')).toBe(false);
    expect(isSocialProvider(42)).toBe(false);
    expect(isSocialProvider(null)).toBe(false);
  });

  it('isOAuthProvider marks who has OAuth (bluesky does not)', () => {
    expect(isOAuthProvider('youtube')).toBe(true);
    expect(isOAuthProvider('instagram')).toBe(true);
    expect(isOAuthProvider('linkedin')).toBe(true);
    expect(isOAuthProvider('bluesky')).toBe(false);
    expect(isOAuthProvider('tiktok')).toBe(false);
  });
});

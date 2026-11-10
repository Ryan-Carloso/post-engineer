import { describe, expect, it } from 'vitest';
import type { PublicAccountItem } from '@/lib/providers/registry';
import { accountOption, formatSocialHandle } from '../account-options';

const INSTAGRAM_BASE: Extract<PublicAccountItem, { provider: 'instagram' }> = {
  provider: 'instagram',
  igUserId: 'ig1',
  username: 'vivalave',
  recordId: 'rec-ig1',
  connectedAt: 1,
  lastUsed: 1,
};

describe('formatSocialHandle', () => {
  it('prefixes a single @ when the handle has none', () => {
    expect(formatSocialHandle('vivalave')).toBe('@vivalave');
  });

  it('does not double the @ when the handle already includes it', () => {
    expect(formatSocialHandle('@vivalave')).toBe('@vivalave');
    expect(formatSocialHandle('@@vivalave')).toBe('@vivalave');
  });
});

describe('accountOption instagram label', () => {
  it('uses one @ for instagram usernames stored with or without a prefix', () => {
    expect(accountOption({ ...INSTAGRAM_BASE, username: '@vivalave' }).label).toBe('@vivalave');
    expect(accountOption(INSTAGRAM_BASE).label).toBe('@vivalave');
  });
});

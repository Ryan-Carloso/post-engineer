import { describe, it, expect } from 'vitest';
import { requirePublishingAccounts } from '../require-publishing-accounts';

describe('requirePublishingAccounts (issue #572)', () => {
  it('throws when no accounts are passed', () => {
    expect(() => requirePublishingAccounts(undefined)).toThrow(
      'Select at least one publishing account for this persona',
    );
  });

  it('throws when every provider maps to an empty list', () => {
    expect(() => requirePublishingAccounts({ youtube: [], bluesky: [] })).toThrow(
      'Select at least one publishing account for this persona',
    );
  });

  it('returns the map unchanged when at least one account is bound', () => {
    const accounts = { youtube: ['UC-1'], bluesky: [] };
    expect(requirePublishingAccounts(accounts)).toEqual(accounts);
  });
});

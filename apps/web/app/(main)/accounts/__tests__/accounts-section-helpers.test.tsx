import { describe, it, expect } from 'vitest';
import { connectedLabel, errorLabel } from '@/app/(main)/accounts/accounts-section-helpers';
import { useI18n } from '@/lib/i18n/provider';

//---------------
// accounts-section-helpers — unit tests for the section labels.
// The t stub interpolates { count } so the label's count argument is
// pinned, not just the key: dropping it changes the rendered pill.
//---------------

type T = ReturnType<typeof useI18n>['t'];

const t: T = ((key: string, options?: { count?: number }) =>
  options?.count === undefined ? key : `${key}:${options.count}`) as T;

describe('connectedLabel', () => {
  it('uses the singular key for one account', () => {
    expect(connectedLabel(t, 1)).toBe('accounts.accountConnected:1');
  });

  it('uses the plural key for zero or several accounts', () => {
    expect(connectedLabel(t, 0)).toBe('accounts.accountsConnected:0');
    expect(connectedLabel(t, 2)).toBe('accounts.accountsConnected:2');
  });
});

describe('errorLabel', () => {
  it('uses the singular key for one broken account', () => {
    expect(errorLabel(t, 1)).toBe('accounts.accountWithIssue:1');
  });

  it('uses the plural key for zero or several broken accounts', () => {
    expect(errorLabel(t, 0)).toBe('accounts.accountsWithIssues:0');
    expect(errorLabel(t, 2)).toBe('accounts.accountsWithIssues:2');
  });
});

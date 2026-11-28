// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import {
  accessReasonOf,
  computeAccessStatus,
  isSubscriptionStatus,
  SUBSCRIPTION_STATUSES,
} from '../access-status';

const NOW = new Date('2026-11-26T12:00:00.000Z');

describe('computeAccessStatus', () => {
  it('keeps an admitted beta account active at day 8, 15 and 30', () => {
    for (const days of [8, 15, 30]) {
      const status = computeAccessStatus(
        { accessUntil: '2099-01-01T00:00:00.000Z', subscriptionStatus: 'beta' },
        new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000),
      );
      expect(status).toEqual({ endsAt: '2099-01-01T00:00:00.000Z', active: true, reason: 'beta' });
    }
  });

  it('treats an account with no status as awaiting the beta', () => {
    expect(accessReasonOf(null)).toBe('beta');
    expect(
      computeAccessStatus({ accessUntil: '2026-11-26T12:00:00.000Z', subscriptionStatus: null }, NOW),
    ).toEqual({ endsAt: '2026-11-26T12:00:00.000Z', active: false, reason: 'beta' });
  });

  it('becomes inactive at the exact end instant', () => {
    const status = computeAccessStatus(
      { accessUntil: '2026-11-26T12:00:00.000Z', subscriptionStatus: null },
      NOW,
    );
    expect(status.active).toBe(false);
  });

  it('names a paid subscription as the reason, not the beta', () => {
    expect(
      computeAccessStatus({ accessUntil: '2027-06-01T00:00:00.000Z', subscriptionStatus: 'active' }, NOW).reason,
    ).toBe('subscription');
  });

  it('keeps access during the past_due grace window and says why it lapsed', () => {
    const inGrace = computeAccessStatus(
      { accessUntil: '2026-11-28T12:00:00.000Z', subscriptionStatus: 'past_due' },
      NOW,
    );
    expect(inGrace.active).toBe(true);
    expect(inGrace.reason).toBe('subscription');
    const lapsed = computeAccessStatus(
      { accessUntil: '2026-11-20T12:00:00.000Z', subscriptionStatus: 'past_due' },
      NOW,
    );
    expect(lapsed.active).toBe(false);
    expect(lapsed.reason).toBe('subscription');
  });

  it('reports a cancelled subscription as none, never as the beta', () => {
    expect(accessReasonOf('canceled')).toBe('none');
    expect(accessReasonOf('unpaid')).toBe('none');
    expect(accessReasonOf('paused')).toBe('none');
  });

  it('throws on an unknown subscription status instead of guessing', () => {
    expect(() => accessReasonOf('past-due')).toThrow(/unknown subscription_status/);
  });

  it('throws on an invalid access_until', () => {
    expect(() => computeAccessStatus({ accessUntil: 'nope', subscriptionStatus: null }, NOW)).toThrow(
      'access_until is not a valid timestamp: nope',
    );
  });

});

describe('SUBSCRIPTION_STATUSES', () => {
  it('is exactly the set the database constraint accepts', () => {
    expect([...SUBSCRIPTION_STATUSES]).toEqual([
      'trialing',
      'active',
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
      'incomplete_expired',
      'paused',
      'beta',
    ]);
    for (const status of SUBSCRIPTION_STATUSES) expect(isSubscriptionStatus(status)).toBe(true);
    expect(isSubscriptionStatus('refunded')).toBe(false);
  });

  it('matches the CHECK constraint of migration 095 and the Stripe guard of migration 091', () => {
    const root = findRepoRoot(import.meta.url);
    const beta = readFileSync(join(root, 'supabase', 'migrations', '095_closed-beta-access.sql'), 'utf8');
    const check = /subscription_status in \(([^)]*)\)/.exec(beta);
    expect(check).not.toBeNull();
    const inSql = [...(check?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(inSql).toEqual([...SUBSCRIPTION_STATUSES]);

    const entitlement = readFileSync(join(root, 'supabase', 'migrations', '091_access-entitlement.sql'), 'utf8');
    const guard = /p_status not in \(\s*([\s\S]*?)\n  \) then/.exec(entitlement);
    expect(guard).not.toBeNull();
    const guarded = [...(guard?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(guarded).toEqual(SUBSCRIPTION_STATUSES.filter((status) => status !== 'beta'));
  });

  it('keeps the dunning grace in 091 and makes a new account await the beta in 095', () => {
    const root = findRepoRoot(import.meta.url);
    const entitlement = readFileSync(join(root, 'supabase', 'migrations', '091_access-entitlement.sql'), 'utf8');
    expect(entitlement).toContain("v_dunning_grace constant interval := interval '3 days'");
    const beta = readFileSync(join(root, 'supabase', 'migrations', '095_closed-beta-access.sql'), 'utf8');
    expect(beta).toContain('alter column access_until set default now()');
    expect(beta).toContain('drop column if exists trial_ends_at');
  });
});

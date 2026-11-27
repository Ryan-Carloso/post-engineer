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
  TRIAL_DAYS,
} from '../access-status';

const NOW = new Date('2026-11-26T12:00:00.000Z');

describe('computeAccessStatus', () => {
  it('counts the days left in an active window', () => {
    const status = computeAccessStatus(
      { accessUntil: '2026-11-29T12:00:00.000Z', subscriptionStatus: null },
      NOW,
    );
    expect(status).toEqual({ endsAt: '2026-11-29T12:00:00.000Z', active: true, daysLeft: 3, reason: 'trial' });
  });

  it('becomes inactive at the exact end instant', () => {
    const status = computeAccessStatus(
      { accessUntil: '2026-11-26T12:00:00.000Z', subscriptionStatus: null },
      NOW,
    );
    expect(status.active).toBe(false);
    expect(status.daysLeft).toBe(0);
  });

  it('names a paid subscription as the reason, not the trial', () => {
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

  it('reports a cancelled subscription as none, never as a trial', () => {
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

  it('pins the trial length to the migration default', () => {
    expect(TRIAL_DAYS).toBe(7);
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
    ]);
    for (const status of SUBSCRIPTION_STATUSES) expect(isSubscriptionStatus(status)).toBe(true);
    expect(isSubscriptionStatus('refunded')).toBe(false);
  });

  it('matches the CHECK constraint and the function guard in migration 091', () => {
    const migration = readFileSync(
      join(findRepoRoot(import.meta.url), 'supabase', 'migrations', '091_access-entitlement.sql'),
      'utf8',
    );
    const check = /subscription_status in \(([^)]*)\)/.exec(migration);
    expect(check).not.toBeNull();
    const inSql = [...(check?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(inSql).toEqual([...SUBSCRIPTION_STATUSES]);

    const guard = /p_status not in \(\s*([\s\S]*?)\n  \) then/.exec(migration);
    expect(guard).not.toBeNull();
    const guarded = [...(guard?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(guarded).toEqual([...SUBSCRIPTION_STATUSES]);
  });

  it('keeps the dunning grace and the trial backfill in the migration', () => {
    const migration = readFileSync(
      join(findRepoRoot(import.meta.url), 'supabase', 'migrations', '091_access-entitlement.sql'),
      'utf8',
    );
    expect(migration).toContain("v_dunning_grace constant interval := interval '3 days'");
    expect(migration).toContain(`set access_until = trial_ends_at`);
    expect(migration).toContain(`default (now() + interval '${TRIAL_DAYS} days')`);
  });
});

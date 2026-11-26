import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';
import { computeTrialStatus, TRIAL_DAYS } from '../trial-status';

const NOW = new Date('2026-11-20T12:00:00.000Z');

describe('computeTrialStatus', () => {
  it('counts the started days left while the trial runs', () => {
    expect(computeTrialStatus('2026-11-27T12:00:00.000Z', NOW)).toEqual({
      endsAt: '2026-11-27T12:00:00.000Z',
      active: true,
      daysLeft: 7,
    });
    expect(computeTrialStatus('2026-11-20T13:00:00.000Z', NOW).daysLeft).toBe(1);
  });

  it('ends the trial at the exact end instant', () => {
    expect(computeTrialStatus('2026-11-20T12:00:00.000Z', NOW)).toEqual({
      endsAt: '2026-11-20T12:00:00.000Z',
      active: false,
      daysLeft: 0,
    });
    expect(computeTrialStatus('2026-11-01T00:00:00.000Z', NOW).active).toBe(false);
  });

  it('throws on a stored value that is not a timestamp', () => {
    expect(() => computeTrialStatus('not-a-date', NOW)).toThrow('trial_ends_at is not a valid timestamp: not-a-date');
  });

  it('grants the same number of days as the migration default and backfill', () => {
    const migration = readFileSync(
      join(findRepoRoot(import.meta.url), 'supabase', 'migrations', '087_remove-generation-and-tokens.sql'),
      'utf8',
    );
    expect(migration).toContain(`set trial_ends_at = created_at + interval '${TRIAL_DAYS} days'`);
    expect(migration).toContain(`set default (now() + interval '${TRIAL_DAYS} days')`);
  });
});

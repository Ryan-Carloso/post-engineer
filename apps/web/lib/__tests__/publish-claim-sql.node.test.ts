import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeAccessStatus } from '@/lib/access-status';
import { findRepoRoot } from '@/test/repo-root';

const root = findRepoRoot(import.meta.url);
const sql = readFileSync(join(root, 'supabase', 'migrations', '094_publish-due-scheduler.sql'), 'utf8');

function functionBody(name: string): string {
  const start = sql.indexOf(`function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf('$$;', sql.indexOf('as $$', start) + 5);
  return sql.slice(start, end);
}

describe('094 publish claim SQL', () => {
  it('claims only while access_until is strictly after now, the rule computeAccessStatus applies', () => {
    expect(functionBody('claim_next_publish_slot')).toContain('up.access_until > p_now');
    const at = '2026-11-27T12:00:00.000Z';
    const now = new Date(at);
    expect(computeAccessStatus({ accessUntil: at, subscriptionStatus: null }, now).active).toBe(false);
    expect(computeAccessStatus({ accessUntil: '2026-11-27T12:00:00.001Z', subscriptionStatus: null }, now).active).toBe(true);
  });

  it('expires only owners whose access_until is at or before now', () => {
    expect(functionBody('expire_inactive_ready_slots')).toContain('up.access_until <= p_now');
  });

  it('claims only ready and publishing slots, never awaiting_approval, pending, failed or expired', () => {
    const claim = functionBody('claim_next_publish_slot');
    expect(claim).toContain("sp.status = 'ready' and sp.slot_at <= p_now");
    expect(claim).toContain("sp.status = 'publishing'");
    const candidates = claim.slice(claim.indexOf('where up.access_until'), claim.indexOf('for update'));
    for (const status of ['awaiting_approval', 'pending', 'failed', 'expired', 'published']) {
      expect(candidates).not.toContain(`'${status}'`);
    }
  });

  it('treats a null lease as lapsed and locks the row it claims with skip locked', () => {
    const claim = functionBody('claim_next_publish_slot');
    expect(claim).toContain('sp.publish_not_before is null or sp.publish_not_before <= p_now');
    expect(claim).toContain('for update of sp skip locked');
    expect(claim).toContain('limit 1');
  });

  it('grants every function to the service role only', () => {
    for (const fn of [
      'release_scheduler_lease(text, text)',
      'claim_next_publish_slot(timestamptz, interval)',
      'expire_inactive_ready_slots(timestamptz, integer)',
    ]) {
      expect(sql).toContain(`revoke execute on function public.${fn} from authenticated;`);
      expect(sql).toContain(`grant execute on function public.${fn} to service_role;`);
    }
  });
});

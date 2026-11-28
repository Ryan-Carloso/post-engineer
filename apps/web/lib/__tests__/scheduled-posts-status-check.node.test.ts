import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { SCHEDULED_POST_STATUSES } from '@/lib/schedule-status';

const repoRoot = findRepoRoot(import.meta.url);
const migration = readFileSync(
  join(repoRoot, 'supabase', 'migrations', '095_scheduled-posts-status-check.sql'),
  'utf8',
);

describe('supabase/migrations/095_scheduled-posts-status-check.sql', () => {
  it('drops the drifted check before replacing it', () => {
    expect(migration).toContain("conname = 'scheduled_posts_status_check'");
    expect(migration).toContain('alter table public.scheduled_posts drop constraint scheduled_posts_status_check;');
  });

  it('adds the check with exactly the statuses the code uses', () => {
    expect(migration).toContain('add constraint scheduled_posts_status_check');
    for (const status of SCHEDULED_POST_STATUSES) {
      expect(migration).toContain(`'${status}'`);
    }
  });

  it('admits expired, the status expire_inactive_ready_slots writes', () => {
    expect(migration).toContain("'expired'");
  });
});

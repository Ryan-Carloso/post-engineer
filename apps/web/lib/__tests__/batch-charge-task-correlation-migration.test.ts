import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import {
  BATCH_GENERATION_PREFIX,
  batchGenerationId,
} from '@/lib/generation/gone-generation-reconcile';

//---------------
// supabase/migrations/009_batch-charge-task-correlation.sql + the app's
// gone-task resolver must agree on how a batch generation id is spelled.
//
// The reconciler derives `batch:<schedule_id>` in TypeScript and the
// migration backfills the same shape in SQL. If one side drifts (a renamed
// separator, a different prefix), the backfill silently matches nothing and
// every scheduled post is back to a permanently `running` history row — with
// no error anywhere. These assertions pin the shared literals.
//
// Static `includes` checks only: a dynamically built RegExp from an
// interpolated string trips CodeQL's incomplete-string-escaping rule.
//---------------

const migrationPath = join(
  findRepoRoot(import.meta.url),
  'supabase',
  'migrations',
  '009_batch-charge-task-correlation.sql',
);

const migrationSql = readFileSync(migrationPath, 'utf8');

describe('supabase/migrations/009_batch-charge-task-correlation.sql', () => {
  it('backfills only NULL engine_task_ids so a re-run never rewrites a charge', () => {
    expect(migrationSql).toContain('t.engine_task_id is null');
  });

  it('never attributes a multi-slot batch charge to a single task', () => {
    expect(migrationSql).toContain('and 1 = (');
    expect(migrationSql).toContain("v2.generation_id like t.generation_id || ':slot:%'");
  });

  it('matches the batch charge row the reconciler looks up', () => {
    // The reconciler filters type='video_generation'; the backfill must use
    // the same type or it would correlate a refund row instead of the charge.
    expect(migrationSql).toContain("t.type = 'video_generation'");
  });

  it('excludes slot ids from the batch-charge side of the join', () => {
    expect(migrationSql).toContain("not like 'batch:%:slot:%'");
  });
});

describe('batch id literals are shared by the app and the migration', () => {
  it('uses the same batch prefix in both surfaces', () => {
    expect(BATCH_GENERATION_PREFIX).toBe('batch:');
    expect(migrationSql).toContain("like 'batch:%'");
  });

  it('uses the same :slot: separator in both surfaces', () => {
    expect(batchGenerationId('batch:abc:slot:def')).toBe('batch:abc');
    expect(migrationSql).toContain(`':slot:%'`);
  });

  it('pins the index the gone-task reconciler relies on', () => {
    expect(migrationSql).toContain('create index if not exists scheduled_posts_task_id_idx');
  });
});
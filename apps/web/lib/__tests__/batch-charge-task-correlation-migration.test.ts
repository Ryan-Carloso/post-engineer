import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import {
  BATCH_GENERATION_PREFIX,
  batchGenerationId,
} from '@/lib/generation/gone-generation-reconcile';

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
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { UPLOAD_SLOT_REFERENCE_INDEX } from '@/lib/videos/upload-slot-reference';

const migrationSql = readFileSync(
  join(
    findRepoRoot(import.meta.url),
    'supabase',
    'migrations',
    '067_scheduled-posts-upload-ref-unique.sql',
  ),
  'utf8',
);

describe('migration 067 releases duplicate live upload slots', () => {
  it('deletes the duplicates before creating the unique index', () => {
    const dedupeAt = migrationSql.indexOf('delete from public.scheduled_posts');
    const indexAt = migrationSql.indexOf('create unique index');
    expect(dedupeAt).toBeGreaterThan(-1);
    expect(indexAt).toBeGreaterThan(dedupeAt);
  });

  it('ranks live upload slots per upload and keeps the earliest', () => {
    expect(migrationSql).toContain('partition by media_ref');
    expect(migrationSql).toContain('order by slot_at, created_at, id');
    expect(migrationSql).toContain('where rank > 1');
  });

  it('only ever releases schedulable rows', () => {
    expect(
      migrationSql.split("status in ('pending', 'ready')"),
    ).toHaveLength(4);
    expect(migrationSql).not.toContain("status <> 'failed'");
  });

  it('deletes the schedules the release empties, keeping mixed ones', () => {
    expect(migrationSql).toContain('delete from public.schedules');
    expect(migrationSql).toContain('not exists (');
  });

  it('builds the index the publish routes check against', () => {
    expect(migrationSql).toContain(
      `create unique index if not exists ${UPLOAD_SLOT_REFERENCE_INDEX}`,
    );
    expect(migrationSql).toContain('on public.scheduled_posts (media_ref)');
  });
});

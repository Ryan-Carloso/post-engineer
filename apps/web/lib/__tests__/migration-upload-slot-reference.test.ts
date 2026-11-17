import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { UPLOAD_SLOT_REFERENCE_INDEX } from '@/lib/videos/upload-slot-reference';

//---------------
// supabase/migrations/067_scheduled-posts-upload-ref-unique.sql must release
// the duplicate live slots production already holds BEFORE it builds the
// index. The application route shipped the double-scheduling bug this index
// closes, so a real database can hold several live slots for one upload, and
// CREATE UNIQUE INDEX aborts (23505) on them — a deploy blocked at migration
// time, which CI cannot see because it applies the chain to a fresh Postgres.
//
// Static `includes` / `indexOf` checks only: a dynamically built RegExp from
// an interpolated string trips CodeQL's incomplete-string-escaping rule.
//---------------

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

  it('leaves failed slots and non-upload media out of the release', () => {
    // The same predicate as the index: a failed slot releases the reference,
    // so it must survive the dedupe and a failed row must never be deleted.
    expect(
      migrationSql.split("where media_kind = 'upload' and status <> 'failed'"),
    ).toHaveLength(3);
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

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { HOOK_TITLE_MAX_CHARS } from '@/lib/generation/hook-title';

interface Snapshot {
  tables: Record<
    string,
    { columns: { name: string; type: string; notNull: boolean }[]; constraints: Record<string, string> }
  >;
}

const root = findRepoRoot(import.meta.url);
const migration = readFileSync(join(root, 'supabase/migrations/084_scheduled-posts-hook-title.sql'), 'utf8');
const snapshot = JSON.parse(readFileSync(join(root, 'supabase/schema.snapshot.json'), 'utf8')) as Snapshot;
const readme = readFileSync(join(root, 'supabase/README.md'), 'utf8');

describe('scheduled_posts.hook_title migration', () => {
  it('adds a nullable text column, idempotently', () => {
    expect(migration).toContain('alter table public.scheduled_posts');
    expect(migration).toContain('add column if not exists hook_title text;');
  });

  it('guards the length check with pg_constraint so a rerun is a no-op', () => {
    expect(migration).toContain("conname = 'scheduled_posts_hook_title_length_check'");
    expect(migration).toContain('if not exists (');
  });

  it('caps the stored title at the shared character limit', () => {
    expect(migration).toContain(`char_length(hook_title) between 1 and ${HOOK_TITLE_MAX_CHARS}`);
    const check = snapshot.tables.scheduled_posts.constraints.scheduled_posts_hook_title_length_check;
    expect(check).toContain(`char_length(hook_title) <= ${HOOK_TITLE_MAX_CHARS}`);
  });

  it('is recorded in the schema snapshot as a nullable text column', () => {
    const column = snapshot.tables.scheduled_posts.columns.find((entry) => entry.name === 'hook_title');
    expect(column).toEqual({ name: 'hook_title', type: 'text', default: null, notNull: false });
  });

  it('is listed in the supabase README', () => {
    expect(readme).toContain('`migrations/084_scheduled-posts-hook-title.sql`');
  });
});

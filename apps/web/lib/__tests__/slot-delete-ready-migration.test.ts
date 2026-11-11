import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

//---------------
// supabase/migrations/058_slot-delete-ready.sql — the atomic delete guard
// must allow 'ready' (issue #555): a ready slot is generated but not yet
// dispatched, so the owner can delete it from the detail page and the
// delete prevents the later publish. The guard's other properties are
// unchanged: row lock + remaining-count + delete in one transaction, the
// last-slot guard still applies, and no refund happens on delete. The
// standalone supabase/slot-delete-guard.sql keeps the same body; this test
// pins both files so they cannot drift apart.
//---------------

const repoRoot = findRepoRoot(import.meta.url);
const migration = readFileSync(
  join(repoRoot, 'supabase', 'migrations', '058_slot-delete-ready.sql'),
  'utf8',
);
const standalone = readFileSync(join(repoRoot, 'supabase', 'slot-delete-guard.sql'), 'utf8');

describe('supabase/migrations/058_slot-delete-ready.sql', () => {
  it('replaces the delete_slot_if_not_last function', () => {
    expect(migration).toContain('create or replace function public.delete_slot_if_not_last(');
  });

  it('allows ready slots alongside pending and failed', () => {
    expect(migration).toContain("if v_status not in ('pending', 'ready', 'failed') then");
  });

  it('keeps the last-slot guard', () => {
    expect(migration).toContain("return 'is_last_slot';");
  });

  it('keeps the standalone guard file in sync on the deletable statuses', () => {
    expect(standalone).toContain("if v_status not in ('pending', 'ready', 'failed') then");
    expect(standalone).toContain('create or replace function public.delete_slot_if_not_last(');
  });
});

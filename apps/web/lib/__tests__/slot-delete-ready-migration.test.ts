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
// standalone supabase/slot-delete-guard.sql mirrors the live body, which
// migration 065 redefined with a pinned search_path; the last describe
// block pins the mirror to 065 so they cannot drift apart.
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

//---------------
// The live definition is the newest migration that redefines the function
// (065 pins search_path on this SECURITY DEFINER function). The standalone
// reference file must carry exactly that body: re-running a stale copy with
// CREATE OR REPLACE would drop the search_path pin again.
//---------------

function functionBody(sql: string): string {
  const start = sql.indexOf('create or replace function public.delete_slot_if_not_last(');
  const end = sql.indexOf('$$;', start);
  if (start === -1 || end === -1) throw new Error('delete_slot_if_not_last body not found');
  return sql.slice(start, end + 3).replace(/^\s*--.*$/gm, '').replace(/\s+/g, ' ').trim();
}

describe('supabase/slot-delete-guard.sql mirrors the live delete_slot_if_not_last', () => {
  const live = readFileSync(
    join(repoRoot, 'supabase', 'migrations', '065_definer-function-grants.sql'),
    'utf8',
  );

  it('pins search_path in the standalone copy', () => {
    expect(functionBody(standalone)).toContain('security definer set search_path = public as $$');
  });

  it('carries the same function body as migration 065', () => {
    expect(functionBody(standalone)).toBe(functionBody(live));
  });
});

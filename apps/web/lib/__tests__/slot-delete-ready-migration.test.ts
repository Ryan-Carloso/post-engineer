import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

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

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

interface Snapshot {
  tables: Record<
    string,
    { columns: { name: string; type: string; default: string | null; notNull: boolean }[]; constraints: Record<string, string> }
  >;
}

const root = findRepoRoot(import.meta.url);
const migration = readFileSync(join(root, 'supabase/migrations/088_api-key-approval-mode.sql'), 'utf8');
const snapshot = JSON.parse(readFileSync(join(root, 'supabase/schema.snapshot.json'), 'utf8')) as Snapshot;
const readme = readFileSync(join(root, 'supabase/README.md'), 'utf8');

describe('user_api_keys.approval_mode migration', () => {
  it('adds a text column defaulting to approval, idempotently', () => {
    expect(migration).toContain('alter table public.user_api_keys');
    expect(migration).toContain('add column if not exists approval_mode text not null default \'approval\';');
  });

  it('checks the mode against exactly yolo and approval', () => {
    expect(migration).toContain('user_api_keys_approval_mode_check');
    expect(migration).toContain("check (approval_mode in ('yolo', 'approval'));");
  });

  it('is recorded in the schema snapshot as a non-null text defaulting to approval', () => {
    const column = snapshot.tables.user_api_keys.columns.find((entry) => entry.name === 'approval_mode');
    expect(column).toEqual({ name: 'approval_mode', type: 'text', default: "'approval'::text", notNull: true });
    expect(snapshot.tables.user_api_keys.constraints.user_api_keys_approval_mode_check).toBe(
      "CHECK ((approval_mode = ANY (ARRAY['yolo'::text, 'approval'::text])))",
    );
  });

  it('is listed in the supabase README', () => {
    expect(readme).toContain('`migrations/088_api-key-approval-mode.sql`');
  });
});

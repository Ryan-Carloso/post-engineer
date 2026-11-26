import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

interface Snapshot {
  tables: Record<
    string,
    { columns: { name: string; type: string; default: string | null; notNull: boolean }[] }
  >;
}

const root = findRepoRoot(import.meta.url);
const migration = readFileSync(join(root, 'supabase/migrations/086_persona-ai-label.sql'), 'utf8');
const snapshot = JSON.parse(readFileSync(join(root, 'supabase/schema.snapshot.json'), 'utf8')) as Snapshot;
const readme = readFileSync(join(root, 'supabase/README.md'), 'utf8');

describe('personas.ai_label migration', () => {
  it('adds a boolean column defaulting to false, idempotently', () => {
    expect(migration).toContain('alter table public.personas');
    expect(migration).toContain('add column if not exists ai_label boolean not null default false;');
  });

  it('is recorded in the schema snapshot as a non-null boolean defaulting to false', () => {
    const column = snapshot.tables.personas.columns.find((entry) => entry.name === 'ai_label');
    expect(column).toEqual({ name: 'ai_label', type: 'boolean', default: 'false', notNull: true });
  });

  it('is listed in the supabase README', () => {
    expect(readme).toContain('`migrations/086_persona-ai-label.sql`');
  });
});

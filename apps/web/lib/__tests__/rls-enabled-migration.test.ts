import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

describe('every public table in the migration chain has RLS enabled', () => {
  it('enables row level security on every created table', () => {
    const migrationsDir = join(
      findRepoRoot(import.meta.url),
      'supabase',
      'migrations',
    );
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const created = new Set<string>();
    const rlsEnabled = new Set<string>();
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      for (const m of sql.matchAll(
        /create table (?:if not exists )?public\.(\w+)/gi,
      )) {
        created.add(m[1].toLowerCase());
      }
      for (const m of sql.matchAll(
        /alter table public\.(\w+) enable row level security/gi,
      )) {
        rlsEnabled.add(m[1].toLowerCase());
      }
    }
    const missing = [...created].filter((t) => !rlsEnabled.has(t)).sort();
    expect(missing).toEqual([]);
  });
});

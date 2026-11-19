import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { SOCIAL_PROVIDERS } from '@/lib/providers/registry';

const repoRoot = findRepoRoot(import.meta.url);
const migrationPath = join(
  repoRoot,
  'supabase',
  'migrations',
  '037_social-accounts-threads-provider.sql',
);

function readSql(): string {
  return readFileSync(migrationPath, 'utf8');
}

function checkProviders(sql: string): string[] {
  const match = /check \(provider in \(([^)]*)\)\)/.exec(sql);
  if (match === null) {
    throw new Error(
      '037 must declare a provider check on social_accounts',
    );
  }
  return match[1]
    .split(',')
    .map((entry) => entry.trim().replace(/^'|'$/g, ''));
}

describe('supabase/migrations/037_social-accounts-threads-provider.sql', () => {
  it('exists', () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  it('drops the drifted pre-Threads constraint before re-adding it', () => {
    const sql = readSql();
    const dropAt = sql.indexOf(
      'drop constraint if exists social_accounts_provider_check',
    );
    const addAt = sql.indexOf('add constraint social_accounts_provider_check');
    expect(dropAt).toBeGreaterThanOrEqual(0);
    expect(addAt).toBeGreaterThanOrEqual(0);
    expect(dropAt).toBeLessThan(addAt);
  });

  it('allows exactly the five providers supported when it shipped', () => {
    const sql = readSql();
    expect(checkProviders(sql).sort()).toEqual(['bluesky', 'instagram', 'linkedin', 'threads', 'youtube']);
  });

  it('lists only providers the app still supports', () => {
    const sql = readSql();
    for (const provider of checkProviders(sql)) expect(SOCIAL_PROVIDERS).toContain(provider);
  });

  it('allows threads', () => {
    const sql = readSql();
    expect(checkProviders(sql)).toContain('threads');
  });
});

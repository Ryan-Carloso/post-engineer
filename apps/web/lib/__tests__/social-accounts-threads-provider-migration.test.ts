import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { SOCIAL_PROVIDERS } from '@/lib/providers/registry';

//---------------
// supabase/migrations/037_social-accounts-threads-provider.sql — the
// invariant the Threads OAuth callback depends on.
//
// GET /api/threads-auth/callback upserts provider='threads' into
// social_accounts, but production Postgres rejected it:
// "new row for relation \"social_accounts\" violates check constraint
// \"social_accounts_provider_check\"" (PostHog $exception, 2026-11-06).
// Migration 034 added 'threads' to the post_metrics provider check
// but never touched social_accounts — and the versioned migrations
// 0015/0016 that created social_accounts_provider_check were deleted
// in the b4037cff consolidation, so the current versioned chain never
// creates it and production still holds only the four pre-Threads
// providers.
//
// This migration re-created the constraint with the five providers of
// its time. A shipped migration is never edited, so this test pins that
// historical list; the current list is pinned by the latest migration
// that re-creates the check (050, pinterest-provider-migration.test.ts)
// and by the schema snapshot (migration-check-constraints-sync.test.ts).
//---------------

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

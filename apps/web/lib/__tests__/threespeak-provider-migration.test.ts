import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

//---------------
// supabase/migrations/052_threespeak-provider.sql — the schema the 3Speak
// (Hive) connect and publish paths depend on. Each provider check is
// dropped and re-created with the full list (the lesson of 037: a live
// constraint the chain no longer defines can linger in production, so a
// plain add would leave the old list in force). A shipped migration is
// never edited, so this test pins the eight providers 052 shipped with;
// the live pin is the 053 test.
//---------------

const sql = readFileSync(
  join(findRepoRoot(import.meta.url), 'supabase', 'migrations', '052_threespeak-provider.sql'),
  'utf8',
);

// The eight providers 052 shipped with, in the order the migration lists them.
const PROVIDERS_AT_052 = ['youtube', 'instagram', 'bluesky', 'linkedin', 'threads', 'facebook', 'pinterest', '3speak'];

function checkProviders(constraint: string): string[] {
  const start = sql.indexOf(`add constraint ${constraint}`);
  expect(start, `${constraint} must be added`).toBeGreaterThanOrEqual(0);
  const match = /check \(provider in \(([^)]*)\)\)/.exec(sql.slice(start));
  if (match === null) throw new Error(`${constraint} must declare a provider list`);
  return match[1].split(',').map((entry) => entry.trim().replace(/^'|'$/g, ''));
}

describe('supabase/migrations/052_threespeak-provider.sql', () => {
  it('adds the schedules threespeak account column with an empty default', () => {
    expect(sql).toContain("add column if not exists threespeak_account_ids text[] not null default '{}'");
  });

  it.each(['post_metrics_provider_check', 'social_accounts_provider_check'])(
    'drops %s before re-adding it',
    (constraint) => {
      const dropAt = sql.indexOf(`drop constraint if exists ${constraint}`);
      const addAt = sql.indexOf(`add constraint ${constraint}`);
      expect(dropAt).toBeGreaterThanOrEqual(0);
      expect(dropAt).toBeLessThan(addAt);
    },
  );

  it.each(['post_metrics_provider_check', 'social_accounts_provider_check'])(
    '%s allows exactly the eight providers 052 shipped with',
    (constraint) => {
      expect(checkProviders(constraint).sort()).toEqual([...PROVIDERS_AT_052].sort());
    },
  );
});

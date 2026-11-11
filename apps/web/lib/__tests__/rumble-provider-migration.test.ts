import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

//---------------
// supabase/migrations/053_rumble-provider.sql — the schema the Rumble
// connect and publish paths depend on. Each provider check is
// dropped and re-created with the full list (the lesson of 037: a live
// constraint the chain no longer defines can linger in production, so a
// plain add would leave the old list in force). A shipped migration is
// never edited, so this test pins the nine providers 053 shipped with;
// the file is frozen, so it must NOT track SOCIAL_PROVIDERS (057 adds
// fanvue after it). The live pin is the 057 test.
//---------------

// The nine providers 053 shipped with, in the order the migration lists them.
const PROVIDERS_AT_053 = ['youtube', 'instagram', 'bluesky', 'linkedin', 'threads', 'facebook', 'pinterest', '3speak', 'rumble'];

const sql = readFileSync(
  join(findRepoRoot(import.meta.url), 'supabase', 'migrations', '053_rumble-provider.sql'),
  'utf8',
);

function checkProviders(constraint: string): string[] {
  const start = sql.indexOf(`add constraint ${constraint}`);
  expect(start, `${constraint} must be added`).toBeGreaterThanOrEqual(0);
  const match = /check \(provider in \(([^)]*)\)\)/.exec(sql.slice(start));
  if (match === null) throw new Error(`${constraint} must declare a provider list`);
  return match[1].split(',').map((entry) => entry.trim().replace(/^'|'$/g, ''));
}

describe('supabase/migrations/053_rumble-provider.sql', () => {
  it('adds the schedules rumble account column with an empty default', () => {
    expect(sql).toContain("add column if not exists rumble_account_ids text[] not null default '{}'");
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
    '%s allows exactly the providers 053 shipped with',
    (constraint) => {
      expect(checkProviders(constraint).sort()).toEqual([...PROVIDERS_AT_053].sort());
    },
  );
});

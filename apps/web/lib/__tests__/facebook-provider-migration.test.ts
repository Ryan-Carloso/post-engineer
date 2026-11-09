import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { SOCIAL_PROVIDERS } from '@/lib/providers/registry';

//---------------
// supabase/migrations/049_facebook-provider.sql — the schema the Facebook
// Pages connect and publish paths depend on. Each provider check is
// dropped and re-created with the full list (the lesson of 037: a live
// constraint the chain no longer defines can linger in production, so a
// plain add would leave the old list in force).
//
// This migration re-created the constraint with the six providers of
// its time. A shipped migration is never edited, so this test pins that
// historical list; the current list is pinned by the latest migration
// that re-creates the check (052, threespeak-provider-migration.test.ts)
// and by the schema snapshot (migration-check-constraints-sync.test.ts).
// The provider list is FROZEN at the six providers 049 shipped with.
// A migration file is append-only history — its list never grows.
//---------------

// The six providers 049 shipped with, in the order the migration lists them.
const PROVIDERS_AT_049 = ['youtube', 'instagram', 'bluesky', 'linkedin', 'threads', 'facebook'];

const sql = readFileSync(
  join(findRepoRoot(import.meta.url), 'supabase', 'migrations', '049_facebook-provider.sql'),
  'utf8',
);

function checkProviders(constraint: string): string[] {
  const start = sql.indexOf(`add constraint ${constraint}`);
  expect(start, `${constraint} must be added`).toBeGreaterThanOrEqual(0);
  const match = /check \(provider in \(([^)]*)\)\)/.exec(sql.slice(start));
  if (match === null) throw new Error(`${constraint} must declare a provider list`);
  return match[1].split(',').map((entry) => entry.trim().replace(/^'|'$/g, ''));
}

describe('supabase/migrations/049_facebook-provider.sql', () => {
  it('adds the schedules facebook account column with an empty default', () => {
    expect(sql).toContain("add column if not exists facebook_account_ids text[] not null default '{}'");
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
    '%s allows exactly the providers 049 shipped with',
    (constraint) => {
      expect(checkProviders(constraint).sort()).toEqual([...PROVIDERS_AT_049].sort());
    },
  );

  it.each(['post_metrics_provider_check', 'social_accounts_provider_check'])(
    '%s lists only providers the app still supports',
    (constraint) => {
      for (const provider of checkProviders(constraint)) expect(SOCIAL_PROVIDERS).toContain(provider);
    },
  );
});

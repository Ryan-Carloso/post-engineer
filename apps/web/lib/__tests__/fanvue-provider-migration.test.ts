import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

//---------------
// supabase/migrations/057_fanvue-provider.sql — the schema the Fanvue
// connect and publish paths depend on. Each provider check is dropped and
// re-created with the full list (the lesson of 037: a live constraint the
// chain no longer defines can linger in production, so a plain add would
// leave the old list in force). A shipped migration is never edited, so
// this test pins the ten providers 057 shipped with; the file is frozen,
// so it must NOT track SOCIAL_PROVIDERS. Fanvue needs no board: a video
// publishes to the account. The PKCE code_verifier rides oauth_states so
// the MCP connect-url flow can complete the code exchange.
//---------------

// The ten providers 057 shipped with, in the order the migration lists them.
const PROVIDERS_AT_057 = ['youtube', 'instagram', 'bluesky', 'linkedin', 'threads', 'facebook', 'pinterest', '3speak', 'rumble', 'fanvue'];

const sql = readFileSync(
  join(findRepoRoot(import.meta.url), 'supabase', 'migrations', '057_fanvue-provider.sql'),
  'utf8',
);

function checkProviders(constraint: string): string[] {
  const start = sql.indexOf(`add constraint ${constraint}`);
  expect(start, `${constraint} must be added`).toBeGreaterThanOrEqual(0);
  const match = /check \(provider in \(([^)]*)\)\)/.exec(sql.slice(start));
  if (match === null) throw new Error(`${constraint} must declare a provider list`);
  return match[1].split(',').map((entry) => entry.trim().replace(/^'|'$/g, ''));
}

describe('supabase/migrations/057_fanvue-provider.sql', () => {
  it('adds the schedules fanvue account column with an empty default', () => {
    expect(sql).toContain("add column if not exists fanvue_account_ids text[] not null default '{}'");
  });

  it('adds no board column: Fanvue publishes to the account, not a board', () => {
    expect(sql).not.toContain('fanvue_board_id');
  });

  it('adds the nullable oauth_states code_verifier column for the PKCE flow', () => {
    expect(sql).toContain('add column if not exists code_verifier text');
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
    '%s allows exactly the providers 057 shipped with',
    (constraint) => {
      expect(checkProviders(constraint).sort()).toEqual([...PROVIDERS_AT_057].sort());
    },
  );
});

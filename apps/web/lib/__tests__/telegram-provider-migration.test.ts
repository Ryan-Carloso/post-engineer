import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

//---------------
// supabase/migrations/070_telegram-provider.sql — the schema the Telegram
// connect and publish paths depend on. Each provider check is dropped and
// re-created with the full list (the lesson of 037: a live constraint the
// chain no longer defines can linger in production, so a plain add would
// leave the old list in force). A shipped migration is never edited, so
// this test pins the eleven providers 070 shipped with; the file is
// frozen, so it must NOT track SOCIAL_PROVIDERS. Channel and group are
// one provider: the chat kind lives in account_metadata, never in the
// provider value, so no 'telegram_channel' / 'telegram_group' appears.
//---------------

// The eleven providers 070 shipped with, in the order the migration lists them.
const PROVIDERS_AT_070 = ['youtube', 'instagram', 'bluesky', 'linkedin', 'threads', 'facebook', 'pinterest', '3speak', 'rumble', 'fanvue', 'telegram'];

const sql = readFileSync(
  join(findRepoRoot(import.meta.url), 'supabase', 'migrations', '070_telegram-provider.sql'),
  'utf8',
);

function checkProviders(constraint: string): string[] {
  const start = sql.indexOf(`add constraint ${constraint}`);
  expect(start, `${constraint} must be added`).toBeGreaterThanOrEqual(0);
  const match = /check \(provider in \(([^)]*)\)\)/.exec(sql.slice(start));
  if (match === null) throw new Error(`${constraint} must declare a provider list`);
  return match[1].split(',').map((entry) => entry.trim().replace(/^'|'$/g, ''));
}

describe('supabase/migrations/070_telegram-provider.sql', () => {
  it('adds the schedules telegram account column with an empty default', () => {
    expect(sql).toContain("add column if not exists telegram_account_ids text[] not null default '{}'");
  });

  it('keeps channel and group as one provider value', () => {
    expect(sql).not.toContain('telegram_channel');
    expect(sql).not.toContain('telegram_group');
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
    '%s allows exactly the providers 070 shipped with',
    (constraint) => {
      expect(checkProviders(constraint)).toEqual(PROVIDERS_AT_070);
    },
  );
});

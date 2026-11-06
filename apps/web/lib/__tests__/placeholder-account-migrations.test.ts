// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';
import { isPlaceholderProviderAccountId } from '../social-accounts';

const root = findRepoRoot(import.meta.url);
const read = (name: string): string => readFileSync(join(root, 'supabase/migrations', name), 'utf8');

//---------------
// The 'unknown' placeholder account id is cleaned from two tables:
// social_accounts (036) and persona_default_accounts (038, which has no FK to
// the first, so 036 alone left dangling defaults). Both migrations must use
// the same predicate as isPlaceholderProviderAccountId, or one of the three
// places drifts and a placeholder survives.
//---------------
describe('placeholder account id cleanup migrations', () => {
  const PREDICATE = "lower(btrim(provider_account_id)) in ('unknown', '')";

  it('036 deletes the placeholder rows from social_accounts', () => {
    const sql = read('036_drop-unknown-social-accounts.sql');
    expect(sql).toContain('delete from public.social_accounts');
    expect(sql).toContain(PREDICATE);
  });

  it('038 deletes the dangling placeholder defaults from persona_default_accounts', () => {
    const sql = read('038_drop-placeholder-persona-default-accounts.sql');
    expect(sql).toContain('delete from public.persona_default_accounts');
    expect(sql).toContain(PREDICATE);
  });

  it('038 only deletes placeholder rows, never a whole table or a real account id', () => {
    const sql = read('038_drop-placeholder-persona-default-accounts.sql');
    const statements = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(statements).toMatch(/where\s+lower\(btrim\(provider_account_id\)\)/);
    expect(statements).not.toMatch(/truncate|drop\s+table/i);
  });

  it('the app-side guard and the SQL predicate agree on what a placeholder is', () => {
    for (const id of ['unknown', 'UNKNOWN', ' unknown ', '', '  ']) {
      expect(isPlaceholderProviderAccountId(id)).toBe(true);
    }
    for (const id of ['UC123', 'did:plc:abc', 'unknown-channel']) {
      expect(isPlaceholderProviderAccountId(id)).toBe(false);
    }
  });
});

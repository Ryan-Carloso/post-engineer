import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { SOCIAL_PROVIDERS } from '../providers/registry';

describe('supabase/migrations/022_persona-default-accounts.sql literals', () => {
  it('keeps the SQL in sync with the app contract', () => {
    // The app reads/writes persona_default_accounts through the Supabase
    // client with literal table/column names; a one-sided change would
    // silently desynchronize. This test parses the migration and asserts
    // the shape the lib depends on.
    const sql = readFileSync(
      join(
        findRepoRoot(import.meta.url),
        'supabase',
        'migrations',
        '022_persona-default-accounts.sql',
      ),
      'utf8',
    );

    // Table + columns the lib selects/inserts.
    expect(sql).toMatch(/create table if not exists public\.persona_default_accounts/i);
    expect(sql).toMatch(/persona_id uuid not null references public\.personas\(id\) on delete cascade/i);
    expect(sql).toMatch(/provider text not null/i);
    expect(sql).toMatch(/provider_account_id text not null/i);
    // One row per (persona, provider, account): the PK is the dedupe.
    expect(sql).toMatch(/primary key \(persona_id, provider, provider_account_id\)/i);

    // RLS is enabled with an owner-only policy verified through the
    // persona's user_id (the table itself carries no user_id column).
    expect(sql).toMatch(/alter table public\.persona_default_accounts enable row level security/i);
    expect(sql).toMatch(/persona_default_accounts_owner_all/);
    expect(sql).toMatch(/p\.user_id = auth\.uid\(\)/);

    // The per-provider lookup index the fallback query needs.
    expect(sql).toMatch(/persona_default_accounts_persona_provider_idx/);

    // Sanity: the providers the app writes are the registry's providers.
    expect(SOCIAL_PROVIDERS).toContain('youtube');
    expect(SOCIAL_PROVIDERS).toContain('bluesky');
  });
});

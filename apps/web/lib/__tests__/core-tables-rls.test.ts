import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

//---------------
// 066_core-tables-rls.sql — least privilege for the 001 core tables.
// A `for all` owner policy plus Supabase's default table grant lets a
// logged-in user write billing columns through PostgREST (issue #464
// review). This pins the policy shape and the column grants. Restoring
// `for all` on user_profiles fails here even when a column revoke would
// still deny the write.
//---------------

const repoRoot = findRepoRoot(import.meta.url);
const migrationPath = join(repoRoot, 'supabase', 'migrations', '066_core-tables-rls.sql');
const retiredPath = join(repoRoot, 'supabase', 'migrations', '065_core-tables-rls.sql');

const OWNER_TABLES = [
  'user_profiles',
  'personas',
  'schedules',
  'scheduled_posts',
  'social_accounts',
  'video_generations',
  'token_transactions',
] as const;

const EXPECTED_POLICIES = [
  'user_profiles_select_own',
  'personas_select_own',
  'personas_insert_own',
  'personas_update_own',
  'personas_delete_own',
  'schedules_select_own',
  'schedules_delete_own',
  'scheduled_posts_select_own',
  'scheduled_posts_update_own',
  'scheduled_posts_delete_own',
  'social_accounts_select_own',
  'social_accounts_insert_own',
  'social_accounts_update_own',
  'social_accounts_delete_own',
  'video_generations_select_own',
  'video_generations_delete_own',
  'token_transactions_select_own',
] as const;

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

function policyStatements(sql: string): string[] {
  return stripSqlComments(sql).match(/create policy\b[\s\S]*?;/gi) ?? [];
}

describe('066_core-tables-rls.sql least privilege', () => {
  const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
  const body = stripSqlComments(sql);
  const flat = body.replace(/\s+/g, ' ').toLowerCase();
  const policies = policyStatements(sql);

  it('lives at 066 because 065 is the definer-function grants migration', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(retiredPath)).toBe(false);
    const readme = readFileSync(join(repoRoot, 'supabase', 'README.md'), 'utf8');
    expect(readme).toContain('066_core-tables-rls.sql');
    expect(readme).not.toContain('065_core-tables-rls.sql');
  });

  it('creates one authenticated policy per session operation and no for all policy', () => {
    expect(policies).toHaveLength(EXPECTED_POLICIES.length);
    const names = policies.map((statement) => {
      const match = statement.match(/create policy\s+(\w+)/i);
      return match?.[1] ?? '';
    });
    expect(names.sort()).toEqual([...EXPECTED_POLICIES].sort());
    for (const statement of policies) {
      const normalized = statement.replace(/\s+/g, ' ').toLowerCase();
      expect(normalized).toContain('to authenticated');
      expect(normalized).not.toMatch(/\bfor all\b/);
      expect(normalized).not.toContain('to anon');
      expect(normalized).not.toContain('to public');
    }
    expect(flat).not.toMatch(/\bfor all\b/);
  });

  it('enables RLS on every 001 core table the policies cover', () => {
    for (const table of OWNER_TABLES) {
      expect(flat).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it('lets authenticated read user_profiles and never write balances or stripe columns', () => {
    expect(flat).toContain('revoke all on table public.user_profiles from anon, authenticated');
    expect(flat).toContain('grant select on table public.user_profiles to authenticated');
    expect(flat).not.toMatch(
      /grant\s+(insert|update|delete|all)\b[^;]*\bon\s+table\s+public\.user_profiles\s+to\s+authenticated/,
    );
    expect(policies.filter((statement) => /on\s+public\.user_profiles/i.test(statement))).toHaveLength(1);
    expect(flat).toContain('create policy user_profiles_select_own on public.user_profiles for select to authenticated');
  });

  it('lets authenticated update only scheduled_posts.title and slot_at', () => {
    expect(flat).toContain('revoke all on table public.scheduled_posts from anon, authenticated');
    expect(flat).toContain('grant select on table public.scheduled_posts to authenticated');
    expect(flat).toContain('grant delete on table public.scheduled_posts to authenticated');
    expect(flat).toContain(
      'grant update (title, slot_at) on table public.scheduled_posts to authenticated',
    );
    expect(flat).not.toMatch(
      /grant\s+update\s*\([^)]*(charged_tokens|discount_tokens|status|task_id|batch_id)/,
    );
    expect(flat).not.toMatch(
      /grant\s+(insert|all)\b[^;]*\bon\s+table\s+public\.scheduled_posts\s+to\s+authenticated/,
    );
  });

  it('hides social_accounts.encrypted_tokens from authenticated selects', () => {
    const selectGrant = flat.match(
      /grant select \([^)]*\) on table public\.social_accounts to authenticated/,
    )?.[0];
    expect(selectGrant).toBeDefined();
    expect(selectGrant).not.toContain('encrypted_tokens');
    expect(selectGrant).toContain('account_metadata');
    expect(selectGrant).toContain('last_used_at');
    expect(flat).toContain(
      'grant insert, update, delete on table public.social_accounts to authenticated',
    );
  });

  it('keeps token_transactions select-only for authenticated', () => {
    expect(flat).toContain('revoke all on table public.token_transactions from anon, authenticated');
    expect(flat).toContain('grant select on table public.token_transactions to authenticated');
    expect(flat).not.toMatch(
      /grant\s+(insert|update|delete|all)\b[^;]*\bon\s+table\s+public\.token_transactions\s+to\s+authenticated/,
    );
    const ledgerPolicies = policies.filter((statement) => /token_transactions/i.test(statement));
    expect(ledgerPolicies).toHaveLength(1);
    expect(ledgerPolicies[0].replace(/\s+/g, ' ').toLowerCase()).toContain('for select to authenticated');
  });

  it('does not grant video_generations writes or schedule inserts to authenticated', () => {
    expect(flat).toContain('grant select, delete on table public.video_generations to authenticated');
    expect(flat).not.toMatch(
      /grant\s+(insert|update|all)\b[^;]*\bon\s+table\s+public\.video_generations\s+to\s+authenticated/,
    );
    expect(flat).toContain('grant select, delete on table public.schedules to authenticated');
    expect(flat).not.toMatch(
      /grant\s+(insert|update|all)\b[^;]*\bon\s+table\s+public\.schedules\s+to\s+authenticated/,
    );
    expect(flat).toContain(
      'grant select, insert, update, delete on table public.personas to authenticated',
    );
  });
});

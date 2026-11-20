import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

const repoRoot = findRepoRoot(import.meta.url);

function read(...segments: string[]): string {
  return readFileSync(join(repoRoot, ...segments), 'utf8');
}

const sql = read('supabase', 'migrations', '076_user-prompts.sql');

describe('supabase/migrations/076_user-prompts.sql', () => {
  it('creates the table idempotently with a private default', () => {
    expect(sql).toContain('create table if not exists public.user_prompts');
    expect(sql).toContain("visibility text not null default 'private'");
    expect(sql).toContain("check (visibility in ('private', 'public'))");
  });

  it('is service-role only: RLS on, no policy, grants revoked from session roles', () => {
    expect(sql).toContain('alter table public.user_prompts enable row level security');
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql).toContain('revoke all on table public.user_prompts from anon, authenticated');
  });

  it('keeps public slugs globally unique with a partial unique index', () => {
    expect(sql).toContain('create unique index if not exists user_prompts_public_slug_unique');
    expect(sql).toMatch(/\(slug\)\s+where visibility = 'public'/);
  });

  it('has no review columns, since publishing needs no approval in beta', () => {
    for (const column of ['status', 'approved_hash', 'content_hash', 'reviewed_by', 'rejection_reason']) {
      expect(sql, column).not.toMatch(new RegExp(`\\b${column}\\b\\s+(text|uuid|timestamptz)`));
    }
  });

  it('is listed in the migration README and exercised by the CI behaviour check', () => {
    expect(read('supabase', 'README.md')).toContain('`migrations/076_user-prompts.sql`');
    expect(read('.github', 'workflows', 'ci.yml')).toContain('scripts/db/check-user-prompts.sql');
    expect(read('scripts', 'db', 'check-user-prompts.sql')).toContain('two public prompts cannot share a slug');
  });
});

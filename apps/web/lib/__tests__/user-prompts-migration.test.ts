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
  it('creates the table idempotently with a private default status', () => {
    expect(sql).toContain('create table if not exists public.user_prompts');
    expect(sql).toContain("status text not null default 'private'");
    expect(sql).toContain("check (status in ('private', 'pending', 'approved', 'rejected'))");
  });

  it('is service-role only: RLS on, no policy, grants revoked from session roles', () => {
    expect(sql).toContain('alter table public.user_prompts enable row level security');
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql).toContain('revoke all on table public.user_prompts from anon, authenticated');
  });

  it('keeps approved slugs globally unique with a partial unique index', () => {
    expect(sql).toContain('create unique index if not exists user_prompts_approved_slug_unique');
    expect(sql).toMatch(/\(slug\)\s+where status = 'approved'/);
  });

  it('ties the approved status to an approved hash and a decision to a reviewer', () => {
    expect(sql).toContain("check ((status = 'approved') = (approved_hash is not null))");
    expect(sql).toContain("check (status not in ('approved', 'rejected') or (reviewed_by is not null and reviewed_at is not null))");
    expect(sql).toContain("check (status <> 'rejected' or rejection_reason is not null)");
  });

  it('hashes title, description and body with length prefixes in a before-write trigger', () => {
    expect(sql).toContain('create trigger user_prompts_before_write');
    expect(sql).toContain('before insert or update on public.user_prompts');
    expect(sql).toContain('length(new.title)::text');
    expect(sql).toContain('length(new.description)::text');
    expect(sql).toContain('length(new.body)::text');
  });

  it('sends an edited approved prompt back to pending and clears the approval', () => {
    expect(sql).toContain("new.status := 'pending'");
    expect(sql).toContain('new.approved_hash := null');
    expect(sql).toContain('new.reviewed_by := null');
    expect(sql).toContain('new.reviewed_at := null');
  });

  it('is listed in the migration README and exercised by the CI behaviour check', () => {
    expect(read('supabase', 'README.md')).toContain('`migrations/076_user-prompts.sql`');
    const workflow = read('.github', 'workflows', 'ci.yml');
    expect(workflow).toContain('scripts/db/check-user-prompts.sql');
    expect(read('scripts', 'db', 'check-user-prompts.sql')).toContain('editing an approved prompt sends it back to pending');
  });
});

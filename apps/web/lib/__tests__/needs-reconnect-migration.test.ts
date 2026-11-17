import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { findRepoRoot } from '@/test/repo-root';

const repoRoot = findRepoRoot(import.meta.url);
const sql = readFileSync(join(repoRoot, 'supabase', 'migrations', '069_social-accounts-needs-reconnect.sql'), 'utf8');
const readme = readFileSync(join(repoRoot, 'supabase', 'README.md'), 'utf8');

describe('069_social-accounts-needs-reconnect.sql', () => {
  const flat = sql.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').toLowerCase();

  it('adds needs_reconnect idempotently and grants the session read', () => {
    expect(flat).toContain('add column if not exists needs_reconnect boolean not null default false');
    expect(flat).toContain('grant select (needs_reconnect) on table public.social_accounts to authenticated');
    expect(flat).not.toMatch(/grant\s+(insert|update|delete|all)\b/);
  });

  it('is listed in supabase/README.md', () => {
    expect(readme).toContain('069_social-accounts-needs-reconnect.sql');
  });
});

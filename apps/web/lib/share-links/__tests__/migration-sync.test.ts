// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RANGE_STATUSES } from '@/lib/contracts/schedule';
import { findRepoRoot } from '@/test/repo-root';

const root = findRepoRoot(import.meta.url);
const read = (...parts: string[]): string => readFileSync(join(root, ...parts), 'utf8');

const migration = read('supabase', 'migrations', '080_share-links.sql');
const latestShareWeekPosts = read('supabase', 'migrations', '087_remove-generation-and-tokens.sql');

function functionBody(name: string, source = migration): string {
  const start = source.indexOf(`create or replace function public.${name}(`);
  const end = source.indexOf('$$;', source.indexOf('as $$', start));
  return source.slice(start, end);
}

function paramNames(name: string): string[] {
  const body = functionBody(name);
  const signature = body.slice(body.indexOf('(') + 1, body.indexOf('returns'));
  return [...signature.matchAll(/\b(p_[a-z_]+)\s/g)].map((match) => match[1]);
}

describe('080_share-links migration', () => {
  it('lists in the latest share_week_posts exactly the statuses the schedule contract treats as listable', () => {
    const match = /sp\.status in \(([^)]*)\)/.exec(functionBody('share_week_posts', latestShareWeekPosts));
    const statuses = [...(match?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((item) => item[1]);
    expect(statuses).toEqual([...RANGE_STATUSES]);
  });

  it('keeps the SQL argument names the code calls create_share_link with', () => {
    const source = read('apps', 'web', 'app', 'api', 'share-links', 'route.ts');
    const names = paramNames('create_share_link');
    expect(names).toEqual(['p_user_id', 'p_token_hash', 'p_persona_ids', 'p_expires_at', 'p_max']);
    for (const name of names) expect(source).toContain(`${name}:`);
  });

  it('keeps the SQL argument names the code calls share_week_posts with', () => {
    const source = read('apps', 'web', 'lib', 'share-links', 'share-view.ts');
    const names = paramNames('share_week_posts');
    expect(names).toEqual(['p_user_id', 'p_persona_ids', 'p_from', 'p_to', 'p_limit']);
    for (const name of names) expect(source).toContain(`${name}:`);
  });

  it('never grants the browser roles a column that holds the token hash', () => {
    const grants = [...migration.matchAll(/grant (?:select|update) \(([^)]*)\)/g)].map((match) => match[1]);
    expect(grants.length).toBeGreaterThan(0);
    for (const columns of grants) expect(columns).not.toContain('token_hash');
  });

  it('is pinned by a CI behaviour check, the README and the schema snapshot', () => {
    expect(read('.github', 'workflows', 'ci.yml')).toContain('scripts/db/check-share-links.sql');
    expect(read('scripts', 'db', 'check-share-links.sql')).toContain('a scoped link reads only the posts of its personas');
    expect(read('supabase', 'README.md')).toContain('migrations/080_share-links.sql');
    const snapshot = JSON.parse(read('supabase', 'schema.snapshot.json')) as {
      tables: Record<string, { rls: boolean; columns: Array<{ name: string; notNull: boolean }>; constraints: Record<string, string> }>;
    };
    const table = snapshot.tables.share_links;
    expect(table.rls).toBe(true);
    expect(table.columns.find((column) => column.name === 'token_hash')?.notNull).toBe(true);
    expect(Object.values(table.constraints).some((definition) => definition === 'UNIQUE (token_hash)')).toBe(true);
  });
});

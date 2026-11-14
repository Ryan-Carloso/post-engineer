// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';

// supabase-js resolves `.rpc('name')` by the exact Postgres function name, and
// a mocked test would happily pin a wrong one. A mechanical rename once swept
// `create_experiment` into a tool label inside `.rpc(...)` (PR #586 review):
// every literal `.rpc('x')` in the app must name a function a migration defines.
const root = findRepoRoot(import.meta.url);

// Functions the live database has but the migration chain does not create
// (supabase/migrations/001_schema.sql lists them as pre-existing objects).
const DEFINED_OUTSIDE_THE_CHAIN = new Set(['grant_signup_bonus', 'credit_tokens_for_payment', 'spend_tokens', 'refund_generation_tokens']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

function rpcNames(): Set<string> {
  const names = new Set<string>();
  for (const base of ['app', 'lib']) {
    for (const file of sourceFiles(join(root, 'apps', 'web', base))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/\.rpc\(\s*'([^']+)'/g)) names.add(match[1] ?? '');
    }
  }
  return names;
}

function migratedFunctions(): Set<string> {
  const dir = join(root, 'supabase', 'migrations');
  expect(existsSync(dir)).toBe(true);
  const names = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.sql')) continue;
    for (const match of readFileSync(join(dir, file), 'utf8').matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi)) {
      names.add((match[1] ?? '').toLowerCase());
    }
  }
  return names;
}

describe('supabase rpc names', () => {
  it('finds the rpc calls and the migrated functions', () => {
    expect(rpcNames().size).toBeGreaterThan(5);
    expect(migratedFunctions().has('create_experiment')).toBe(true);
    expect(rpcNames().has('create_experiment')).toBe(true);
  });

  it('lists outside-the-chain functions only while 001_schema.sql still names them', () => {
    const schema = readFileSync(join(root, 'supabase', 'migrations', '001_schema.sql'), 'utf8');
    for (const name of DEFINED_OUTSIDE_THE_CHAIN) expect(schema, name).toContain(`public.${name}`);
  });

  it('names a function a migration defines in every literal .rpc(...) call', () => {
    const functions = migratedFunctions();
    const unknown = [...rpcNames()].filter((name) => !functions.has(name.toLowerCase()) && !DEFINED_OUTSIDE_THE_CHAIN.has(name));
    expect(unknown).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { SOCIAL_PROVIDERS } from '@/lib/providers/registry';
import { GENERATION_PUBLISH_MODES } from '@/lib/generation/video-generation';

//---------------
// Every `check (<col> in ('a', 'b'))` constraint in supabase/migrations
// must match the TypeScript list the code accepts for that column.
//
// Why: Threads shipped with a provider list in SOCIAL_PROVIDERS, but the
// `social_accounts_provider_check` constraint (created by hand in
// production, absent from the migrations) never listed it, so every
// connect failed at the upsert. Typecheck cannot see the database, unit
// tests mock Supabase, and CI applies the chain to an empty Postgres where
// the hand-made constraint does not exist. This test closes the
// repo-visible half of that gap, for ALL enum-like checks, not only
// providers:
//
//   1. every enum check found in the migrations is registered below, so
//      a new constraint cannot land without a pinned expected list;
//   2. each registered constraint exists in the migrations (so one that
//      only lives in production is caught the moment it is registered);
//   3. the final list (after every drop/add) equals the code's list.
//
// Limits: a constraint created by hand in production and never written
// as a migration stays invisible to CI. The fix is always a migration
// that drops and recreates it (see 036_social-accounts-threads.sql).
//---------------

const repoRoot = findRepoRoot(import.meta.url);
const migrationsDir = join(repoRoot, 'supabase', 'migrations');

interface EnumCheck {
  table: string;
  column: string;
  values: string[];
  file: string;
}

function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const index = line.indexOf('--');
      return index === -1 ? line : line.slice(0, index);
    })
    .join('\n');
}

function parseValues(list: string): string[] {
  return list
    .split(',')
    .map((part) => part.trim().replace(/^'|'$/g, ''))
    .filter((value) => value !== '');
}

// Inline `col type ... check (col in (...))` inside a create table takes the
// auto name `<table>_<col>_check`; `add constraint <name> check (...)` names
// it explicitly. A later add (after a drop) replaces the earlier definition,
// so the map ends up holding what the chain leaves behind.
function collectEnumChecks(): Map<string, EnumCheck> {
  const checks = new Map<string, EnumCheck>();
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = stripSqlComments(readFileSync(join(migrationsDir, file), 'utf8'));
    const events: Array<{ index: number; run: () => void }> = [];

    const tableAt: Array<{ index: number; name: string }> = [];
    for (const match of sql.matchAll(/create table(?: if not exists)?\s+(?:public\.)?(\w+)/gi)) {
      tableAt.push({ index: match.index ?? 0, name: match[1] });
    }
    const tableBefore = (index: number): string => {
      let found = '';
      for (const table of tableAt) if (table.index < index) found = table.name;
      return found;
    };

    for (const match of sql.matchAll(/(\w+)\s+text\b[^,;]*?check\s*\(\s*\1\s+in\s*\(([^)]*)\)\s*\)/gi)) {
      const table = tableBefore(match.index ?? 0);
      const column = match[1];
      const name = `${table}_${column}_check`;
      events.push({
        index: match.index ?? 0,
        run: () => checks.set(name, { table, column, values: parseValues(match[2]), file }),
      });
    }

    for (const match of sql.matchAll(
      /add constraint\s+(\w+)\s+check\s*\(\s*(\w+)\s+in\s*\(([^)]*)\)\s*\)/gi,
    )) {
      const name = match[1];
      const column = match[2];
      const table = name.endsWith(`_${column}_check`) ? name.slice(0, -`_${column}_check`.length) : tableBefore(match.index ?? 0);
      events.push({
        index: match.index ?? 0,
        run: () => checks.set(name, { table, column, values: parseValues(match[3]), file }),
      });
    }

    for (const match of sql.matchAll(/drop constraint(?: if exists)?\s+(\w+)/gi)) {
      events.push({ index: match.index ?? 0, run: () => checks.delete(match[1]) });
    }

    events.sort((a, b) => a.index - b.index).forEach((event) => event.run());
  }
  return checks;
}

// constraint name -> what the code accepts. A literal list needs a comment
// naming the TS source it mirrors.
const EXPECTED: Record<string, readonly string[]> = {
  social_accounts_provider_check: SOCIAL_PROVIDERS,
  post_metrics_provider_check: SOCIAL_PROVIDERS,
  schedules_publish_mode_check: GENERATION_PUBLISH_MODES,
  video_generations_publish_mode_check: GENERATION_PUBLISH_MODES,
  // Mirrors z.enum(['broll', 'svg']) in app/api/videos/generate-and-schedule/route.ts.
  scheduled_posts_faceless_material_check: ['broll', 'svg'],
  // Mirrors the window options in app/(main)/metrics/page.tsx.
  post_metrics_metrics_window_check: ['24h', '7d'],
  post_metrics_done_metrics_window_check: ['24h', '7d'],
  // Mirrors the cloned-voice status values written by the voices routes.
  cloned_voices_status_check: ['pending', 'ready', 'failed'],
};

describe('migration enum checks match the code', () => {
  const checks = collectEnumChecks();

  it('parses the known constraints (the parser is not vacuous)', () => {
    expect(checks.size).toBeGreaterThanOrEqual(Object.keys(EXPECTED).length);
    expect(checks.get('post_metrics_provider_check')?.values).toContain('threads');
  });

  it('registers every enum check found in the migrations', () => {
    const unregistered = [...checks.keys()].filter((name) => !(name in EXPECTED));
    expect(unregistered, `add these to EXPECTED with the TS list they mirror: ${unregistered.join(', ')}`).toEqual([]);
  });

  it('has a migration-defined constraint for every registered name', () => {
    const missing = Object.keys(EXPECTED).filter((name) => !checks.has(name));
    expect(missing, `no migration creates: ${missing.join(', ')}`).toEqual([]);
  });

  for (const [name, expected] of Object.entries(EXPECTED)) {
    it(`${name} accepts exactly what the code accepts`, () => {
      const check = checks.get(name);
      expect(check, `${name} is not defined by any migration`).toBeDefined();
      expect([...(check?.values ?? [])].sort()).toEqual([...expected].sort());
    });
  }
});

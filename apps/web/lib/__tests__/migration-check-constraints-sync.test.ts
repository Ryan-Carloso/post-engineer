import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { SOCIAL_PROVIDERS } from '@/lib/providers/registry';
import { FACELESS_MATERIALS } from '@/lib/generation/faceless-materials';
import { GENERATION_PUBLISH_MODES } from '@/lib/generation/video-generation';
import { ANALYTICS_STATUSES, METRICS_WINDOWS } from '@/lib/metrics/metrics-query';
import { VIDEO_LAYOUTS } from '@/lib/persona-schema';

//---------------
// Every enum-like CHECK constraint the database really has must match the
// TypeScript list the code accepts for that column.
//
// Why: Threads shipped with a provider list in SOCIAL_PROVIDERS, but the
// `social_accounts_provider_check` constraint (created by hand in
// production, absent from the migrations) never listed it, so every
// connect failed at the upsert. Typecheck cannot see the database and unit
// tests mock Supabase.
//
// The source of truth is supabase/schema.snapshot.json: Postgres's own
// report of the schema after the whole migration chain is applied (CI
// regenerates it on an ephemeral Postgres and fails when it is stale, see
// scripts/db/dump-schema.mjs). Reading what the database reports, instead
// of parsing SQL, honors every drop/add and every `do $$ ... if not exists`
// guard exactly as Postgres does. This test then pins:
//
//   1. every enum check (`col = ANY (ARRAY[...])`) found in the snapshot
//      is registered below, so a new constraint cannot land without a
//      pinned expected list;
//   2. every registered constraint exists in the snapshot;
//   3. the database list equals the code's list.
//
// Limit: a constraint created by hand in production and never written as a
// migration is invisible to CI. The fix is always a migration that drops
// and recreates it (see 037_social-accounts-threads-provider.sql).
//---------------

interface SnapshotTable {
  constraints: Record<string, string>;
}

interface Snapshot {
  tables: Record<string, SnapshotTable>;
}

interface EnumCheck {
  table: string;
  column: string;
  values: string[];
}

const repoRoot = findRepoRoot(import.meta.url);
const snapshot = JSON.parse(readFileSync(join(repoRoot, 'supabase', 'schema.snapshot.json'), 'utf8')) as Snapshot;

function parseEnumChecks(): Map<string, EnumCheck> {
  const checks = new Map<string, EnumCheck>();
  for (const [table, definition] of Object.entries(snapshot.tables)) {
    for (const [name, text] of Object.entries(definition.constraints)) {
      if (!text.startsWith('CHECK')) continue;
      const match = /(\w+) = ANY \(ARRAY\[([^\]]*)\]\)/.exec(text);
      if (match === null) continue;
      const values = [...match[2].matchAll(/'([^']*)'::text/g)].map((value) => value[1]);
      checks.set(name, { table, column: match[1], values });
    }
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
  personas_video_layout_check: VIDEO_LAYOUTS,
  scheduled_posts_faceless_material_check: FACELESS_MATERIALS,
  post_metrics_metrics_window_check: METRICS_WINDOWS,
  post_metrics_done_metrics_window_check: METRICS_WINDOWS,
  post_metrics_analytics_status_check: ANALYTICS_STATUSES,
  // No TypeScript list exists: the status is written by the engine voice
  // registration, so this literal is the pinned contract.
  cloned_voices_status_check: ['pending', 'ready', 'failed'],
};

describe('database enum checks match the code', () => {
  const checks = parseEnumChecks();

  it('parses the known constraints (the parser is not vacuous)', () => {
    expect(checks.size).toBeGreaterThanOrEqual(Object.keys(EXPECTED).length);
    expect(checks.get('social_accounts_provider_check')?.values).toContain('threads');
  });

  it('registers every enum check the database has', () => {
    const unregistered = [...checks.keys()].filter((name) => !(name in EXPECTED));
    expect(unregistered, `add these to EXPECTED with the TS list they mirror: ${unregistered.join(', ')}`).toEqual([]);
  });

  it('finds every registered constraint in the snapshot', () => {
    const missing = Object.keys(EXPECTED).filter((name) => !checks.has(name));
    expect(missing, `no migration creates: ${missing.join(', ')}`).toEqual([]);
  });

  for (const [name, expected] of Object.entries(EXPECTED)) {
    it(`${name} accepts exactly what the code accepts`, () => {
      const check = checks.get(name);
      expect(check, `${name} is not in the schema snapshot`).toBeDefined();
      expect([...(check?.values ?? [])].sort()).toEqual([...expected].sort());
    });
  }
});

describe('upsert targets have their unique key', () => {
  // upsertSocialAccount plans ON CONFLICT (user_id, provider,
  // provider_account_id): without this key Postgres refuses the
  // statement (42P10) on any database built from the migration chain.
  it('social_accounts has the unique key the upsert targets', () => {
    expect(snapshot.tables.social_accounts.constraints['social_accounts_user_provider_account_key']).toBe(
      'UNIQUE (user_id, provider, provider_account_id)',
    );
  });
});

// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

interface SnapshotColumn {
  name: string;
  type: string;
  notNull: boolean;
  default: string | null;
}

interface SnapshotTable {
  rls: boolean;
  columns: SnapshotColumn[];
  constraints: Record<string, string>;
  policies: Record<string, { cmd: string; qual: string | null }>;
}

const root = findRepoRoot(import.meta.url);
const snapshot = JSON.parse(readFileSync(join(root, 'supabase', 'schema.snapshot.json'), 'utf8')) as {
  tables: Record<string, SnapshotTable>;
};
const table = snapshot.tables.post_metrics_daily;
const collectorSource = readFileSync(join(root, 'apps', 'web', 'lib', 'metrics', 'post-metrics-daily.ts'), 'utf8');
const migration = readFileSync(join(root, 'supabase', 'migrations', '079_post-metrics-daily.sql'), 'utf8');

function upsertedKeys(): string[] {
  const block = /upsert\(\s*\{([\s\S]*?)\},\s*\{ onConflict/.exec(collectorSource);
  expect(block, 'the collector upsert was not found').not.toBeNull();
  return [...(block?.[1] ?? '').matchAll(/^\s+([a-z_]+):/gm)].map((match) => match[1]);
}

describe('post_metrics_daily schema sync', () => {
  it('is in the schema snapshot with row level security on', () => {
    expect(table).toBeDefined();
    expect(table.rls).toBe(true);
  });

  it('only upserts columns that exist', () => {
    const columns = new Set(table.columns.map((column) => column.name));
    const keys = upsertedKeys();
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) expect(columns.has(key), `${key} is not a post_metrics_daily column`).toBe(true);
  });

  it('supplies every NOT NULL column that has no default', () => {
    const keys = new Set(upsertedKeys());
    const required = table.columns.filter((column) => column.notNull && column.default === null).map((c) => c.name);
    expect(required.length).toBeGreaterThan(3);
    for (const name of required) expect(keys.has(name), `${name} is NOT NULL without default`).toBe(true);
  });

  it('declares the unique key the collector upserts on', () => {
    expect(table.constraints.post_metrics_daily_post_id_provider_external_id_snapshot_da_key).toBe(
      'UNIQUE (post_id, provider, external_id, snapshot_date)',
    );
    expect(collectorSource).toContain("onConflict: 'post_id,provider,external_id,snapshot_date'");
  });

  it('cascades from the post and keeps counters nullable with a date-typed snapshot_date', () => {
    expect(table.constraints.post_metrics_daily_post_id_fkey).toContain('ON DELETE CASCADE');
    const byName = new Map(table.columns.map((column) => [column.name, column]));
    for (const name of ['views', 'likes', 'comments', 'saves']) {
      expect(byName.get(name)?.type).toBe('bigint');
      expect(byName.get(name)?.notNull).toBe(false);
    }
    expect(byName.get('snapshot_date')?.type).toBe('date');
  });

  it('lets owners read their rows exactly like post_metrics and grants no write policy', () => {
    const own = table.policies.post_metrics_daily_select_own;
    expect(own.cmd).toBe('r');
    expect(own.qual).toBe(snapshot.tables.post_metrics.policies.post_metrics_select_own.qual);
    expect(Object.keys(table.policies)).toEqual(['post_metrics_daily_select_own']);
  });

  it('indexes the lookup that subtracts the reading about 24h earlier', () => {
    expect(migration).toContain('on public.post_metrics_daily (post_id, provider, external_id, snapshot_date desc)');
    expect(migration).toContain('on public.post_metrics_daily (user_id, snapshot_date desc)');
  });

  it('finds due posts within 28 days, ordered deterministically, with no reading for the UTC date', () => {
    expect(migration).toContain("interval '28 days'");
    expect(migration).toContain("(p_now at time zone 'UTC')::date");
    expect(migration).toMatch(/order by[\s\S]*nulls first,\s+sp\.published_at asc,\s+sp\.id asc\s+limit p_limit/);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import {
  EXPERIMENT_NAME_MAX_LENGTH,
  EXPERIMENT_TARGET_PAIRS_MAX,
  EXPERIMENT_TARGET_PAIRS_MIN,
  EXPERIMENT_VARIABLES,
  EXPERIMENT_VARIANT_COUNT,
  EXPERIMENT_VARIANT_DESCRIPTION_MAX_LENGTH,
  EXPERIMENT_VARIANT_ID_PATTERN,
  EXPERIMENT_VARIANT_NAME_MAX_LENGTH,
} from '@/lib/experiments/limits';

//---------------
// Migration 041 (content experiments, issue #476). The schema snapshot is
// what Postgres reports after the whole chain is applied (CI regenerates
// it and fails when stale), so these pins compare the code's limits with
// the constraints the database really enforces.
//---------------

interface SnapshotColumn {
  name: string;
  type: string;
  notNull: boolean;
}

interface SnapshotTable {
  rls: boolean;
  columns: SnapshotColumn[];
  constraints: Record<string, string>;
  policies: Record<string, unknown>;
}

const repoRoot = findRepoRoot(import.meta.url);
const snapshot = JSON.parse(readFileSync(join(repoRoot, 'supabase', 'schema.snapshot.json'), 'utf8')) as {
  tables: Record<string, SnapshotTable>;
};
const migration = readFileSync(join(repoRoot, 'supabase/migrations/041_experiments.sql'), 'utf8');

function table(name: string): SnapshotTable {
  const found = snapshot.tables[name];
  if (found === undefined) throw new Error(`${name} is not in the schema snapshot`);
  return found;
}

function column(tableName: string, columnName: string): SnapshotColumn | undefined {
  return table(tableName).columns.find((c) => c.name === columnName);
}

describe('experiments limits match the database checks', () => {
  const experiments = table('experiments').constraints;
  const variants = table('experiment_variants').constraints;

  it('variable accepts exactly EXPERIMENT_VARIABLES', () => {
    // One value: Postgres renders `in ('hook')` as an equality, which the
    // generic enum-check sync test does not parse, so it is pinned here.
    expect(EXPERIMENT_VARIABLES).toEqual(['hook']);
    expect(experiments['experiments_variable_check']).toBe("CHECK ((variable = 'hook'::text))");
  });

  it('target_pairs bounds', () => {
    expect(experiments['experiments_target_pairs_check']).toBe(
      `CHECK (((target_pairs >= ${EXPERIMENT_TARGET_PAIRS_MIN}) AND (target_pairs <= ${EXPERIMENT_TARGET_PAIRS_MAX})))`,
    );
  });

  it('name lengths', () => {
    expect(experiments['experiments_name_length_check']).toBe(
      `CHECK (((char_length(name) >= 1) AND (char_length(name) <= ${EXPERIMENT_NAME_MAX_LENGTH})))`,
    );
    expect(variants['experiment_variants_name_length_check']).toBe(
      `CHECK (((char_length(name) >= 1) AND (char_length(name) <= ${EXPERIMENT_VARIANT_NAME_MAX_LENGTH})))`,
    );
    expect(variants['experiment_variants_description_length_check']).toBe(
      `CHECK (((char_length(description) >= 1) AND (char_length(description) <= ${EXPERIMENT_VARIANT_DESCRIPTION_MAX_LENGTH})))`,
    );
  });

  it('exactly two variant positions', () => {
    expect(variants['experiment_variants_position_check']).toBe(
      `CHECK (((\"position\" >= 0) AND (\"position\" <= ${EXPERIMENT_VARIANT_COUNT - 1})))`,
    );
    expect(variants['experiment_variants_position_key']).toBe('UNIQUE (experiment_id, "position")');
  });

  it('variant_id format', () => {
    expect(variants['experiment_variants_variant_id_format_check']).toBe(
      `CHECK ((variant_id ~ '${EXPERIMENT_VARIANT_ID_PATTERN.source}'::text))`,
    );
    expect(EXPERIMENT_VARIANT_ID_PATTERN.test('hook-aggressive')).toBe(true);
    expect(EXPERIMENT_VARIANT_ID_PATTERN.test('A')).toBe(false);
    expect(EXPERIMENT_VARIANT_ID_PATTERN.test('-hook')).toBe(false);
  });
});

describe('experiments ownership and links', () => {
  it('an experiment owns exactly one schedule and dies with it', () => {
    const constraints = table('experiments').constraints;
    expect(constraints['experiments_schedule_id_key']).toBe('UNIQUE (schedule_id)');
    expect(constraints['experiments_schedule_id_fkey']).toBe(
      'FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE',
    );
    expect(table('experiment_variants').constraints['experiment_variants_experiment_id_fkey']).toBe(
      'FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE',
    );
  });

  it('a slot links to a real variant, one slot per (experiment, pair, variant)', () => {
    const constraints = table('scheduled_posts').constraints;
    expect(constraints['scheduled_posts_experiment_variant_fkey']).toBe(
      'FOREIGN KEY (experiment_id, variant_id) REFERENCES experiment_variants(experiment_id, variant_id) ON DELETE SET NULL',
    );
    expect(constraints['scheduled_posts_experiment_pair_variant_key']).toBe(
      'UNIQUE (experiment_id, experiment_pair, variant_id)',
    );
    expect(constraints['scheduled_posts_experiment_link_check']).toContain(
      '((experiment_id IS NULL) = (variant_id IS NULL))',
    );
    expect(constraints['scheduled_posts_experiment_link_check']).toContain('(experiment_pair IS NOT NULL)');
  });

  it('slots and metrics carry the three nullable link columns', () => {
    for (const tableName of ['scheduled_posts', 'post_metrics']) {
      expect(column(tableName, 'experiment_id')).toMatchObject({ type: 'uuid', notNull: false });
      expect(column(tableName, 'variant_id')).toMatchObject({ type: 'text', notNull: false });
      expect(column(tableName, 'experiment_pair')).toMatchObject({ type: 'integer', notNull: false });
    }
  });

  it('metrics copy the link by trigger, not by FK (snapshot values)', () => {
    expect(
      Object.keys(table('post_metrics').constraints).filter((name) => name.includes('experiment')),
    ).toEqual([]);
    expect(migration).toContain('create trigger post_metrics_set_experiment_trg');
    expect(migration).toContain('before insert on public.post_metrics');
    expect(migration).toContain('into new.experiment_id, new.variant_id, new.experiment_pair');
  });

  it('owners read their own rows under RLS', () => {
    expect(table('experiments').rls).toBe(true);
    expect(table('experiment_variants').rls).toBe(true);
    expect(Object.keys(table('experiments').policies)).toEqual(['experiments_select_own']);
    expect(Object.keys(table('experiment_variants').policies)).toEqual(['experiment_variants_select_own']);
  });
});

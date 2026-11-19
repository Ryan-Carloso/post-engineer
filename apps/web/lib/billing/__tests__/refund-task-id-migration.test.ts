import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

const repoRoot = findRepoRoot(import.meta.url);
const migrationPath = join(
  repoRoot,
  'supabase',
  'migrations',
  '018_refund-task-id.sql',
);

const engineStorePath = join(
  repoRoot,
  'apps',
  'engine',
  'app',
  'services',
  'fill_schedule',
  'store.py',
);

function readSql(): string {
  return readFileSync(migrationPath, 'utf8');
}

describe('supabase/migrations/018_refund-task-id.sql', () => {
  it('exists and recreates the function with the task-id parameter', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readSql();
    expect(sql).toContain(
      'drop function if exists public.refund_batch_tokens(uuid, text, text, numeric, text)',
    );
    expect(sql).toContain('create function public.refund_batch_tokens(');
    expect(sql).toContain('p_engine_task_id text');
  });

  it('keeps the parameter backward-compatible', () => {
    const sql = readSql();
    expect(sql).toContain('p_engine_task_id text default null');
    expect(sql).toContain('returns jsonb');
    expect(sql).toContain('security definer');
  });

  it('writes the task id into the refund ledger row', () => {
    const sql = readSql();
    expect(sql).toContain('engine_task_id');
    expect(sql).toMatch(/insert into public\.token_transactions[\s\S]*engine_task_id/);
    expect(sql).toContain('p_engine_task_id');
  });

  it('preserves the 017 ledger semantics', () => {
    const sql = readSql();
    expect(sql).toContain("type = 'generation_refund'");
    expect(sql).toContain('reference_id = p_refund_key');
    expect(sql).toContain('already_refunded');
    expect(sql).toContain('nothing_to_refund');
    expect(sql).toContain('free_tokens_balance');
  });
});

describe('refund_batch_tokens engine_task_id call sites', () => {
  it('engine store passes p_engine_task_id', () => {
    const src = readFileSync(engineStorePath, 'utf8');
    expect(src).toContain('rpc/refund_batch_tokens');
    expect(src).toContain('"p_engine_task_id"');
  });

  it('reconcile, generate and publish pass engine_task_id=', () => {
    for (const mod of ['reconcile', 'generate', 'publish']) {
      const src = readFileSync(
        join(
          repoRoot,
          'apps',
          'engine',
          'app',
          'services',
          'fill_schedule',
          `${mod}.py`,
        ),
        'utf8',
      );
      expect(src).toContain('engine_task_id=');
    }
  });
});

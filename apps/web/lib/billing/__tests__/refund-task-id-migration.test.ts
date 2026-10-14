import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

//---------------
// supabase/migrations/018_refund-task-id.sql — the failed engine task id on
// the refund ledger row.
//
// Migration 017's refund_batch_tokens RPC writes the refund into
// token_transactions but leaves engine_task_id NULL: the billing history
// shows "refunded" with no link to the task that failed, so nobody can
// answer "which generation failed and why was it refunded" from the ledger.
// This migration extends the RPC with an optional, backward-compatible
// p_engine_task_id parameter written into token_transactions.engine_task_id.
//
// These assertions pin the contract:
//   1. the SQL file drops the old 5-arg signature first (CREATE OR REPLACE
//      cannot change a signature — it would create a second overload and
//      PostgREST would answer 300 Multiple Choices), then recreates the
//      function with p_engine_task_id text DEFAULT NULL,
//   2. the refund INSERT writes engine_task_id,
//   3. the engine store passes "p_engine_task_id" and the three engine call
//      sites (reconcile / generate / publish) pass engine_task_id=.
//---------------

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
    // OR REPLACE cannot change a signature: drop the 5-arg version first so
    // no second overload survives to confuse PostgREST.
    expect(sql).toContain(
      'drop function if exists public.refund_batch_tokens(uuid, text, text, numeric, text)',
    );
    expect(sql).toContain('create function public.refund_batch_tokens(');
    expect(sql).toContain('p_engine_task_id text');
  });

  it('keeps the parameter backward-compatible', () => {
    const sql = readSql();
    // Existing callers (e.g. the web generate-and-schedule route) do not
    // pass the new argument: the default keeps their calls working.
    expect(sql).toContain('p_engine_task_id text default null');
    expect(sql).toContain('returns jsonb');
    expect(sql).toContain('security definer');
  });

  it('writes the task id into the refund ledger row', () => {
    const sql = readSql();
    expect(sql).toContain('engine_task_id');
    // The refund INSERT must carry the new column alongside the existing
    // ledger fields.
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

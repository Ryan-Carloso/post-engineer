import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

//---------------
// supabase/migrations/044_refund-batch-tokens-net-cap.sql — the refund cap
// counts TOTAL charges, not the oldest spend row.
//
// 017/018 capped total refunds at the oldest video_generation row: the batch
// was prepaid as ONE spend row, so the oldest row WAS the charge. The
// generate-and-schedule read-your-ledger check went net-based, so a
// fully-refunded attempt re-charges under the SAME generation_id and the
// ledger holds two spend rows. Under the old cap the retry's per-slot refund
// saw total refunds already equal to the first charge and answered
// `nothing_to_refund`, so the retry's fresh charge was never returned — the
// user paid for a failed video. These assertions pin the net-aware cap and
// the parts of the 018 contract this migration must not regress.
//---------------

const repoRoot = findRepoRoot(import.meta.url);
const migrationPath = join(
  repoRoot,
  'supabase',
  'migrations',
  '044_refund-batch-tokens-net-cap.sql',
);

function readSql(): string {
  return readFileSync(migrationPath, 'utf8');
}

describe('supabase/migrations/044_refund-batch-tokens-net-cap.sql', () => {
  it('exists and declares the function idempotently', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readSql();
    expect(sql).toContain('create or replace function public.refund_batch_tokens');
  });

  it('keeps the exact signature the app calls, including the 018 parameter', () => {
    const sql = readSql();
    expect(sql).toContain('p_user_id uuid');
    expect(sql).toContain('p_batch_generation_id text');
    expect(sql).toContain('p_refund_key text');
    expect(sql).toContain('p_amount numeric');
    expect(sql).toContain('p_reason text');
    expect(sql).toContain('p_engine_task_id text default null');
    expect(sql).toContain('returns jsonb');
    expect(sql).toContain('security definer');
  });

  it('caps refunds at total charges, not the oldest spend row', () => {
    const sql = readSql();
    // Every spend row under the generation_id counts toward the charge:
    // a re-charged retry leaves two video_generation rows behind.
    expect(sql).toContain('sum(abs(amount))');
    expect(sql).toContain("type = 'video_generation'");
    // The oldest-row lookup the cap used to rely on must be gone.
    expect(sql).not.toContain('order by created_at asc');
    expect(sql).not.toContain('limit 1');
    expect(sql).toContain('missing_charge');
    expect(sql).toContain('nothing_to_refund');
  });

  it('sums free_amount over every spend row for the free/paid restore', () => {
    const sql = readSql();
    // The re-charge spends free tokens again, so the free pool is the sum
    // across spend rows, not the oldest row's share alone.
    expect(sql).toContain('sum(coalesce(free_amount, 0))');
    expect(sql).toContain('free_tokens_balance');
    expect(sql).toContain('tokens_balance');
  });

  it('stays idempotent per refund key and answers {refunded}', () => {
    const sql = readSql();
    expect(sql).toContain('reference_id = p_refund_key');
    expect(sql).toContain("type = 'generation_refund'");
    expect(sql).toContain('already_refunded');
    expect(sql).toContain("'refunded', true");
    expect(sql).toContain("'refunded', false");
  });
});

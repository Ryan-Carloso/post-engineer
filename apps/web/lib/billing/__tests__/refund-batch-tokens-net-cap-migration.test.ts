import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

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
    expect(sql).toContain('sum(abs(amount))');
    expect(sql).toContain("type = 'video_generation'");
    expect(sql).not.toContain('order by created_at asc');
    expect(sql).not.toContain('limit 1');
    expect(sql).toContain('missing_charge');
    expect(sql).toContain('nothing_to_refund');
  });

  it('sums free_amount over every spend row for the free/paid restore', () => {
    const sql = readSql();
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

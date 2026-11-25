import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

const repoRoot = findRepoRoot(import.meta.url);
const migrationPath = join(
  repoRoot,
  'supabase',
  'migrations',
  '017_refund-batch-tokens.sql',
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

const webDispatchPath = join(
  repoRoot,
  'apps',
  'web',
  'app',
  'api',
  'videos',
  'generate-and-schedule',
  'dispatch-slot.ts',
);

const webRefundHelperPath = join(
  repoRoot,
  'apps',
  'web',
  'lib',
  'billing',
  'refund-tokens.ts',
);

function readSql(): string {
  return readFileSync(migrationPath, 'utf8');
}

describe('supabase/migrations/017_refund-batch-tokens.sql', () => {
  it('exists and declares the function idempotently', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readSql();
    expect(sql).toContain('create or replace function public.refund_batch_tokens');
  });

  it('has the exact signature the app calls', () => {
    const sql = readSql();
    expect(sql).toContain('p_user_id uuid');
    expect(sql).toContain('p_batch_generation_id text');
    expect(sql).toContain('p_refund_key text');
    expect(sql).toContain('p_amount numeric');
    expect(sql).toContain('p_reason text');
    expect(sql).toContain('returns jsonb');
    expect(sql).toContain('security definer');
  });

  it('is idempotent per refund key', () => {
    const sql = readSql();
    expect(sql).toContain('reference_id = p_refund_key');
    expect(sql).toContain("type = 'generation_refund'");
    expect(sql).toContain('already_refunded');
  });

  it('refunds against the batch charge and caps total refunds at it', () => {
    const sql = readSql();
    expect(sql).toContain('generation_id = p_batch_generation_id');
    expect(sql).toContain("type = 'video_generation'");
    expect(sql).toContain('missing_charge');
    expect(sql).toContain('nothing_to_refund');
  });

  it('restores the free/paid split instead of crediting one bucket', () => {
    const sql = readSql();
    expect(sql).toContain('free_tokens_balance');
    expect(sql).toContain('tokens_balance');
    expect(sql).toContain('free_amount');
  });

  it('writes a positive ledger row and answers {refunded}', () => {
    const sql = readSql();
    expect(sql).toContain("type = 'generation_refund'");
    expect(sql).toContain("'refunded', true");
    expect(sql).toContain("'refunded', false");
  });

  it('rejects non-positive amounts', () => {
    const sql = readSql();
    expect(sql).toContain('p_amount <= 0');
    expect(sql).toContain('raise exception');
  });

  it('locks the balance row before reading it', () => {
    const sql = readSql();
    expect(sql).toContain('for update');
  });
});

describe('refund_batch_tokens call sites', () => {
  const params = [
    'p_user_id',
    'p_batch_generation_id',
    'p_refund_key',
    'p_amount',
    'p_reason',
  ];

  it('engine store passes exactly the five p_ arguments', () => {
    const src = readFileSync(engineStorePath, 'utf8');
    expect(src).toContain('rpc/refund_batch_tokens');
    for (const p of params) {
      expect(src).toContain(`"${p}"`);
    }
  });

  it('web generate-and-schedule dispatch refunds a failed slot through the shared helper', () => {
    const src = readFileSync(webDispatchPath, 'utf8');
    expect(src).toContain('refundSlotTokens({');
    expect(src).toContain('scheduleId,');
    expect(src).toContain('slotId: slot.id');
    expect(src).toContain('amount: ctx.perVideoCost');
    expect(src).toContain("reason: 'Unified generate+schedule: slot dispatch failed; video refunded'");
    expect(src).toContain("kind: 'dispatch_failed'");
  });

  it('shared refund helper passes the five p_ arguments plus the optional task id', () => {
    const src = readFileSync(webRefundHelperPath, 'utf8');
    expect(src).toContain("rpc('refund_batch_tokens'");
    for (const p of params) {
      expect(src).toContain(`${p}:`);
    }
    expect(src).toContain('p_engine_task_id:');
  });
});

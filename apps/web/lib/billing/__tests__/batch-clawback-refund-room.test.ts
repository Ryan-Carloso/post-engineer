import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { planBatchClawback, type BatchSlot } from '../batch-discount';

//---------------
// Migration 045 — settle_batch_clawback must reopen the migration 018 cap.
//
// The discount credit refunds the free video's whole schedule charge, so
// refunded_total equals charge_amount and a later refund of that schedule
// answers nothing_to_refund. The clawback used to copy the discount back
// onto charged_tokens and withhold the sibling refund, which leaves the
// cap full: the re-charged video can never be refunded.
//
// The function refunds the cancelled slot in full, then shrinks the
// discount generation_refund by the same amount and pulls those tokens
// off the balance. The net matches the old withhold, and the cap has
// room for the re-charged amount. These tests pin that SQL and walk the
// 018 formula (first video_generation row, sum of generation_refund
// amounts) with and without the shrink. They do not talk to Postgres.
//---------------

const repoRoot = findRepoRoot(import.meta.url);
const migrationPath = join(repoRoot, 'supabase', 'migrations', '045_batch-clawback-refund-room.sql');

function readSql(): string {
  return readFileSync(migrationPath, 'utf8');
}

describe('supabase/migrations/045_batch-clawback-refund-room.sql', () => {
  it('exists and declares the settlement function', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readSql();
    expect(sql).toContain('create or replace function public.settle_batch_clawback');
    expect(sql).toContain('p_user_id uuid');
    expect(sql).toContain('p_refunds jsonb');
    expect(sql).toContain('p_recharges jsonb');
    expect(sql).toContain('returns jsonb');
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public');
  });

  it('locks the balance, refunds, then shrinks the discount row', () => {
    const sql = readSql();
    const lock = sql.indexOf('for update');
    const refund = sql.indexOf('public.refund_batch_tokens(');
    const shrink = sql.indexOf('set amount = new_amount');
    expect(lock).toBeGreaterThan(-1);
    expect(refund).toBeGreaterThan(lock);
    expect(shrink).toBeGreaterThan(refund);
    expect(sql).toContain('from public.user_profiles');
    expect(sql).toContain("type = 'generation_refund'");
    expect(sql).toContain('reference_id = recharge_item');
  });

  it('re-charges only a live slot whose discount is still the planned one', () => {
    const sql = readSql();
    expect(sql).toContain('update public.scheduled_posts');
    expect(sql).toContain('charged_tokens = charged_tokens + take::integer');
    expect(sql).toContain('discount_tokens = discount_tokens - take::integer');
    expect(sql).toContain("status <> 'failed'");
    expect(sql).toContain("charged_tokens = (recharge_item->>'expected_charged')::integer");
    expect(sql).toContain("discount_tokens = (recharge_item->>'expected_discount')::integer");
  });

  it('does not insert a second charge to reopen the cap', () => {
    const sql = readSql();
    expect(sql).not.toContain("'video_generation'");
    expect(sql).toContain('batch clawback discount refund missing');
  });
});

//---------------
// In-memory copy of refund_batch_tokens (migration 018) plus the shrink
// settle_batch_clawback applies to the discount row. Numbers are the
// review's 6-video batch: each face video costs 2, the cheapest is credited
// in full, then one paid sibling is cancelled.
//---------------

const PRICE = 2;
const START = 100;

interface LedgerRow {
  type: 'video_generation' | 'generation_refund';
  generationId: string;
  referenceId: string | null;
  amount: number;
  freeAmount: number;
  createdAt: number;
}

interface Ledger {
  paid: number;
  free: number;
  rows: LedgerRow[];
  clock: number;
}

type RefundResult =
  | { refunded: true; amount: number }
  | { refunded: false; already_refunded: true }
  | { refunded: false; nothing_to_refund: true }
  | { refunded: false; missing_charge: true };

function chargeId(scheduleId: string): string {
  return `batch:${scheduleId}`;
}

function spend(ledger: Ledger, scheduleId: string, amount: number): void {
  ledger.clock += 1;
  ledger.paid -= amount;
  ledger.rows.push({
    type: 'video_generation',
    generationId: chargeId(scheduleId),
    referenceId: null,
    amount: -amount,
    freeAmount: 0,
    createdAt: ledger.clock,
  });
}

/** Migration 018, including the cap on the sum of generation_refund amounts. */
function refundBatchTokens(
  ledger: Ledger,
  generationId: string,
  refundKey: string,
  amount: number,
): RefundResult {
  const existing = ledger.rows.find(
    (row) => row.type === 'generation_refund' && row.referenceId === refundKey,
  );
  if (existing) return { refunded: false, already_refunded: true };

  const charges = ledger.rows
    .filter((row) => row.type === 'video_generation' && row.generationId === generationId)
    .sort((a, b) => a.createdAt - b.createdAt);
  const charge = charges[0];
  if (!charge) return { refunded: false, missing_charge: true };
  const chargeAmount = Math.abs(charge.amount);

  const refunds = ledger.rows.filter(
    (row) => row.type === 'generation_refund' && row.generationId === generationId,
  );
  const refundedTotal = refunds.reduce((sum, row) => sum + row.amount, 0);
  if (refundedTotal >= chargeAmount) return { refunded: false, nothing_to_refund: true };
  const credit = Math.min(amount, chargeAmount - refundedTotal);

  const freeRestored = refunds.reduce((sum, row) => sum + row.freeAmount, 0);
  const freePart = Math.min(credit, Math.max(charge.freeAmount - freeRestored, 0));
  const paidPart = credit - freePart;
  ledger.paid += paidPart;
  ledger.free += freePart;
  ledger.clock += 1;
  ledger.rows.push({
    type: 'generation_refund',
    generationId,
    referenceId: refundKey,
    amount: credit,
    freeAmount: freePart,
    createdAt: ledger.clock,
  });
  return { refunded: true, amount: credit };
}

/**
 * The pull-back half of settle_batch_clawback: shrink the discount refund
 * and take the same tokens off the balance (free bucket first).
 */
function shrinkDiscountRefund(ledger: Ledger, discountKey: string, take: number): void {
  const row = ledger.rows.find(
    (candidate) => candidate.type === 'generation_refund' && candidate.referenceId === discountKey,
  );
  if (!row || row.amount < take) {
    throw new Error('batch clawback discount refund missing');
  }
  const freeBack = Math.min(take, ledger.free);
  const paidBack = take - freeBack;
  if (paidBack > ledger.paid) throw new Error('batch clawback would drive the balance negative');
  ledger.free -= freeBack;
  ledger.paid -= paidBack;
  row.amount -= take;
  row.freeAmount = Math.min(Math.max(row.freeAmount - freeBack, 0), row.amount);
}

function sixVideoLedger(): { ledger: Ledger; discountKey: string } {
  const ledger: Ledger = { paid: START, free: 0, rows: [], clock: 0 };
  for (const id of ['A', 'B', 'C', 'D', 'S', 'F']) spend(ledger, id, PRICE);
  const discountKey = `${chargeId('F')}:slot:F:discount`;
  const credited = refundBatchTokens(ledger, chargeId('F'), discountKey, PRICE);
  if (!credited.refunded) throw new Error('discount credit did not land');
  return { ledger, discountKey };
}

function balance(ledger: Ledger): number {
  return ledger.paid + ledger.free;
}

describe('the 018 cap after a clawback of the free video', () => {
  it('pays nothing back for the re-charged video when the discount row stays whole', () => {
    const { ledger, discountKey } = sixVideoLedger();
    expect(balance(ledger)).toBe(90);
    // Old clawback: withhold the sibling and do not touch the ledger.
    const failure = refundBatchTokens(ledger, chargeId('F'), `${chargeId('F')}:slot:F`, PRICE);
    expect(failure).toEqual({ refunded: false, nothing_to_refund: true });
    expect(balance(ledger)).toBe(90);
    expect(ledger.rows.find((row) => row.referenceId === discountKey)?.amount).toBe(PRICE);
  });

  it('refunds the re-charged video once the discount row is shrunk by the same amount', () => {
    const { ledger, discountKey } = sixVideoLedger();
    const sibling = refundBatchTokens(ledger, chargeId('S'), `${chargeId('S')}:slot:S`, PRICE);
    expect(sibling).toEqual({ refunded: true, amount: PRICE });
    expect(balance(ledger)).toBe(92);
    shrinkDiscountRefund(ledger, discountKey, PRICE);
    // Net of the sibling refund and the pull-back is the old withhold.
    expect(balance(ledger)).toBe(90);
    expect(ledger.rows.find((row) => row.referenceId === discountKey)?.amount).toBe(0);

    const failure = refundBatchTokens(ledger, chargeId('F'), `${chargeId('F')}:slot:F`, PRICE);
    expect(failure).toEqual({ refunded: true, amount: PRICE });
    // Four videos delivered at 2 each: 100 - 8.
    expect(balance(ledger)).toBe(92);
    const retry = refundBatchTokens(ledger, chargeId('F'), discountKey, PRICE);
    expect(retry).toEqual({ refunded: false, already_refunded: true });
  });

  it('leaves a failed free video credited, because that slot is not clawed', () => {
    const remaining: BatchSlot[] = ['A', 'B', 'C', 'D'].map((id) => ({
      id,
      scheduleId: id,
      faceless: false,
      status: 'generating',
      chargedTokens: PRICE,
      discountTokens: 0,
      createdAt: '2026-11-08T10:00:00.000Z',
      taskId: null,
    }));
    remaining.push({
      id: 'F',
      scheduleId: 'F',
      faceless: false,
      status: 'failed',
      chargedTokens: 0,
      discountTokens: PRICE,
      createdAt: '2026-11-08T10:00:00.000Z',
      taskId: null,
    });
    expect(planBatchClawback(remaining)).toEqual([]);

    const { ledger, discountKey } = sixVideoLedger();
    const sibling = refundBatchTokens(ledger, chargeId('S'), `${chargeId('S')}:slot:S`, PRICE);
    expect(sibling).toEqual({ refunded: true, amount: PRICE });
    expect(ledger.rows.find((row) => row.referenceId === discountKey)?.amount).toBe(PRICE);
    const second = refundBatchTokens(ledger, chargeId('F'), `${chargeId('F')}:slot:F`, PRICE);
    expect(second).toEqual({ refunded: false, nothing_to_refund: true });
    // Failed video refunded via the discount, cancelled sibling refunded in full.
    expect(balance(ledger)).toBe(92);
  });
});

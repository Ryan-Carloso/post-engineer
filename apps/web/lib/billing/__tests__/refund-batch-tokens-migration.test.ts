import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

//---------------
// supabase/migrations/017_refund-batch-tokens.sql — the invariant the app
// depends on for every per-slot batch refund.
//
// The engine's fill_schedule store (`apps/engine/app/services/fill_schedule/
// store.py::refund_batch_tokens`) and the web's generate-and-schedule route
// both POST `rpc/refund_batch_tokens`, but no migration ever created the
// function: every per-slot batch refund 404'd (PGRST202) and the tokens were
// never credited back. These assertions pin the two halves of the contract:
//
//   1. the SQL file declares the function with the exact signature the app
//      calls (p_user_id, p_batch_generation_id, p_refund_key, p_amount,
//      p_reason) and the ledger semantics of the sibling
//      `refund_generation_tokens` (idempotent, capped at the charge,
//      restores the free/paid split, returns {refunded}), and
//   2. both app call sites pass exactly those five p_ arguments.
//---------------

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

const webRoutePath = join(
  repoRoot,
  'apps',
  'web',
  'app',
  'api',
  'videos',
  'generate-and-schedule',
  'route.ts',
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
    // Same trust boundary as the sibling billing RPCs: the app calls with
    // the service-role key, so the function runs as the owner.
    expect(sql).toContain('security definer');
  });

  it('is idempotent per refund key', () => {
    const sql = readSql();
    // A second refund with the same key must not credit twice: the
    // refund_key rides in reference_id (generation_id stays the batch id).
    expect(sql).toContain('reference_id = p_refund_key');
    expect(sql).toContain("type = 'generation_refund'");
    expect(sql).toContain('already_refunded');
  });

  it('refunds against the batch charge and caps total refunds at it', () => {
    const sql = readSql();
    // The batch was prepaid as ONE spend_tokens row under the batch id.
    expect(sql).toContain('generation_id = p_batch_generation_id');
    expect(sql).toContain("type = 'video_generation'");
    expect(sql).toContain('missing_charge');
    // Prior per-slot refunds of the same batch must never exceed the charge
    // (pricing can move between spend time and refund time).
    expect(sql).toContain('nothing_to_refund');
  });

  it('restores the free/paid split instead of crediting one bucket', () => {
    const sql = readSql();
    expect(sql).toContain('free_tokens_balance');
    expect(sql).toContain('tokens_balance');
    // The ledger row records how much of the credit went back to free.
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
    // Concurrent refunds of sibling slots must serialize on the balance.
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

  it('web generate-and-schedule route passes exactly the five p_ arguments', () => {
    const src = readFileSync(webRoutePath, 'utf8');
    expect(src).toContain("rpc('refund_batch_tokens'");
    for (const p of params) {
      expect(src).toContain(`${p}:`);
    }
  });
});
